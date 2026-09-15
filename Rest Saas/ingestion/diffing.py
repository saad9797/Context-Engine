"""
Versioning / diffing (roadmap.md P5).

IngestionContext rows are already never overwritten — each run creates a
new one. What's missing is knowing which past run is "the same project" as
a new one, and a structural (not raw-JSON) diff between them: tables/
collections/routes/key files added or removed, columns that changed type —
the things a human or a re-run trigger actually cares about, not every
timestamp or sample-data difference.
"""

from .models import IngestionJob


def _project_identity(connection_refs: dict):
    """A tuple identifying "the same source" across runs, or None if the
    refs don't carry enough to say. GitHub identity is (owner, repo) —
    deliberately not the installation_id, since re-installing the App
    shouldn't count as a different project. DB identity is the connection
    id itself — the same saved connection is as close to "same database" as
    we can claim without hashing the DSN."""
    if not connection_refs:
        return None
    owner = connection_refs.get("github_owner")
    repo = connection_refs.get("github_repo")
    if owner and repo:
        return ("github", owner.lower(), repo.lower())
    if connection_refs.get("postgres_connection_id"):
        return ("postgres", connection_refs["postgres_connection_id"])
    if connection_refs.get("mongo_connection_id"):
        return ("mongo", connection_refs["mongo_connection_id"])
    return None


def find_previous_context(context, user):
    """The most recent OTHER saved context that looks like the same
    project as `context`, or None. Only ever searches the same user's own
    contexts."""
    job = IngestionJob.objects.filter(result_id=context.id, user=user).first()
    if job is None:
        return None
    identity = _project_identity(job.connection_refs or {})
    if identity is None:
        return None

    candidate_jobs = (
        IngestionJob.objects.filter(user=user, status="succeeded")
        .exclude(result_id=context.id)
        .exclude(result__isnull=True)
        .select_related("result")
        .order_by("-result__created_at")
    )
    for candidate in candidate_jobs:
        if candidate.result.created_at >= context.created_at:
            continue  # only look backward in time
        if _project_identity(candidate.connection_refs or {}) == identity:
            return candidate.result
    return None


def _pg_tables_by_name(database):
    return {
        f'{t.get("schema", "")}.{t.get("name", "")}'.strip("."): t
        for t in (database or {}).get("tables") or []
    }


def _diff_postgres(old, new):
    old_tables = _pg_tables_by_name(old)
    new_tables = _pg_tables_by_name(new)
    added = sorted(set(new_tables) - set(old_tables))
    removed = sorted(set(old_tables) - set(new_tables))
    changed = []
    for name in sorted(set(old_tables) & set(new_tables)):
        old_cols = {c.get("name"): c.get("type") for c in old_tables[name].get("columns") or []}
        new_cols = {c.get("name"): c.get("type") for c in new_tables[name].get("columns") or []}
        col_added = sorted(set(new_cols) - set(old_cols))
        col_removed = sorted(set(old_cols) - set(new_cols))
        type_changed = sorted(
            col for col in (set(old_cols) & set(new_cols)) if old_cols[col] != new_cols[col]
        )
        if col_added or col_removed or type_changed:
            changed.append({
                "table": name,
                "columns_added": col_added,
                "columns_removed": col_removed,
                "columns_type_changed": [
                    {"column": c, "from": old_cols[c], "to": new_cols[c]} for c in type_changed
                ],
            })
    if not (added or removed or changed):
        return None
    return {"tables_added": added, "tables_removed": removed, "tables_changed": changed}


def _mongo_collections_by_name(mongo_db):
    return {
        f'{c.get("database", "")}.{c.get("name", "")}'.strip("."): c
        for c in (mongo_db or {}).get("collections") or []
    }


def _diff_mongo(old, new):
    old_cols = _mongo_collections_by_name(old)
    new_cols = _mongo_collections_by_name(new)
    added = sorted(set(new_cols) - set(old_cols))
    removed = sorted(set(old_cols) - set(new_cols))
    changed = []
    for name in sorted(set(old_cols) & set(new_cols)):
        old_fields = set((old_cols[name].get("schema_shape") or {}).keys())
        new_fields = set((new_cols[name].get("schema_shape") or {}).keys())
        field_added = sorted(new_fields - old_fields)
        field_removed = sorted(old_fields - new_fields)
        if field_added or field_removed:
            changed.append({
                "collection": name,
                "fields_added": field_added,
                "fields_removed": field_removed,
            })
    if not (added or removed or changed):
        return None
    return {"collections_added": added, "collections_removed": removed, "collections_changed": changed}


def _diff_codebase(old, new):
    old_routes = set((old or {}).get("api_generation_hints", {}).get("existing_route_patterns") or [])
    new_routes = set((new or {}).get("api_generation_hints", {}).get("existing_route_patterns") or [])
    # api_generation_hints lives at the top level of claude_context, not
    # under codebase — callers pass the whole claude_context-shaped dict in.
    routes_added = sorted(new_routes - old_routes)
    routes_removed = sorted(old_routes - new_routes)

    def _file_paths(codebase):
        paths = set()
        for files in ((codebase or {}).get("key_files_by_role") or {}).values():
            for f in files or []:
                paths.add(f.get("path"))
        return paths

    old_files = _file_paths((old or {}).get("codebase"))
    new_files = _file_paths((new or {}).get("codebase"))
    files_added = sorted(new_files - old_files)
    files_removed = sorted(old_files - new_files)

    if not (routes_added or routes_removed or files_added or files_removed):
        return None
    return {
        "routes_added": routes_added,
        "routes_removed": routes_removed,
        "key_files_added": files_added,
        "key_files_removed": files_removed,
    }


def diff_contexts(old_data: dict, new_data: dict) -> dict:
    """Structural diff between two IngestionContext.data payloads. Only
    includes sections where something actually differs; an empty dict back
    means no meaningful shape change (timestamps/sample data aren't
    compared)."""
    result = {}
    pg = _diff_postgres(old_data.get("database"), new_data.get("database"))
    if pg:
        result["database"] = pg
    mongo = _diff_mongo(old_data.get("mongo_database"), new_data.get("mongo_database"))
    if mongo:
        result["mongo_database"] = mongo
    codebase = _diff_codebase(old_data, new_data)
    if codebase:
        result["codebase"] = codebase
    return result
