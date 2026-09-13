"use strict";

const { buildClaudeContext } = require("./context-filter");
const { buildArchitectureGraph } = require("./graph-builder");

// Progress is reported as single-line "PROGRESS::{json}" markers on stderr —
// ingestion/tasks.py tails this process's stderr and parses them to update
// IngestionJob.stage/progress_pct while the job runs on an RQ worker, since
// the request that created the job already got its 202 response and moved on.
function makeProgressEmitter(config) {
  const stages = [];
  if (config.postgresUrl) stages.push("postgres");
  if (config.mongoUrl) stages.push("mongo");
  if (config.storageConfig) stages.push("storage");
  if (config.github) stages.push("github");
  stages.push("finalizing");
  const weight = 100 / stages.length;
  let completed = 0;
  return function emitProgress(stage) {
    completed += 1;
    const pct = Math.min(100, Math.round(completed * weight));
    process.stderr.write(`PROGRESS::${JSON.stringify({ stage, pct })}\n`);
  };
}

async function runIngestion(config) {
  const startTime = Date.now();
  const errors = {};
  const emitProgress = makeProgressEmitter(config);
  process.stderr.write(`PROGRESS::${JSON.stringify({ stage: "starting", pct: 0 })}\n`);

  let database = null;
  if (config.postgresUrl) {
    console.error("[ingestion] Inspecting Postgres database...");
    try {
      // Lazy-required: keeps this driver an opt-in dependency. If `pg` isn't
      // installed, only Postgres runs fail — Mongo/GitHub-only runs are unaffected.
      const { inspectPostgres } = require("./postgres/inspector");
      database = await inspectPostgres(config.postgresUrl);
      console.error(`[ingestion] DB done — ${database.metadata.total_tables} tables found`);
    } catch (e) {
      console.error("[ingestion] DB inspection failed:", e.message);
      errors.database =
        e.code === "MODULE_NOT_FOUND"
          ? "The 'pg' package is not installed. Run: npm install pg"
          : e.message;
    }
    emitProgress("postgres");
  }

  let mongoDatabase = null;
  if (config.mongoUrl) {
    console.error("[ingestion] Inspecting MongoDB database...");
    try {
      // Lazy-required for the same reason as inspectPostgres above.
      const { inspectMongo } = require("./mongo/inspector");
      mongoDatabase = await inspectMongo(config.mongoUrl, {
        dbName: config.mongoDbName,
        scanAllDatabases: !!config.mongoScanAllDatabases,
      });
      console.error(
        `[ingestion] Mongo done — ${mongoDatabase.metadata.total_collections} collections found`
      );
    } catch (e) {
      console.error("[ingestion] Mongo inspection failed:", e.message);
      errors.mongoDatabase =
        e.code === "MODULE_NOT_FOUND"
          ? "The 'mongodb' package is not installed. Run: npm install mongodb"
          : e.message;
    }
    emitProgress("mongo");
  }

  let objectStorage = null;
  if (config.storageConfig) {
    console.error("[ingestion] Inspecting object storage...");
    try {
      const { inspectObjectStorage } = require("./storage/inspector");
      objectStorage = await inspectObjectStorage(config.storageConfig);
      console.error("[ingestion] Storage done");
    } catch (e) {
      console.error("[ingestion] Storage inspection failed:", e.message);
      errors.objectStorage =
        e.code === "MODULE_NOT_FOUND"
          ? `Missing storage SDK dependency. ${e.message}`
          : e.message;
    }
    emitProgress("storage");
  }

  let codebase = null;
  if (config.github) {
    console.error("[ingestion] Scraping GitHub repository...");
    try {
      const { inspectGitHub } = require("./github/inspector");
      codebase = await inspectGitHub(config.github);
      console.error(`[ingestion] GitHub done — ${codebase.file_tree.total_files} files indexed`);
    } catch (e) {
      console.error("[ingestion] GitHub inspection failed:", e.message);
      errors.codebase =
        e.code === "MODULE_NOT_FOUND"
          ? `Missing GitHub client dependency. ${e.message}`
          : e.message;
    }
    emitProgress("github");
  }

  let storageColumnMapping = null;
  if (objectStorage && (database?.storage_columns?.length || mongoDatabase?.storage_columns?.length)) {
    const pgCols = (database?.storage_columns || []).map((col) => ({
      ...col,
      source: "postgres",
      storage_provider: objectStorage.provider,
      note: "This column likely stores a reference (URL or key) to an object in the storage bucket.",
    }));
    const mongoCols = (mongoDatabase?.storage_columns || []).map((col) => ({
      ...col,
      source: "mongo",
      storage_provider: objectStorage.provider,
      note: "This field likely stores a reference (URL or key) to an object in the storage bucket.",
    }));
    storageColumnMapping = [...pgCols, ...mongoCols];
  }

  const context = {
    _meta: {
      generated_at: new Date().toISOString(),
      ingestion_duration_ms: Date.now() - startTime,
      schema_version: "1.1.0",
      project: config.meta || {},
      sources: {
        database: !!database,
        mongo_database: !!mongoDatabase,
        object_storage: !!objectStorage,
        codebase: !!codebase,
      },
      errors: Object.keys(errors).length ? errors : null,
    },
    database,
    mongo_database: mongoDatabase,
    object_storage: objectStorage,
    object_storage_column_mapping: storageColumnMapping,
    codebase,
    api_generation_hints: null,
  };

  // Post-processing runs over data that's already safely fetched — a bug
  // here (e.g. an unexpected shape from one inspector) shouldn't discard an
  // otherwise-successful ingestion. Both steps degrade to null with an error
  // recorded instead of throwing.
  try {
    context.api_generation_hints = buildApiHints({ database, mongoDatabase, codebase, objectStorage });
  } catch (e) {
    console.error("[ingestion] Hint generation failed:", e.message);
    errors.apiGenerationHints = e.message;
  }

  try {
    // Unified node/edge view merging tables, collections, buckets, and
    // routes — the single "see the whole architecture" surface, instead of
    // four disconnected JSON trees a frontend would otherwise have to
    // cross-reference itself.
    context.architecture_graph = buildArchitectureGraph(context);
  } catch (e) {
    console.error("[ingestion] Architecture graph build failed:", e.message);
    errors.architectureGraph = e.message;
    context.architecture_graph = null;
  }

  try {
    // Distilled, LLM-ready view of the same data — this is what gets handed
    // to Claude for code generation.
    context.claude_context = buildClaudeContext(context);
  } catch (e) {
    // Log the full stack, not just the message — a silent one-line message
    // is exactly what let this fail invisibly before. Also surface WHERE
    // it broke (module resolution vs. a runtime throw inside the filter) so
    // it's obvious which of the two to check first.
    const isMissingModule = e.code === "MODULE_NOT_FOUND";
    console.error(
      `[ingestion] Context distillation failed (${isMissingModule ? "module not found — check require path" : "runtime error inside context-filter.js"}):`,
      e.stack || e.message
    );
    errors.claudeContext = isMissingModule
      ? `context-filter.js could not be loaded: ${e.message}`
      : e.message;
    context.claude_context = null;
  }

  context._meta.errors = Object.keys(errors).length ? errors : null;
  context._meta.ingestion_duration_ms = Date.now() - startTime;

  emitProgress("finalizing");

  return context;
}

function buildApiHints({ database, mongoDatabase, codebase, objectStorage }) {
  const hints = {
    suggested_resources: [],
    auth_detected: false,
    file_upload_endpoints_needed: false,
    pagination_pattern: null,
    naming_convention: null,
    existing_route_patterns: [],
  };

  if (database) {
    for (const table of database.tables) {
      const isJunction =
        table.foreign_keys.length >= 2 &&
        table.columns.length <= table.foreign_keys.length + 3;

      hints.suggested_resources.push({
        source: "postgres",
        name: table.name,
        schema: table.schema,
        type: isJunction ? "junction" : "primary",
        suggested_endpoints: isJunction
          ? ["POST /:parentId/relations", "DELETE /:parentId/relations/:id"]
          : [
              `GET /${table.name}`,
              `GET /${table.name}/:id`,
              `POST /${table.name}`,
              `PUT /${table.name}/:id`,
              `DELETE /${table.name}/:id`,
            ],
        has_soft_delete: table.columns.some((c) =>
          /deleted_at|is_deleted|archived_at/.test(c.name)
        ),
        has_timestamps: table.columns.some((c) => /created_at|updated_at/.test(c.name)),
        has_owner_column: table.columns.some((c) =>
          /user_id|owner_id|created_by|author_id/.test(c.name)
        ),
        storage_columns: table.columns
          .filter((c) => c.is_storage_reference)
          .map((c) => c.name),
        unique_fields: table.unique_constraints.flatMap((u) => u.columns),
        primary_keys: table.primary_keys,
      });
    }

    hints.auth_detected =
      hints.auth_detected ||
      database.tables.some((t) => /user|account|auth|session|token/.test(t.name));

    const hasCursorPk = database.tables.some((t) =>
      t.columns.some(
        (c) =>
          t.primary_keys.includes(c.name) &&
          /uuid|int4|int8|serial|bigserial/.test(c.udt)
      )
    );
    hints.pagination_pattern = hasCursorPk ? "cursor-based (keyset)" : "offset-limit";
  }

  if (mongoDatabase) {
    const fieldNames = (shape) => Object.keys(shape || {});
    const isJunctionLike = (col) => {
      const refCount = col.reference_fields.length;
      return refCount >= 2 && fieldNames(col.schema_shape).length <= refCount + 3;
    };

    for (const col of mongoDatabase.collections) {
      const fields = fieldNames(col.schema_shape);
      hints.suggested_resources.push({
        source: "mongo",
        name: col.name,
        database: col.database,
        schema: null,
        type: isJunctionLike(col) ? "junction" : "primary",
        suggested_endpoints: isJunctionLike(col)
          ? ["POST /:parentId/relations", "DELETE /:parentId/relations/:id"]
          : [
              `GET /${col.name}`,
              `GET /${col.name}/:id`,
              `POST /${col.name}`,
              `PUT /${col.name}/:id`,
              `DELETE /${col.name}/:id`,
            ],
        has_soft_delete: fields.some((f) => /deleted_at|is_deleted|archived_at|deletedAt|isDeleted|archivedAt/.test(f)),
        has_timestamps: fields.some((f) => /created_at|updated_at|createdAt|updatedAt/.test(f)),
        has_owner_column: fields.some((f) => /user_id|owner_id|created_by|author_id|userId|ownerId|createdBy|authorId/.test(f)),
        storage_columns: col.storage_fields,
        unique_fields: col.indexes.filter((i) => i.unique).flatMap((i) => Object.keys(i.keys)),
        primary_keys: ["_id"],
      });
    }

    hints.auth_detected =
      hints.auth_detected ||
      mongoDatabase.collections.some((c) => /user|account|auth|session|token/.test(c.name));

    // Mongo's _id is always ObjectId-based, so cursor pagination is the natural default
    if (!hints.pagination_pattern) hints.pagination_pattern = "cursor-based (keyset)";
  }

  if (objectStorage && (database?.storage_columns?.length > 0 || mongoDatabase?.storage_columns?.length > 0)) {
    hints.file_upload_endpoints_needed = true;
  }

  if (codebase) {
    const routeFiles = codebase.key_files_by_role?.["route/controller"] || [];
    const patterns = new Set();

    for (const f of routeFiles) {
      if (!f.content) continue;
      const matches = f.content.match(/['"`](\/[a-zA-Z0-9/:_-]+)['"`]/g) || [];
      for (const m of matches.slice(0, 10)) {
        const clean = m.replace(/['"`]/g, "");
        if (clean.length > 2) patterns.add(clean);
      }
    }

    hints.existing_route_patterns = Array.from(patterns).slice(0, 30);

    const routeStr = hints.existing_route_patterns.join(" ");
    if (/-/.test(routeStr)) hints.naming_convention = "kebab-case";
    else if (/_/.test(routeStr)) hints.naming_convention = "snake_case";
    else hints.naming_convention = "camelCase";

    if (!hints.auth_detected) {
      const authKeywords = /passport|jwt|bearer|authenticate|authorize|middleware.*auth/i;
      const allContent = Object.values(codebase.key_files_by_role || {})
        .flat()
        .map((f) => f.content || "")
        .join(" ");
      hints.auth_detected = authKeywords.test(allContent);
    }
  }

  return hints;
}

module.exports = { runIngestion };