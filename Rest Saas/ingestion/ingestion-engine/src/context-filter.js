"use strict";

/**
 * Distills the raw, verbose ingestion context down to what an LLM actually
 * needs to generate production-ready code (APIs, DB migrations, frontend
 * types/forms). This is the piece that makes the ingestion engine useful:
 * the raw context answers "what's in this project", the claude_context
 * answers "what does a code-generation model need to see to act on it".
 *
 * Cuts, specifically:
 *  - Extension-internal DB functions (pgvector's ~115 C functions etc.) —
 *    keep only user-authored SQL/PLpgSQL functions.
 *  - Index/query scan statistics — operationally useful, irrelevant to codegen.
 *  - Sample rows/documents down to 2 — enough to infer shape and value format.
 *  - Blob storage listings down to a few example keys per container, since
 *    the *naming pattern* (e.g. "{userId}/applications/{appId}/{file}") is
 *    what's useful for building upload/download endpoints, not every file.
 *  - Duplicate representations of the same fact (row_shape vs sample_rows).
 */

const MAX_SAMPLE_ROWS = 2;
const MAX_BLOB_EXAMPLES = 3;
const MAX_FOLDER_EXAMPLES = 10;

// ─── Postgres ───────────────────────────────────────────────────────────────

function filterColumn(col) {
  const out = {
    name: col.name,
    type: col.type,
    nullable: col.nullable,
  };
  if (col.default) out.default = col.default;
  if (col.max_length) out.max_length = col.max_length;
  if (col.is_storage_reference) out.is_storage_reference = true;
  if (col.comment) out.comment = col.comment;
  return out;
}

function filterPostgresTable(table) {
  return {
    schema: table.schema,
    name: table.name,
    columns: table.columns.map(filterColumn),
    primary_keys: table.primary_keys,
    foreign_keys: table.foreign_keys.map((fk) => ({
      column: fk.column,
      references: `${fk.references.schema}.${fk.references.table}.${fk.references.column}`,
      on_delete: fk.on_delete,
    })),
    unique_constraints: table.unique_constraints.map((u) => u.columns),
    // Drop scan stats; keep only which columns are indexed and how.
    indexed_columns: table.indexes
      .filter((i) => !i.name.endsWith("_pkey"))
      .map((i) => ({ name: i.name, unique: /UNIQUE INDEX/.test(i.definition) })),
    check_constraints: table.check_constraints
      .filter((c) => !/_not_null$/.test(c.name)) // NOT NULL is already in `nullable`
      .map((c) => c.clause),
    estimated_rows: table.estimated_rows,
    sample_rows: (table.sample_rows || []).slice(0, MAX_SAMPLE_ROWS),
  };
}

// Extension-internal functions (pgvector, postgis, etc. — always language
// "c") are never something an API needs to call directly; only user-authored
// SQL/PLpgSQL functions are candidates for RPC-style endpoints.
function filterPostgresFunctions(functions) {
  return (functions || [])
    .filter((f) => f.language === "sql" || f.language === "plpgsql")
    .map((f) => ({
      schema: f.schema,
      name: f.name,
      return_type: f.return_type,
      arguments: f.arguments,
    }));
}

function filterDatabase(database) {
  if (!database) return null;
  return {
    dialect: "postgres",
    database_name: database.metadata.database_name,
    server_version: database.metadata.server_version?.split(" ")[0],
    schemas: database.metadata.schemas,
    extensions: (database.metadata.extensions || []).map((e) => e.extname),
    tables: database.tables.map(filterPostgresTable),
    views: database.views,
    functions: filterPostgresFunctions(database.functions),
    relationship_graph: database.relationship_graph,
    storage_columns: database.storage_columns,
  };
}

// ─── MongoDB ────────────────────────────────────────────────────────────────

function filterMongoCollection(col) {
  return {
    name: col.name,
    database: col.database,
    estimated_documents: col.estimated_documents,
    schema_shape: col.schema_shape,
    indexes: col.indexes.map((i) => ({ name: i.name, keys: i.keys, unique: i.unique })),
    reference_fields: col.reference_fields,
    storage_fields: col.storage_fields,
    sample_documents: (col.sample_documents || []).slice(0, MAX_SAMPLE_ROWS),
  };
}

function filterMongoDatabase(mongoDatabase) {
  if (!mongoDatabase) return null;
  return {
    dialect: "mongodb",
    scan_mode: mongoDatabase.scan_mode,
    database_name: mongoDatabase.metadata.database_name,
    scanned_databases: mongoDatabase.metadata.scanned_databases,
    collections: mongoDatabase.collections.map(filterMongoCollection),
    relationship_graph: mongoDatabase.relationship_graph,
    storage_columns: mongoDatabase.storage_columns,
  };
}

// ─── Object storage ─────────────────────────────────────────────────────────

function filterContainer(container) {
  return {
    name: container.name,
    public_access: container.properties?.publicAccess || "private",
    file_count_sampled: container.summary?.total_sampled ?? 0,
    approx_total_size_bytes: container.summary?.approx_total_size_bytes ?? 0,
    content_types: container.summary?.by_type || {},
    folders: (container.summary?.folders || [])
      .slice(0, MAX_FOLDER_EXAMPLES)
      .map((f) => f.name),
    // A few example keys are enough to infer the naming/path pattern —
    // don't ship every blob.
    example_keys: (container.blobs_sample || [])
      .slice(0, MAX_BLOB_EXAMPLES)
      .map((b) => b.key),
  };
}

function filterObjectStorage(objectStorage) {
  if (!objectStorage) return null;
  return {
    provider: objectStorage.provider,
    containers: (objectStorage.containers || []).map(filterContainer),
  };
}

// ─── Codebase ───────────────────────────────────────────────────────────────

// Above this many files, including the full nested tree would work against
// the whole point of a *distilled* context (it's meant to be prompt-sized).
// Past the cap, fall back to just the top-level layout with an honest
// truncated flag + the real total_files count, rather than silently
// dropping the tree or blowing past a sane prompt size.
const FILE_TREE_MAX_FILES_FOR_FULL_TREE = 600;

function filterCodebase(codebase) {
  if (!codebase) return null;
  const fileTree = codebase.file_tree;
  const truncated = !!fileTree && (fileTree.total_files || 0) > FILE_TREE_MAX_FILES_FOR_FULL_TREE;
  return {
    repository: codebase.repository && {
      full_name: codebase.repository.full_name,
      default_branch: codebase.repository.default_branch,
      language: codebase.repository.language,
    },
    stack: codebase.stack,
    // Real folder/file layout (not just a count) — lets code-gen see where
    // things actually live (e.g. "routes go in src/api/routes/") instead of
    // guessing a path convention from key_files_by_role alone.
    file_tree: fileTree && {
      total_files: fileTree.total_files,
      truncated,
      tree: truncated
        ? (fileTree.tree || []).map((n) =>
            n.type === "directory" ? { name: n.name, type: "directory", children: [] } : n
          )
        : fileTree.tree,
    },
    // Already curated upstream by the GitHub inspector (key files by role,
    // with content) — this is exactly what code-gen needs, pass through as-is.
    key_files_by_role: codebase.key_files_by_role,
    // Key names + inferred purpose only — never raw values, not even from
    // a "template" file (roadmap.md P4 / proposal §6.4, §9).
    env_vars: codebase.env_vars,
    branch_names: codebase.branch_names,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * @param {object} rawContext  The full context object produced by runIngestion()
 * @returns {object} A distilled context sized and shaped for LLM code generation
 */
function buildClaudeContext(rawContext) {
  return {
    project: rawContext._meta?.project || {},
    generated_at: rawContext._meta?.generated_at,
    sources: rawContext._meta?.sources,
    summary: rawContext.plain_english_summary || null,
    database: filterDatabase(rawContext.database),
    mongo_database: filterMongoDatabase(rawContext.mongo_database),
    object_storage: filterObjectStorage(rawContext.object_storage),
    object_storage_column_mapping: rawContext.object_storage_column_mapping,
    codebase: filterCodebase(rawContext.codebase),
    api_generation_hints: rawContext.api_generation_hints,
    // Already compact (no sample rows/blob listings) — passed through as-is
    // rather than re-filtered.
    architecture_graph: rawContext.architecture_graph,
  };
}

module.exports = { buildClaudeContext };