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
