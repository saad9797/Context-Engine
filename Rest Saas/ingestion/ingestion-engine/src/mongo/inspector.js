"use strict";

const { MongoClient, ObjectId } = require("mongodb");
const { assertSafeConnectionString, allowedHostsFromEnv } = require("../ssrf-guard");

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
  "hash", "salt", "refresh_token", "refreshtoken", "access_token", "accesstoken",
  "otp", "pin", "ssn", "credit_card", "card_number", "cvv", "private_key",
]);

const MAX_DEPTH = 4;
const SAMPLE_SIZE = 5;
const COLLECTION_CONCURRENCY = 5;
const DATABASE_CONCURRENCY = 3;
const QUERY_TIMEOUT_MS = 15000; // guards against hanging on a huge/locked collection

// Mongo's own internal databases — never what someone means by "scan all
// databases" for an application's schema, and `admin` in particular can be
// slow/permission-restricted to enumerate collections in.
const SYSTEM_DATABASE_NAMES = new Set(["admin", "local", "config"]);

// Bounded-concurrency map — mirrors the one in the postgres inspector so a
// database with many collections doesn't process them one at a time.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isObjectIdLike(val) {
  return val instanceof ObjectId || (val && val._bsontype === "ObjectID");
}

function analyzeValue(val, depth = 0) {
  if (depth > MAX_DEPTH) return "__max_depth__";
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (isObjectIdLike(val)) return "ObjectId";
  if (val instanceof Date) return "Date";
  if (Buffer.isBuffer(val)) return "Buffer";

  if (Array.isArray(val)) {
    if (val.length === 0) return "Array<empty>";
    const itemShapes = val.slice(0, 3).map((item) => analyzeValue(item, depth + 1));
    const unique = Array.from(new Set(itemShapes.map((s) => JSON.stringify(s)))).map((s) =>
      JSON.parse(s)
    );
    return {
      __type: "Array",
      __length: val.length,
      __item_shape: unique.length === 1 ? unique[0] : unique,
    };
  }

  if (typeof val === "object") {
    const shape = {};
    for (const [k, v] of Object.entries(val)) shape[k] = analyzeValue(v, depth + 1);
    return shape;
  }

  return typeof val;
}

// Merge shapes across sampled docs so fields present in some-but-not-all docs still show up
function mergeShapes(a, b) {
  if (typeof a !== "object" || typeof b !== "object") return a ?? b;
  if (Array.isArray(a) || Array.isArray(b)) return a ?? b;
  if (a === null || b === null) return a ?? b;

  const merged = { ...a };
  for (const key of Object.keys(b)) {
    if (!(key in merged)) {
      merged[key] = b[key];
    } else if (typeof merged[key] === "object" && typeof b[key] === "object") {
      merged[key] = mergeShapes(merged[key], b[key]);
    }
  }
  return merged;
}

function redactDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "**redacted**";
    } else if (Buffer.isBuffer(v)) {
      out[k] = "[binary data omitted]";
    } else if (isObjectIdLike(v)) {
      out[k] = v.toString();
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Infer FK-like relationships from naming convention, e.g. "userId" -> "users"
function detectReferenceFields(shape, collectionNames) {
  const refs = [];
  for (const [key, val] of Object.entries(shape)) {
    if (key === "_id") continue;
    const isIdLike = /(_id|Id)$/.test(key);
    if (!isIdLike) continue;

    const isObjectIdString = typeof val === "string" && val.startsWith("ObjectId(");
    const isArrayOfObjectIds =
      typeof val === "object" &&
      val?.__type === "Array" &&
      typeof val.__item_shape === "string" &&
      val.__item_shape.startsWith("ObjectId(");

    if (!isObjectIdString && !isArrayOfObjectIds) continue;

    const base = key.replace(/(_id|Id)$/, "").toLowerCase();
    const guessedCollection =
      collectionNames.find((c) => c.toLowerCase() === base) ||
      collectionNames.find((c) => c.toLowerCase() === `${base}s`) ||
      null;

    refs.push({ field: key, is_array: isArrayOfObjectIds, guessed_collection: guessedCollection });
  }
  return refs;
}

function detectStorageFields(shape) {
  const pattern = /url|path|file|image|photo|avatar|attachment|blob|bucket|key|media|upload/i;
  const fields = [];
  for (const [key, val] of Object.entries(shape)) {
    if (typeof val === "string" && val.startsWith("string(") && pattern.test(key)) {
      fields.push(key);
    }
  }
  return fields;
}

/**
 * Inspect one already-open database: metadata, per-collection schema
 * shapes/indexes/samples, inferred relationships, and inferred
 * storage-reference fields. Every collection/view/edge is stamped with
 * `database` so a caller merging results across multiple databases (see
 * `inspectMongo`'s scanAllDatabases path) can tell them apart — relationship
 * inference itself stays scoped to this one database's own collection names,
 * since a naming match across two unrelated databases isn't a meaningful
 * signal the way it is within one.
 */
async function inspectOneDatabase(db) {
  const admin = db.admin();

  const [buildInfo, dbStats, collectionInfos] = await Promise.all([
    admin.buildInfo().catch(() => null),
    db.stats().catch(() => null),
    db.listCollections({}, { nameOnly: false }).toArray(),
  ]);

  const collectionNames = collectionInfos
    .filter((c) => c.type === "collection")
    .map((c) => c.name);

  const collectionsToInspect = collectionInfos.filter((c) => c.type === "collection");

  // Inspect collections with bounded concurrency instead of one at a time
  // — each collection already parallelizes its own 4 queries internally,
  // but with many collections in a database, those batches were still run
  // sequentially.
  const collections = await mapWithConcurrency(
    collectionsToInspect,
    COLLECTION_CONCURRENCY,
    async (info) => {
      const name = info.name;
      const collection = db.collection(name);

      const [estimatedCount, indexes, samples, collStats] = await Promise.all([
        collection.estimatedDocumentCount().catch(() => null),
        collection.indexes().catch(() => []),
        collection.find({}).limit(SAMPLE_SIZE).maxTimeMS(QUERY_TIMEOUT_MS).toArray().catch(() => []),
        db.command({ collStats: name }).catch(() => null),
      ]);

      const mergedShape = samples
        .map((doc) => analyzeValue(doc))
        .reduce((acc, s) => mergeShapes(acc, s), {});

      return {
        name,
        database: db.databaseName,
        validator: info.options?.validator || null,
        estimated_documents: estimatedCount,
        storage_size: collStats ? `${(collStats.storageSize / 1024 / 1024).toFixed(2)} MB` : null,
        avg_document_size_bytes: collStats?.avgObjSize ?? null,
        indexes: indexes.map((idx) => ({
          name: idx.name,
          keys: idx.key,
          unique: !!idx.unique,
          sparse: !!idx.sparse,
          ttl_seconds: idx.expireAfterSeconds ?? null,
        })),
        schema_shape: mergedShape,
        // Samples are read only to infer field types and are never retained.
        reference_fields: detectReferenceFields(mergedShape, collectionNames),
        storage_fields: detectStorageFields(mergedShape),
      };
    }
  );

  const views = collectionInfos
    .filter((c) => c.type === "view")
    .map((v) => ({
      name: v.name,
      database: db.databaseName,
      view_on: v.options?.viewOn,
      pipeline: v.options?.pipeline,
    }));

  const relationshipGraph = [];
  for (const col of collections) {
    for (const ref of col.reference_fields) {
      if (ref.guessed_collection) {
        relationshipGraph.push({
          database: db.databaseName,
          from: col.name,
          from_field: ref.field,
          to: ref.guessed_collection,
          is_array: ref.is_array,
          confidence: "inferred_by_naming",
        });
      }
    }
  }

  const storageColumns = [];
  for (const col of collections) {
    for (const field of col.storage_fields) {
      storageColumns.push({ database: db.databaseName, collection: col.name, field, type: "string" });
    }
  }

  return {
    metadata: {
      database_name: db.databaseName,
      server_version: buildInfo?.version || null,
      database_size: dbStats ? `${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB` : null,
      total_collections: collections.length,
      total_views: views.length,
    },
    collections,
    views,
    relationship_graph: relationshipGraph,
    storage_columns: storageColumns,
  };
}

/**
 * @param {string} connectionString  mongodb:// or mongodb+srv:// URI
 * @param {{ dbName?: string, scanAllDatabases?: boolean, timeoutMs?: number }} [options]
 *   scanAllDatabases inspects every non-system database on the cluster
 *   instead of just `dbName` — off by default since it repeats the full
 *   sampling pass per database and can be slow on a cluster with many of
 *   them; `dbName` is ignored when this is set.
 */
async function inspectMongo(connectionString, options = {}) {
  await assertSafeConnectionString(connectionString, allowedHostsFromEnv());

  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: options.timeoutMs || 10000,
  });

  // If connect() throws, the client still holds open sockets/timers —
  // without this, every failed connection attempt leaked a client for the
  // lifetime of the process (same issue fixed in the postgres inspector).
  try {
    await client.connect();
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }

  try {
    if (!options.scanAllDatabases) {
      const result = await inspectOneDatabase(client.db(options.dbName));
      return { scan_mode: "single_database", ...result };
    }

    const { databases: dbList } = await client.db().admin().listDatabases({ nameOnly: true });
    const names = dbList
      .map((d) => d.name)
      .filter((name) => !SYSTEM_DATABASE_NAMES.has(name.toLowerCase()));

    const perDatabase = await mapWithConcurrency(names, DATABASE_CONCURRENCY, (name) =>
      inspectOneDatabase(client.db(name))
    );

    return {
      scan_mode: "all_databases",
      metadata: {
        database_name: null,
        scanned_databases: names,
        server_version: perDatabase.find((r) => r.metadata.server_version)?.metadata.server_version || null,
        total_collections: perDatabase.reduce((sum, r) => sum + r.metadata.total_collections, 0),
        total_views: perDatabase.reduce((sum, r) => sum + r.metadata.total_views, 0),
      },
      collections: perDatabase.flatMap((r) => r.collections),
      views: perDatabase.flatMap((r) => r.views),
      relationship_graph: perDatabase.flatMap((r) => r.relationship_graph),
      storage_columns: perDatabase.flatMap((r) => r.storage_columns),
    };
  } finally {
    await client.close();
  }
}

module.exports = { inspectMongo };
