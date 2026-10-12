# Troubleshooting

*Real issues actually hit during this project's development, not a generic checklist.*

## "Could not reach http://localhost:8000/..." / a generic network error in the frontend

Almost never means the backend is actually down. The most common real cause: **a stale dev-server process from an earlier session is still squatting on port 5173**, forcing a freshly-started Vite instance onto 5174 instead — and the backend's `CORS_ALLOWED_ORIGINS` only trusts 5173/3000 by default, so the browser's CORS preflight silently blocks every request from the accidental 5174 origin. The symptom looks identical to "server is down" because a blocked-by-CORS fetch and a truly unreachable server both surface as the same generic network error.

**Fix:** check what's actually listening —
```bash
netstat -ano | grep -E ":(5173|5174|8000)\s" | grep LISTENING
```
Kill any stale/duplicate `node`/`python` processes (careful not to kill an MCP server process if one is intentionally running — check its command line first via `Get-WmiObject Win32_Process -Filter "ProcessId=<pid>"` on Windows), then start exactly one clean instance of each dev server.

## `AttributeError: module 'os' has no attribute 'fork'` when running `rqworker`

RQ's default worker forks a child process per job. Windows has no `fork()`. Always run the worker with `--worker-class rq.worker.SimpleWorker` on Windows (see `Rest Saas/README.md` step 7) — this is already the documented default command, but if you're running a bare `rqworker` from memory/habit, this is why it crashes on the first job.

## `psycopg2.OperationalError: invalid URI query parameter` against a Neon/managed Postgres URL

Some managed Postgres providers (Neon in particular) append query parameters (e.g. `&timezone=UTC`) to connection strings that Node's `pg` driver tolerates but libpq (which `psycopg2` binds to) rejects outright. If you see this from a *live freshness/drift check* specifically (not the ingestion engine itself, which uses `pg` via Node and doesn't have this problem), check `ingestion/freshness.py`'s `_postgres_connect_kwargs()` — it already works around this by manually parsing the URL instead of passing the raw DSN to psycopg2. If a *new* code path starts passing a raw DSN to psycopg2 directly, it will hit this again.

## 500 error with no traceback anywhere in the server log

`core/settings.py` hardcodes `DEBUG = False` (deliberately, not a mistake). Django's *default* console exception logging is filtered to `DEBUG=True` only (`django.utils.log.DEFAULT_LOGGING`'s console handler has `require_debug_true`) — so with `DEBUG=False` and no custom `LOGGING` config, every unhandled exception vanishes into nothing but a bare `500` status line. This project's `core/settings.py` already has a `LOGGING` override that restores console tracebacks regardless of `DEBUG` — if you're seeing this again, something removed that config.

## "Continue with GitHub" / "Continue with Google" fails with a connection-reset or timeout error

If the error message itself mentions `ConnectionResetError`, `Read timed out`, or similar (not a clean "GitHub login failed: ..." with a real API error inside it) — this is a **network-layer** problem between this machine and the OAuth provider, not a code bug. Specifically hit once in development where the machine's configured DNS servers turned out to be a content-filtering resolver (CleanBrowsing's Family Filter), which was intermittently resetting connections to `github.com`. Check your actual configured DNS:
```powershell
Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses.Count -gt 0}
```
If it's a filtering/parental-control DNS you didn't intentionally set, switching to a standard resolver (1.1.1.1, 8.8.8.8) is the fix — not a code change. The OAuth callback views already catch and surface `requests.exceptions.RequestException` cleanly (see `ingestion/github_app.py`'s `_request()` helper) rather than producing a raw 500, so if you're seeing a raw 500 instead of a clean error message here, that's a regression worth investigating separately.

## Playwright / headless-browser MCP tool won't connect

Every session in this project's history to date has had this tool fail with `CONNECT_TIMEOUT` — it has never successfully connected even once, meaning **no UI work in this project has ever been visually verified in an actual rendered browser**, only by code review. If you're relying on Claude to do visual QA, confirm the Playwright MCP server is actually reachable first (`/mcp` in an interactive session) rather than assuming prior "verified" claims in commit history mean a screenshot was actually taken.

## `ModuleNotFoundError: No module named 'corsheaders'` on a fresh clone

This was a real bug in `requirements.txt` (missing entry) found and fixed 2026-09-28 — if you're seeing this on a clone made *after* that fix, either you're on an old checkout or something reintroduced the gap. `django-cors-headers` must be in `requirements.txt` and pinned to a version that's actually installed — see the comment at the top of that file.
