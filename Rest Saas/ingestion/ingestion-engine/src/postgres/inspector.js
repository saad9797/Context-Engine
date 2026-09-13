"use strict";

const { Pool, types } = require("pg");
const { assertSafeConnectionString, allowedHostsFromEnv } = require("../ssrf-guard");

// pg returns int8/bigint (OID 20) as strings by default to avoid silent
// precision loss above Number.MAX_SAFE_INTEGER. For inspection purposes
// (schema/shape discovery, not financial math) consistent numeric typing
// matters more than that edge case, so normalize it — this is what caused
// analytics.dim_course.course_id to show up as "string(2)" while
// education_dw.courses.course_id (int4) showed up as "number(1)" in the
// same context payload.
types.setTypeParser(20, (val) => (val === null ? null : Number(val)));

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
  "hash", "salt", "refresh_token", "access_token", "otp", "pin",
  "ssn", "credit_card", "card_number", "cvv", "private_key",
]);

const SAMPLE_CONCURRENCY = 5;
const SAMPLE_LIMIT = 5;
const MAX_REDACT_DEPTH = 6;
const MAX_JSON_ARRAY_ITEMS = 20;

// Recursively redacts sensitive keys and truncates large arrays anywhere
// inside a value — not just at the top level. A JSONB column can carry an
// arbitrarily nested object (e.g. a synced user profile blob) that includes
// a "password" or "token" field several levels down; the old redactRow only
// checked top-level column names and would have shipped that untouched.
function redactValue(val, depth = 0) {
  if (depth > MAX_REDACT_DEPTH) return "[max_depth]";
  if (val === null || val === undefined) return val;
  if (Buffer.isBuffer(val)) return "[binary data omitted]";
  if (val instanceof Date) return val;
  if (Array.isArray(val)) {
    return val.slice(0, MAX_JSON_ARRAY_ITEMS).map((v) => redactValue(v, depth + 1));
  }
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "**redacted**" : redactValue(v, depth + 1);
    }
    return out;
  }
  return val;
}

function redactRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "**redacted**";
    } else if (Buffer.isBuffer(v)) {
      out[k] = "[binary data omitted]";
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

function describeValue(val) {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (val instanceof Date) return `Date(${val.toISOString()})`;
  if (Buffer.isBuffer(val)) return `Buffer(${val.length} bytes)`;
  if (Array.isArray(val)) {
    if (val.length === 0) return "Array<empty>";
    return { __type: "Array", __length: val.length, __sample: val.slice(0, 2).map(describeValue) };
  }
  if (typeof val === "object") {
    const shape = {};
    for (const [k, v] of Object.entries(val)) shape[k] = describeValue(v);
    return shape;
  }
  return `${typeof val}(${String(val).slice(0, 80)})`;
}

// Bounded-concurrency map — runs `fn` over `items` with at most `limit` in
// flight at once. Used for the per-table sample-row queries: with 30 tables
// run sequentially (the original behavior) that's 30 network round trips
// end-to-end; at concurrency 5 it's ~6 batches, which is most of why a
// 27-second ingestion run drops significantly.
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

async function inspectPostgres(connectionString) {
  // Re-checked here, immediately before connecting, in addition to Django's
  // pre-flight check — this is the belt to that suspenders against a
  // DNS-rebinding window between when the job was queued and when it runs.
  await assertSafeConnectionString(connectionString, allowedHostsFromEnv());

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000, // guards against hanging on a locked/huge table
  });

  // If connect() itself throws (bad credentials, network unreachable, etc.)
  // the pool was still created and holds open sockets/timers — without this
  // explicit cleanup on the failure path, every failed connection attempt
  // leaked a pool for the lifetime of the process.
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    await pool.end().catch(() => {});
    throw e;
  }

  try {
    const { rows: [meta] } = await client.query(`
      SELECT
        current_database()          AS database_name,
        current_user                AS connected_user,
        version()                   AS server_version,
        pg_size_pretty(pg_database_size(current_database())) AS database_size
    `);

    const { rows: schemas } = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY schema_name
    `);

    const { rows: enumRows } = await client.query(`
      SELECT t.typname AS enum_name,
             n.nspname AS schema_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      GROUP BY t.typname, n.nspname
      ORDER BY n.nspname, t.typname
    `);
    const enums = enumRows.map((e) => ({ schema: e.schema_name, name: e.enum_name, values: e.values }));

    const { rows: extRows } = await client.query(`
      SELECT extname, extversion FROM pg_extension ORDER BY extname
    `);

    const { rows: columnRows } = await client.query(`
      SELECT
        c.table_schema, c.table_name, c.column_name, c.ordinal_position,
        c.column_default, c.is_nullable, c.data_type, c.udt_name,
        c.character_maximum_length, c.numeric_precision, c.numeric_scale,
        col_description(
          ('"' || c.table_schema || '"."' || c.table_name || '"')::regclass::oid,
          c.ordinal_position
        ) AS column_comment
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);

    const { rows: pkRows } = await client.query(`
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position
    `);

    const { rows: fkRows } = await client.query(`
      SELECT
        tc.constraint_name, tc.table_schema, tc.table_name, kcu.column_name,
        ccu.table_schema AS foreign_table_schema, ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name, rc.update_rule, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY tc.table_schema, tc.table_name
    `);

    const { rows: uniqueRows } = await client.query(`
      SELECT tc.table_schema, tc.table_name, tc.constraint_name,
             array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'UNIQUE'
        AND tc.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      GROUP BY tc.table_schema, tc.table_name, tc.constraint_name
    `);

    // LEFT JOIN (not INNER) against pg_stat_user_indexes: a freshly created
    // index can theoretically be visible in pg_indexes a beat before its
    // stats row exists. An INNER JOIN would silently drop it from results
    // instead of showing it with zero stats.
    const { rows: indexRows } = await client.query(`
      SELECT
        i.schemaname,
        i.tablename,
        i.indexname,
        i.indexdef,
        COALESCE(s.idx_scan, 0)      AS idx_scan,
        COALESCE(s.idx_tup_read, 0)  AS idx_tup_read,
        COALESCE(s.idx_tup_fetch, 0) AS idx_tup_fetch
      FROM pg_indexes i
      LEFT JOIN pg_stat_user_indexes s
        ON s.schemaname = i.schemaname
       AND s.relname = i.tablename
       AND s.indexrelname = i.indexname
      WHERE i.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY i.schemaname, i.tablename, i.indexname
    `);

    const { rows: statRows } = await client.query(`
      SELECT schemaname AS schema_name, relname AS table_name,
             n_live_tup AS estimated_rows,
             pg_size_pretty(pg_total_relation_size(relid)) AS total_size
      FROM pg_stat_user_tables
      ORDER BY schemaname, relname
    `);

    const { rows: viewRows } = await client.query(`
      SELECT table_schema, table_name, view_definition
      FROM information_schema.views
      WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY table_schema, table_name
    `);

    const { rows: fnRows } = await client.query(`
      SELECT n.nspname AS schema_name, p.proname AS function_name,
             pg_get_function_result(p.oid) AS return_type,
             pg_get_function_arguments(p.oid) AS arguments,
             l.lanname AS language
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        AND p.prokind IN ('f','p')
      ORDER BY n.nspname, p.proname
    `);

    const { rows: checkRows } = await client.query(`
      SELECT tc.table_schema, tc.table_name, tc.constraint_name, cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON cc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'CHECK'
        AND tc.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY tc.table_schema, tc.table_name
    `);

    // Build table map
    const tableMap = {};
    const tableStats = {};
    for (const s of statRows) {
      tableStats[`${s.schema_name}.${s.table_name}`] = {
        estimated_rows: Number(s.estimated_rows),
        total_size: s.total_size,
      };
    }

    for (const col of columnRows) {
      const key = `${col.table_schema}.${col.table_name}`;
      if (!tableMap[key]) {
        tableMap[key] = {
          schema: col.table_schema,
          name: col.table_name,
          columns: [],
          primary_keys: [],
          foreign_keys: [],
          unique_constraints: [],
          indexes: [],
          check_constraints: [],
          sample_rows: [],
          row_shape: {},
          ...(tableStats[key] || {}),
        };
      }

      const isStorageCol =
        /url|path|file|image|photo|avatar|attachment|blob|bucket|key|media|upload/i.test(col.column_name) &&
        /text|varchar|char/.test(col.data_type);

      tableMap[key].columns.push({
        name: col.column_name,
        position: col.ordinal_position,
        type: col.data_type,
        udt: col.udt_name,
        nullable: col.is_nullable === "YES",
        default: col.column_default,
        max_length: col.character_maximum_length,
        precision: col.numeric_precision,
        scale: col.numeric_scale,
        comment: col.column_comment,
        is_storage_reference: isStorageCol || false,
      });
    }

    for (const pk of pkRows) {
      const key = `${pk.table_schema}.${pk.table_name}`;
      if (tableMap[key]) tableMap[key].primary_keys.push(pk.column_name);
    }

    for (const fk of fkRows) {
      const key = `${fk.table_schema}.${fk.table_name}`;
      if (tableMap[key]) {
        tableMap[key].foreign_keys.push({
          constraint: fk.constraint_name,
          column: fk.column_name,
          references: {
            schema: fk.foreign_table_schema,
            table: fk.foreign_table_name,
            column: fk.foreign_column_name,
          },
          on_update: fk.update_rule,
          on_delete: fk.delete_rule,
        });
      }
    }

    for (const uq of uniqueRows) {
      const key = `${uq.table_schema}.${uq.table_name}`;
      if (tableMap[key]) {
        tableMap[key].unique_constraints.push({ name: uq.constraint_name, columns: uq.columns });
      }
    }

    for (const idx of indexRows) {
      const key = `${idx.schemaname}.${idx.tablename}`;
      if (tableMap[key]) {
        tableMap[key].indexes.push({
          name: idx.indexname,
          definition: idx.indexdef,
          stats: {
            scans: Number(idx.idx_scan),
            tuples_read: Number(idx.idx_tup_read),
            tuples_fetched: Number(idx.idx_tup_fetch),
          },
        });
      }
    }

    for (const ck of checkRows) {
      const key = `${ck.table_schema}.${ck.table_name}`;
      if (tableMap[key]) {
        tableMap[key].check_constraints.push({ name: ck.constraint_name, clause: ck.check_clause });
      }
    }

    // Sample rows — run with bounded concurrency via the pool (not the single
    // metadata `client`, so these queries can actually run in parallel; a
    // single Client can only run one query at a time regardless of await
    // ordering).
    await mapWithConcurrency(Object.values(tableMap), SAMPLE_CONCURRENCY, async (tbl) => {
      try {
        const { rows: samples } = await pool.query(
          `SELECT * FROM "${tbl.schema}"."${tbl.name}" LIMIT ${SAMPLE_LIMIT}`
        );
        tbl.sample_rows = samples.map(redactRow);
        const shapes = samples.map((r) => {
          const shape = {};
          for (const [k, v] of Object.entries(r)) shape[k] = describeValue(v);
          return shape;
        });
        tbl.row_shape = shapes.reduce((acc, s) => {
          const merged = { ...acc };
          for (const k of Object.keys(s)) {
            if (!(k in merged)) merged[k] = s[k];
          }
          return merged;
        }, {});
      } catch {
        tbl.sample_rows = [];
        tbl.row_shape = {};
      }
    });

    const relationshipGraph = [];
    for (const tbl of Object.values(tableMap)) {
      for (const fk of tbl.foreign_keys) {
        relationshipGraph.push({
          from: `${tbl.schema}.${tbl.name}`,
          from_column: fk.column,
          to: `${fk.references.schema}.${fk.references.table}`,
          to_column: fk.references.column,
          on_delete: fk.on_delete,
        });
      }
    }

    const storageColumns = [];
    for (const tbl of Object.values(tableMap)) {
      for (const col of tbl.columns) {
        if (col.is_storage_reference) {
          storageColumns.push({ table: `${tbl.schema}.${tbl.name}`, column: col.name, type: col.type });
        }
      }
    }

    return {
      metadata: {
        ...meta,
        schemas: schemas.map((s) => s.schema_name),
        extensions: extRows,
        total_tables: Object.keys(tableMap).length,
        total_views: viewRows.length,
        total_functions: fnRows.length,
        total_enums: enums.length,
      },
      enums,
      tables: Object.values(tableMap),
      views: viewRows.map((v) => ({
        schema: v.table_schema,
        name: v.table_name,
        definition: v.view_definition?.trim(),
      })),
      functions: fnRows.map((f) => ({
        schema: f.schema_name,
        name: f.function_name,
        return_type: f.return_type,
        arguments: f.arguments,
        language: f.language,
      })),
      relationship_graph: relationshipGraph,
      storage_columns: storageColumns,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { inspectPostgres };