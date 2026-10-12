"""
Task-scoped context trimming (roadmap.md P2).

Takes an already-computed claude_context and a free-text task description,
and returns a trimmed version containing only the tables/collections/routes/
storage buckets/key files that look relevant to the task — plus anything
directly connected to a match in the architecture graph (so a matched table
doesn't lose its foreign-key neighbours).

Deliberately keyword/heuristic scoring, not embeddings — no vector DB, no
embedding cost, no retrieval-quality tuning to do before this is useful.
This is meant to get most of the value cheaply; if it visibly fails on real
repos, that's the signal to invest in something smarter, not a starting
assumption.

Entity identity (node names used here) is kept in lockstep with
ingestion-engine/src/graph-builder.js's node-naming scheme
(`schema.table`, `database.collection`, bare route pattern, bare bucket
name) so the 1-hop expansion can look entities up directly in
architecture_graph without a second identity scheme to keep in sync.
"""

import json
import re

STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
    "is", "are", "be", "this", "that", "i", "need", "want", "fix", "update",
    "updating", "add", "adding", "new", "my", "our", "it", "its", "please",
    "should", "would", "could", "make", "get", "getting", "some", "also",
}


def _keywords(text):
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_]*", (text or "").lower())
    out = set()
    for w in words:
        if w in STOPWORDS or len(w) < 3:
            continue
        out.add(w)
        # Cheap singularization so "emails"/"users" match "email"/"user"
        # column and table names without a real stemmer dependency.
        if w.endswith("ies") and len(w) > 4:
            out.add(w[:-3] + "y")
        elif w.endswith("es") and len(w) > 3:
            out.add(w[:-2])
        elif w.endswith("s") and len(w) > 3:
            out.add(w[:-1])
    return out


def _match_score(keywords, *fields):
    score = 0
    for field in fields:
        if not field:
            continue
        field_low = str(field).lower()
        for kw in keywords:
            if kw in field_low:
                score += 1
    return score


UPLOAD_KEYWORDS = {
    "upload", "uploads", "file", "files", "image", "images", "photo",
    "photos", "avatar", "attachment", "attachments", "blob", "media",
    "document", "documents", "storage",
}


def _score_entities(claude_context, keywords):
    """Returns (included, scores) — included is {kind: set(identity)},
    scores is {graph_node_id: match_count} for entities that matched
    directly (before 1-hop expansion).

    Inclusion is gated on the entity's own *name* matching a keyword —
    column/field names only add to the score magnitude (for future
    ranking), never trigger inclusion by themselves. Without this, a
    keyword as ordinary as "status" would match nearly every table in a
    normal schema purely because they all happen to have a status column,
    making the whole scope pass nearly a no-op. Matching on the name is a
    much stronger, much rarer signal that the task is actually about that
    entity.
    """
    included = {"tables": set(), "collections": set(), "routes": set(), "buckets": set(), "files": set()}
    scores = {}

    database = claude_context.get("database") or {}
    for table in database.get("tables") or []:
        name = f'{table.get("schema", "")}.{table.get("name", "")}'.strip(".")
        name_score = _match_score(keywords, table.get("name"))
        if name_score:
            col_names = " ".join(c.get("name", "") for c in table.get("columns") or [])
            included["tables"].add(name)
            scores[f"pg:{name}"] = name_score + _match_score(keywords, col_names)

    mongo = claude_context.get("mongo_database") or {}
    for col in mongo.get("collections") or []:
        db_tag = col.get("database") or ""
        key = f'{db_tag}.{col.get("name", "")}'.strip(".")
        name_score = _match_score(keywords, col.get("name"))
        if name_score:
            field_names = " ".join((col.get("schema_shape") or {}).keys())
            included["collections"].add(key)
            node_id = f"mongo:{db_tag}:{col.get('name')}" if db_tag else f"mongo:{col.get('name')}"
            scores[node_id] = name_score + _match_score(keywords, field_names)

    hints = claude_context.get("api_generation_hints") or {}
    for pattern in hints.get("existing_route_patterns") or []:
        s = _match_score(keywords, pattern)
        if s:
            included["routes"].add(pattern)
            scores[f"route:{pattern}"] = s

    storage = claude_context.get("object_storage") or {}
    if keywords & UPLOAD_KEYWORDS:
        for container in storage.get("containers") or []:
            if container.get("name"):
                included["buckets"].add(container["name"])

    codebase = claude_context.get("codebase") or {}
    for role, files in (codebase.get("key_files_by_role") or {}).items():
        for f in files or []:
            path_score = _match_score(keywords, f.get("path"))
            if path_score:
                included["files"].add(f.get("path"))
                scores[f"file:{f.get('path')}"] = path_score + _match_score(keywords, role)

    return included, scores


def _expand_one_hop(claude_context, included, scores):
    """Pull in anything directly connected in architecture_graph to a
    matched entity, so e.g. a matched `orders` table doesn't lose its
    `order_items` FK neighbour just because the task didn't name it."""
    graph = claude_context.get("architecture_graph") or {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    node_by_id = {n["id"]: n for n in nodes}
    matched_ids = set(scores.keys()) & set(node_by_id.keys())

    expanded_ids = set(matched_ids)
    for edge in edges:
        if edge.get("from") in matched_ids:
            expanded_ids.add(edge.get("to"))
        if edge.get("to") in matched_ids:
            expanded_ids.add(edge.get("from"))

    for node_id in expanded_ids - matched_ids:
        node = node_by_id.get(node_id)
        if not node:
            continue
        kind_map = {"table": "tables", "collection": "collections", "route": "routes", "bucket": "buckets"}
        bucket = kind_map.get(node.get("type"))
        if bucket:
            included[bucket].add(node.get("name"))

    return included


def score_context(claude_context, task):
    """Returns the `included` sets, or None if the task yielded no usable
    keywords or matched nothing at all (caller should fall back to the
    full context rather than return something empty or misleading)."""
    keywords = _keywords(task)
    if not keywords:
        return None

    included, scores = _score_entities(claude_context, keywords)
    if not scores:
        return None

    return _expand_one_hop(claude_context, included, scores)


def build_scoped_context(claude_context, task):
    """Returns a trimmed copy of claude_context, or None if scoping
    couldn't find anything relevant (caller should serve the full context
    instead — an empty/wrong scope is worse than an unscoped one)."""
    included = score_context(claude_context, task)
    if included is None:
        return None

    scoped = dict(claude_context)

    database = claude_context.get("database")
    if database:
        tables = [
            t for t in (database.get("tables") or [])
            if f'{t.get("schema", "")}.{t.get("name", "")}'.strip(".") in included["tables"]
        ]
        scoped["database"] = {**database, "tables": tables}

    mongo = claude_context.get("mongo_database")
    if mongo:
        collections = [
            c for c in (mongo.get("collections") or [])
            if f'{c.get("database", "")}.{c.get("name", "")}'.strip(".") in included["collections"]
        ]
        scoped["mongo_database"] = {**mongo, "collections": collections}

    storage = claude_context.get("object_storage")
    if storage:
        containers = [c for c in (storage.get("containers") or []) if c.get("name") in included["buckets"]]
        scoped["object_storage"] = {**storage, "containers": containers}

    codebase = claude_context.get("codebase")
    if codebase:
        key_files = {}
        for role, files in (codebase.get("key_files_by_role") or {}).items():
            matched = [f for f in files if f.get("path") in included["files"]]
            if matched:
                key_files[role] = matched
        # repository/stack/file_tree/env_vars stay as-is regardless of
        # task — cheap, and useful orientation context no matter what's
        # being built.
        scoped["codebase"] = {**codebase, "key_files_by_role": key_files}

    hints = claude_context.get("api_generation_hints")
    if hints:
        scoped["api_generation_hints"] = {
            **hints,
            "existing_route_patterns": [
                p for p in (hints.get("existing_route_patterns") or []) if p in included["routes"]
            ],
        }

    graph = claude_context.get("architecture_graph")
    if graph:
        type_key = {"table": "tables", "collection": "collections", "route": "routes", "bucket": "buckets"}
        keep_ids = {
            n["id"] for n in (graph.get("nodes") or [])
            if n.get("name") in included.get(type_key.get(n.get("type"), ""), set())
        }
        scoped["architecture_graph"] = {
            "nodes": [n for n in (graph.get("nodes") or []) if n["id"] in keep_ids],
            "edges": [
                e for e in (graph.get("edges") or [])
                if e.get("from") in keep_ids and e.get("to") in keep_ids
            ],
        }

    return scoped


def approx_tokens(obj):
    """Matches the frontend's existing chars/4 approximation (see
    ExampleComponent.jsx's rawTokensApprox) so numbers shown to a user are
    consistent regardless of whether they came from the API or the UI."""
    return round(len(json.dumps(obj)) / 4)


def _graph_degree(graph):
    """How many architecture-graph edges touch each node id — a cheap proxy
    for how structurally central an entity is (a table five others
    foreign-key into is more likely to matter to whatever's being built
    than one nothing references), used to decide what to cut first when a
    token budget forces trimming below what keyword scoping alone removed."""
    degree = {}
    for e in (graph or {}).get("edges") or []:
        degree[e.get("from")] = degree.get(e.get("from"), 0) + 1
        degree[e.get("to")] = degree.get(e.get("to"), 0) + 1
    return degree


def trim_to_budget(claude_context, max_tokens):
    """
    Enforces a hard token ceiling on top of whatever task scoping already
    did (or on the full context, if there was no task). Applied in order of
    how much information each cut loses relative to tokens it frees —
    cheapest, least-lossy cuts first, whole-entity removal only as a last
    resort:

      1. Sample rows/documents — shape is still visible from columns/
         schema_shape, just not example values.
      2. The file tree and long key-file contents — file *names*/roles
         usually matter more for a first pass than full source.
      3. Storage example keys/folder listings — illustrative, not structural.
      4. Whole tables/collections, least-connected first (see
         `_graph_degree`), stopping short of removing the very last table
         or collection entirely — an empty section reads as "this project
         has no database," which is worse than going slightly over budget.

    Returns (context, budget_applied) — budget_applied is False when the
    context was already under budget and nothing was touched.
    """
    if not max_tokens or max_tokens <= 0:
        return claude_context, False
    if approx_tokens(claude_context) <= max_tokens:
        return claude_context, False

    # Cheap deep copy — callers pass a dict that may be reused/returned
    # elsewhere (e.g. the unscoped claude_context cached on the model), and
    # every cut below mutates in place.
    result = json.loads(json.dumps(claude_context))

    for table in (result.get("database") or {}).get("tables") or []:
        table["sample_rows"] = []
    for col in (result.get("mongo_database") or {}).get("collections") or []:
        col["sample_documents"] = []
    if approx_tokens(result) <= max_tokens:
        return result, True

    codebase = result.get("codebase")
    if codebase and codebase.get("file_tree"):
        codebase["file_tree"] = {
            "total_files": codebase["file_tree"].get("total_files"),
            "truncated": True,
            "tree": [],
        }
    if approx_tokens(result) <= max_tokens:
        return result, True

    if codebase:
        for files in (codebase.get("key_files_by_role") or {}).values():
            for f in files:
                if f.get("content") and len(f["content"]) > 800:
                    f["content"] = f["content"][:800] + "\n… (truncated for token budget)"
    if approx_tokens(result) <= max_tokens:
        return result, True

    for container in (result.get("object_storage") or {}).get("containers") or []:
        container["example_keys"] = []
        container["folders"] = (container.get("folders") or [])[:3]
    if approx_tokens(result) <= max_tokens:
        return result, True

    tables = (result.get("database") or {}).get("tables") or []
    collections = (result.get("mongo_database") or {}).get("collections") or []
    degree = _graph_degree(result.get("architecture_graph"))
    name_to_id = {n.get("name"): n.get("id") for n in (result.get("architecture_graph") or {}).get("nodes") or []}

    def importance(name):
        return degree.get(name_to_id.get(name), 0)

    candidates = sorted(
        [(importance(f'{t.get("schema","")}.{t.get("name","")}'.strip(".")), "table", f'{t.get("schema","")}.{t.get("name","")}'.strip(".")) for t in tables]
        + [(importance(f'{c.get("database","")}.{c.get("name","")}'.strip(".")), "collection", f'{c.get("database","")}.{c.get("name","")}'.strip(".")) for c in collections],
        key=lambda x: x[0],
    )
    remaining = {"table": len(tables), "collection": len(collections)}

    for _, kind, name in candidates:
        if approx_tokens(result) <= max_tokens:
            break
        if remaining[kind] <= 1:
            continue  # never drop the last table/collection outright
        _drop_entity(result, kind, name)
        remaining[kind] -= 1

    return result, True


def _drop_entity(result, kind, name):
    """
    Removes one table/collection *and* everything else in the payload that
    exists only to describe it: its architecture-graph node/edges and its
    api_generation_hints entry. Without this, dropping a table from
    `database.tables` left an orphaned node still sitting in
    architecture_graph and a still-full suggested_resources entry — on the
    real project this was tested against, those two alone accounted for
    over 25% of total tokens, so trimming only the table list barely moved
    the total at all.
    """
    if kind == "table":
        result["database"]["tables"] = [
            t for t in result["database"]["tables"]
            if f'{t.get("schema","")}.{t.get("name","")}'.strip(".") != name
        ]
    else:
        result["mongo_database"]["collections"] = [
            c for c in result["mongo_database"]["collections"]
            if f'{c.get("database","")}.{c.get("name","")}'.strip(".") != name
        ]

    graph = result.get("architecture_graph")
    if graph:
        node_type = "table" if kind == "table" else "collection"
        dropped_ids = {n["id"] for n in graph.get("nodes") or [] if n.get("type") == node_type and n.get("name") == name}
        if dropped_ids:
            graph["nodes"] = [n for n in graph["nodes"] if n["id"] not in dropped_ids]
            graph["edges"] = [
                e for e in graph.get("edges") or []
                if e.get("from") not in dropped_ids and e.get("to") not in dropped_ids
            ]

    hints = result.get("api_generation_hints")
    if hints and hints.get("suggested_resources"):
        source = "postgres" if kind == "table" else "mongo"
        bare_name = name.rsplit(".", 1)[-1]
        hints["suggested_resources"] = [
            r for r in hints["suggested_resources"]
            if not (r.get("source") == source and r.get("name") == bare_name)
        ]
