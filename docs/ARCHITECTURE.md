# Architecture

*Describes what actually exists, verified against the code as of 2026-09-28 — see `docs/PRODUCTION_READINESS.md` for the audit this was extracted from.*

## Components

```
                          ┌─────────────────────┐
                          │   Rest Saas Frontend │  React + Vite + MUI
                          │   (static build)     │  static, no server-side code
                          └──────────┬───────────┘
                                     │ REST (DRF TokenAuthentication)
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│  Rest Saas (Django + DRF)                                     │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────────┐   │
│  │ accounts  │  │ ingestion │  │ core                      │   │
│  │ register/ │  │ contexts, │  │ crypto.py (at-rest)       │   │
│  │ login,    │  │ connect-  │  │ transit_crypto.py (in-    │   │
│  │ Google    │  │ ions, jobs│  │   browser encryption)     │   │
│  │ OAuth     │  │ GitHub App│  │ network_guard.py (SSRF)   │   │
│  └───────────┘  │ scoping/  │  │ health.py                 │   │
│                  │ freshness/│  └──────────────────────────┘   │
│                  │ diffing   │                                  │
│                  └─────┬─────┘                                  │
└────────────────────────┼─────────────────────────────────────┘
                          │ enqueue (Django-RQ)
                          ▼
                  ┌───────────────┐        ┌─────────────┐
                  │  Redis        │◄──────►│ rqworker    │
                  │  (queue+cache)│        │ process     │
                  └───────────────┘        └──────┬──────┘
                                                    │ spawns per job
                                                    ▼
                                     ┌─────────────────────────────┐
                                     │ Node.js ingestion engine     │
                                     │ (ingestion-engine/run.js)    │
                                     │ Postgres/Mongo/S3/Azure/     │
                                     │ GitHub inspectors →          │
                                     │ context-filter → graph-      │
                                     │ builder → summary-builder    │
                                     └───────────────┬─────────────┘
                                                      │ JSON over stdout
                                                      ▼
                                          IngestionContext row (Postgres)

┌─────────────────────┐
│  mcp-server/         │  Node.js, stdio transport, @modelcontextprotocol/sdk
│  (runs on developer's │  Talks to the same REST API with the user's own
│   own machine)         │  DRF token — no separate auth system.
└─────────────────────┘
```

## Request lifecycle: running an ingestion

1. Browser POSTs `/api/ingestion/run/` with references to previously-saved `DataSourceConnection`/`GitHubAppInstallation` ids (never raw credentials — those were submitted once, at connection-creation time, encrypted client-side and server-side, and are never sent again).
2. `IngestionJobCreateView` verifies every referenced id belongs to `request.user` (this is the IDOR-prevention boundary — see `ingestion/tests_tenancy.py`), creates an `IngestionJob` row (`status="pending"`), enqueues `run_ingestion_job(job_id)` to the `ingestion` Django-RQ queue, and returns `202` immediately with the job id. The request thread never blocks on the actual work.
3. A separate `rqworker` process picks up the job, decrypts the referenced connections (`DataSourceConnection.get_config()`), mints a fresh short-lived GitHub installation token if a GitHub source is involved, runs the SSRF preflight (`core/network_guard.py`), and spawns the Node subprocess with the assembled config piped over stdin.
4. The Node process emits `PROGRESS::{json}` lines on stderr as it works through each configured source; `tasks.py` tails stderr on a background thread and updates `IngestionJob.stage`/`progress_pct` live, which the frontend polls every 2 seconds.
5. On success, the Node process's stdout (the full context JSON, including the distilled `claude_context`) is parsed and saved as a new `IngestionContext` row; the job is marked `succeeded` with a `result` FK to that row. On failure or timeout, the job is marked `failed` with a redacted error message (connection strings/tokens are pattern-scrubbed before being saved — see `_scrub()` in `tasks.py`).
6. The frontend, on seeing `status="succeeded"`, navigates to the saved context's detail view.

## Why a subprocess, not an in-process call

The ingestion engine is Node.js while the API is Python/Django — there's no shared runtime. A subprocess per job also gives a clean isolation boundary (a crash or resource blowup in one tenant's ingestion can't corrupt the Django process's memory) and a natural place to enforce the timeout/memory ceiling described in `PRODUCTION_READINESS.md` P1-7.

## Why Django-RQ over Celery

Not independently re-litigated in this audit — `roadmap.md`/prior planning already made this call and it works; RQ's simpler model (no separate broker beyond Redis, which the project needs anyway for caching) fit a solo-maintained project better than Celery's larger surface area.

## Data model (ownership boundary)

Every row that should be private to one user carries a `user` FK, and every corresponding view filters by `request.user` before doing anything else:

- `DataSourceConnection` — encrypted Postgres/Mongo/storage credentials
- `GitHubAppInstallation` — which GitHub App installation belongs to which user
- `GitHubIdentity` / `GoogleIdentity` — OAuth identity linking
- `IngestionJob` — one async run; `connection_refs` records *which* connections/installation were used (ids and non-secret fields only, never raw credentials)
- `IngestionContext` — one saved result; `schema_fingerprint` backs the freshness/drift check
- `AuditLogEntry` — append-only action log, `user` FK nullable (kept even if the user is later deleted)

A non-owned id 404s everywhere, never 403s — deliberate, so a UUID can't be used to probe for the existence of someone else's data (see the docstring in `ingestion/views.py`).
