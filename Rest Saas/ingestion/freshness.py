"""
Freshness / drift detection (roadmap.md P3).

Two halves:
  - compute_stored_fingerprint(raw_context) — cheap hash of shape (table/
    column names+types for Postgres, collection names for Mongo, latest
    commit sha for GitHub) computed from data already extracted during a
    normal ingestion. Called once, right after a job succeeds.
  - check_live_fingerprint(connection_refs, user) — re-derives the same
    shape via new, deliberately lightweight, direct queries (bypassing the
    Node engine and its full sampling pass entirely) so a freshness check
    stays cheap regardless of how large the underlying database is.

Mongo's live check is coarser than the stored one (collection existence
only, not field-level) because field-level would require sampling
documents per collection — no longer "cheap". Documented, not hidden:
`details.mongo` degrades gracefully rather than reporting false drift.
"""

import hashlib
from urllib.parse import parse_qs, unquote, urlparse

import psycopg2
import requests
from pymongo import MongoClient

from core.network_guard import UnsafeHostError, assert_safe_url
from . import github_app
from .models import DataSourceConnection

CONNECT_TIMEOUT_SECONDS = 5


def _hash(parts) -> str:
    joined = "|".join(sorted(str(p) for p in parts))
    return hashlib.sha256(joined.encode()).hexdigest()[:16]


# ─── Stored fingerprint — from already-extracted ingestion output ──────────

def _stored_postgres(database):
    if not database or database.get("dialect") == "mysql":
        return None
    parts = []
    for table in database.get("tables") or []:
        schema = table.get("schema", "")
        name = table.get("name", "")
        for col in table.get("columns") or []:
            parts.append(f'{schema}.{name}.{col.get("name")}:{col.get("type")}')
    return _hash(parts) if parts else None


def _stored_mongo(mongo_db):
    if not mongo_db:
        return None
    parts = []
    for col in mongo_db.get("collections") or []:
        db = col.get("database", "")
        name = col.get("name", "")
        parts.append(f'{db}.{name}'.strip("."))
    return _hash(parts) if parts else None


def _stored_github(codebase):
    if not codebase:
        return None
    commits = codebase.get("recent_commits") or []
    return commits[0].get("sha") if commits else None


def compute_stored_fingerprint(raw_context: dict) -> dict:
    """raw_context is the full ingestion output (IngestionContext.data)."""
    return {
        "postgres": _stored_postgres(raw_context.get("database")),
        "mongo": _stored_mongo(raw_context.get("mongo_database")),
        "github": _stored_github(raw_context.get("codebase")),
    }


# ─── Live fingerprint — fresh, deliberately cheap re-check ─────────────────

class FreshnessCheckError(RuntimeError):
    """A live check couldn't complete (source unreachable, timed out,
    credentials revoked, etc). Distinct from "checked fine, no drift" —
    callers should surface this rather than silently treating it as
    drift-free."""


def _postgres_connect_kwargs(postgres_url: str) -> dict:
    """
    Builds explicit psycopg2 connect() kwargs instead of passing the raw
    URL as a DSN string. Real-world Postgres URLs (Neon's in particular)
    carry query params like `timezone=UTC` that Node's `pg` driver quietly
    ignores but libpq's strict DSN parser rejects outright as "invalid URI
    query parameter" — pulling out only the handful of parameters we
    actually need sidesteps that entirely instead of trying to maintain an
    allowlist of every param libpq happens to recognize.
    """
    parsed = urlparse(postgres_url)
    query = parse_qs(parsed.query)
    kwargs = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": (parsed.path or "/").lstrip("/") or None,
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
    }
    if parsed.username:
        kwargs["user"] = unquote(parsed.username)
    if parsed.password:
        kwargs["password"] = unquote(parsed.password)
    if "sslmode" in query:
        kwargs["sslmode"] = query["sslmode"][0]
    return kwargs


def _live_postgres(postgres_url: str) -> str:
    assert_safe_url(postgres_url)
    conn = psycopg2.connect(**_postgres_connect_kwargs(postgres_url))
    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = 5000")
            cur.execute(
                """
                SELECT table_schema, table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    parts = [f"{schema}.{table}.{col}:{dtype}" for schema, table, col, dtype in rows]
    return _hash(parts) if parts else None


def _live_mongo(mongo_url: str, db_name: str | None, scan_all: bool) -> str:
    assert_safe_url(mongo_url)
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=CONNECT_TIMEOUT_SECONDS * 1000)
    try:
        client.admin.command("ping")
        parts = []
        if scan_all:
            system_dbs = {"admin", "local", "config"}
            for name in client.list_database_names():
                if name.lower() in system_dbs:
                    continue
                for col in client[name].list_collection_names():
                    parts.append(f"{name}.{col}")
        else:
            db = client[db_name] if db_name else client.get_default_database()
            for col in db.list_collection_names():
                parts.append(f"{db.name}.{col}")
        return _hash(parts) if parts else None
    finally:
        client.close()


def _live_github(installation_id: int, owner: str, repo: str, branch: str | None) -> str:
    token = github_app.mint_installation_token(installation_id)["token"]
    resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/commits",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        params={"per_page": 1, **({"sha": branch} if branch else {})},
        timeout=10,
    )
    if resp.status_code != 200 or not resp.json():
        raise FreshnessCheckError(f"Could not fetch latest commit: {resp.status_code}")
    return resp.json()[0]["sha"][:8]


def check_live_fingerprint(connection_refs: dict, user) -> dict:
    """Returns {postgres, mongo, github} matching compute_stored_fingerprint's
    shape, using only the connections referenced in connection_refs (each
    still owned by `user` — re-checked here, not assumed from the original
    job). Raises FreshnessCheckError if a referenced source can't be reached
    at all; a missing/unset source is simply None, same as the stored side."""
    result = {"postgres": None, "mongo": None, "github": None}
    errors = {}

    pg_id = connection_refs.get("postgres_connection_id")
    if pg_id:
        conn = DataSourceConnection.objects.filter(id=pg_id, user=user, kind="postgres").first()
        if conn:
            try:
                result["postgres"] = _live_postgres(conn.get_config().get("postgres_url"))
            except (psycopg2.Error, UnsafeHostError, OSError) as e:
                errors["postgres"] = str(e)

    mongo_id = connection_refs.get("mongo_connection_id")
    if mongo_id:
        conn = DataSourceConnection.objects.filter(id=mongo_id, user=user, kind="mongo").first()
        if conn:
            cfg = conn.get_config()
            try:
                result["mongo"] = _live_mongo(
                    cfg.get("mongo_url"),
                    connection_refs.get("mongo_db_name") or cfg.get("mongo_db_name"),
                    bool(connection_refs.get("mongo_scan_all_databases")),
                )
            except (UnsafeHostError, OSError) as e:
                errors["mongo"] = str(e)

    installation_id = connection_refs.get("github_installation_id")
    if installation_id:
        installation = user.github_installations.filter(installation_id=installation_id).first()
        if installation:
            try:
                result["github"] = _live_github(
                    installation_id,
                    connection_refs.get("github_owner"),
                    connection_refs.get("github_repo"),
                    connection_refs.get("github_branch"),
                )
            except (github_app.GitHubAppError, requests.RequestException, FreshnessCheckError) as e:
                errors["github"] = str(e)

    if errors and not any(v is not None for v in result.values()):
        raise FreshnessCheckError("; ".join(f"{k}: {v}" for k, v in errors.items()))

    return result, errors


def compare_fingerprints(stored: dict, live: dict) -> dict:
    """{source: True|False|None} — None means one side has no data for that
    source (nothing to compare, not "unchanged")."""
    details = {}
    for key in ("postgres", "mongo", "github"):
        s, l = stored.get(key), live.get(key)
        if s is None or l is None:
            details[key] = None
        else:
            details[key] = s != l
    return details
