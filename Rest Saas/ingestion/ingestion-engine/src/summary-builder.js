"use strict";

/**
 * Plain-English summary (roadmap.md P6) — a few sentences orienting a new
 * developer (or Claude, at the start of a session) to what a project
 * actually is, generated once per ingestion from data already extracted.
 *
 * Deliberately template-based, not an LLM call: no external API
 * dependency, no cost, no hallucination risk, and no credentials this
 * environment doesn't have configured. The roadmap floated calling Claude
 * for this; a well-structured template over already-verified facts is a
 * safer default; swap in a real generation call later if the templated
 * version turns out too mechanical for real users.
 */

// Internal bookkeeping tables an ORM/framework manages itself (migration
// history, job queues, cache, sessions) — real, but not what a developer
// means by "what tables does this app have", so they're excluded from the
// highlighted sample while still counting toward the total.
const INTERNAL_TABLE_PATTERN = /^_|migrations?$|^(django_|auth_|sessions?$|cache_table|knex_)/i;

function summarizeDatabase(database) {
  if (!database) return null;
  const tableCount = database.tables?.length || 0;
  if (!tableCount) return null;
  const featured = database.tables.filter((t) => !INTERNAL_TABLE_PATTERN.test(t.name));
  const topTables = (featured.length ? featured : database.tables).slice(0, 5).map((t) => t.name);
  const more = tableCount > topTables.length ? `, and ${tableCount - topTables.length} more` : "";
  return `PostgreSQL (${database.metadata?.database_name || "database"}) with ${tableCount} table${tableCount === 1 ? "" : "s"}, including ${topTables.join(", ")}${more}.`;
}

function summarizeMongo(mongoDatabase) {
  if (!mongoDatabase) return null;
  const collectionCount = mongoDatabase.collections?.length || 0;
  if (!collectionCount) return null;
  const scope =
    mongoDatabase.scan_mode === "all_databases"
      ? ` across ${mongoDatabase.metadata?.scanned_databases?.length || "several"} databases`
      : ` in ${mongoDatabase.metadata?.database_name || "one database"}`;
  const topCollections = mongoDatabase.collections.slice(0, 5).map((c) => c.name);
  return `MongoDB with ${collectionCount} collection${collectionCount === 1 ? "" : "s"}${scope} (${topCollections.join(", ")}${collectionCount > 5 ? ", …" : ""}).`;
}

function summarizeStorage(objectStorage) {
  if (!objectStorage) return null;
  const bucketCount = objectStorage.containers?.length || 0;
  if (!bucketCount) return null;
  return `File storage via ${objectStorage.provider} (${bucketCount} bucket${bucketCount === 1 ? "" : "s"}/container${bucketCount === 1 ? "" : "s"}).`;
}

function summarizeCodebase(codebase, hints) {
  if (!codebase?.repository) return null;
  const repo = codebase.repository;
  const frameworks = (codebase.stack?.frameworks || []).join("/");
  const language = repo.language || (codebase.stack?.languages || [])[0];
  let sentence = `${repo.full_name} is a${frameworks ? ` ${frameworks}` : ""}${language ? ` ${language}` : ""} project`;
  if (hints?.naming_convention) sentence += ` using ${hints.naming_convention} naming`;
  sentence += ".";

  const extra = [];
  if (hints?.auth_detected) extra.push("has authentication/authorization in place");
  if (hints?.existing_route_patterns?.length) {
    extra.push(`follows existing route conventions like ${hints.existing_route_patterns.slice(0, 3).join(", ")}`);
  }
  if (hints?.file_upload_endpoints_needed) extra.push("handles file uploads");
  if (extra.length) sentence += ` It ${extra.join(", ")}.`;
  return sentence;
}

function summarizeGraph(graph) {
  if (!graph || !graph.nodes?.length) return null;
  const byType = {};
  for (const n of graph.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  const parts = Object.entries(byType).map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`);
  return `The architecture graph connects ${parts.join(", ")} via ${graph.edges?.length || 0} relationship${graph.edges?.length === 1 ? "" : "s"}.`;
}

/**
 * @param {object} context  The full raw ingestion context (must already
 *   have architecture_graph and api_generation_hints computed).
 * @returns {string} 2-5 sentences, or "" if there's nothing to summarize
 *   (e.g. an ingestion that produced no data at all).
 */
function buildPlainEnglishSummary(context) {
  const sentences = [
    summarizeCodebase(context.codebase, context.api_generation_hints),
    summarizeDatabase(context.database),
    summarizeMongo(context.mongo_database),
    summarizeStorage(context.object_storage),
    summarizeGraph(context.architecture_graph),
  ].filter(Boolean);
  return sentences.join(" ");
}

module.exports = { buildPlainEnglishSummary };
