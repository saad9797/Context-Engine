"use strict";

/**
 * Merges the four otherwise-disconnected pieces of a raw ingestion context
 * (Postgres tables, Mongo collections, storage containers, GitHub routes)
 * into one node/edge graph — the actual "see the whole architecture" surface
 * a frontend can render as a diagram, instead of four unrelated JSON trees.
 *
 * Shape: { nodes: [{id, type, name, meta}], edges: [{from, to, kind, meta}] }
 * type   ∈ table | collection | bucket | route
 * kind   ∈ fk | references | uploads_to
 *
 * Route→resource edges are inferred by matching path segments against known
 * table/collection names — GitHub route strings carry no structured link to
 * a DB resource, so this is best-effort, not ground truth.
 */

function buildArchitectureGraph(context) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();

  function addNode(node) {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const database = context.database;
  if (database) {
    for (const table of database.tables || []) {
      addNode({
        id: `pg:${table.schema}.${table.name}`,
        type: "table",
        name: `${table.schema}.${table.name}`,
        meta: {
          columns: (table.columns || []).length,
          estimated_rows: table.estimated_rows ?? null,
          primary_keys: table.primary_keys || [],
        },
      });
    }
    for (const rel of database.relationship_graph || []) {
      edges.push({
        from: `pg:${rel.from}`,
        to: `pg:${rel.to}`,
        kind: "fk",
        meta: { from_column: rel.from_column, to_column: rel.to_column, on_delete: rel.on_delete },
      });
    }
  }

  // Collection names alone aren't unique when scanning multiple databases
  // on one cluster (two databases can both have a "users" collection) — a
  // `database` tag on the entry (present whenever the inspector knows it)
  // namespaces the node id and display name so they don't collide.
  const mongoNodeId = (database, name) => (database ? `mongo:${database}:${name}` : `mongo:${name}`);
  const mongoDisplayName = (database, name) => (database ? `${database}.${name}` : name);

  const mongoDatabase = context.mongo_database;
  if (mongoDatabase) {
    for (const col of mongoDatabase.collections || []) {
      addNode({
        id: mongoNodeId(col.database, col.name),
        type: "collection",
        name: mongoDisplayName(col.database, col.name),
        meta: { estimated_documents: col.estimated_documents ?? null },
      });
    }
    for (const rel of mongoDatabase.relationship_graph || []) {
      edges.push({
        from: mongoNodeId(rel.database, rel.from),
        to: mongoNodeId(rel.database, rel.to),
        kind: "references",
        meta: { from_field: rel.from_field, is_array: rel.is_array, confidence: rel.confidence },
      });
    }
  }

  const objectStorage = context.object_storage;
  const storageNodeIdsByProvider = {};
  if (objectStorage) {
    for (const container of objectStorage.containers || []) {
      const id = `storage:${objectStorage.provider}:${container.name}`;
      addNode({
        id,
        type: "bucket",
        name: container.name,
        meta: {
          provider: objectStorage.provider,
          public_access: container.properties?.publicAccess || "private",
        },
      });
      (storageNodeIdsByProvider[objectStorage.provider] ||= []).push(id);
    }
  }

  // object_storage_column_mapping doesn't say *which* bucket a column's
  // values live in (that's not derivable from schema alone) — connect to
  // every bucket from the same provider as a best-effort link, rather than
  // guessing one.
  for (const mapping of context.object_storage_column_mapping || []) {
    const bucketIds = storageNodeIdsByProvider[mapping.storage_provider] || [];
    const sourceNodeId =
      mapping.source === "postgres"
        ? `pg:${mapping.table}`
        : mongoNodeId(mapping.database, mapping.collection);
    if (!nodeIds.has(sourceNodeId)) continue;
    for (const bucketId of bucketIds) {
      edges.push({
        from: sourceNodeId,
        to: bucketId,
        kind: "uploads_to",
        meta: { column: mapping.column || mapping.field, note: mapping.note },
      });
    }
  }

  const hints = context.api_generation_hints;
  if (hints) {
    const resourceNodeByName = new Map();
    for (const resource of hints.suggested_resources || []) {
      const nodeId =
        resource.source === "postgres"
          ? `pg:${resource.schema}.${resource.name}`
          : mongoNodeId(resource.database, resource.name);
      if (!nodeIds.has(nodeId)) continue;
      const name = resource.name.toLowerCase();
      resourceNodeByName.set(name, nodeId);
      resourceNodeByName.set(name.replace(/s$/, ""), nodeId);
    }

    for (const pattern of hints.existing_route_patterns || []) {
      const routeId = `route:${pattern}`;
      addNode({ id: routeId, type: "route", name: pattern, meta: {} });

      const segments = pattern.split("/").filter((s) => s && !s.startsWith(":"));
      for (const segment of segments) {
        const key = segment.toLowerCase();
        const matchId = resourceNodeByName.get(key) || resourceNodeByName.get(key.replace(/s$/, ""));
        if (matchId) {
          edges.push({ from: routeId, to: matchId, kind: "references", meta: {} });
        }
      }
    }
  }

  return { nodes, edges };
}

module.exports = { buildArchitectureGraph };
