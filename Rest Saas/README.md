# Rest Saas

A multi-tenant SaaS backend around the ingestion engine: it inspects a
tenant's Postgres/MongoDB database, object storage, and GitHub repo, then
distills all of it into a single `claude_context` payload sized for a
coding model, plus a unified architecture graph.

## Requirements

- Python 3.11+
- Node.js 18+
- npm
- **Redis** — backs the async ingestion job queue (Django-RQ) and the
  rate-limit cache. Nothing in `/api/ingestion/run/` works without it.
  Options: Docker (`docker run -p 6379:6379 redis`), WSL2 (`redis-server`),
  or [Memurai](https://www.memurai.com/) for native Windows.
- Postgres, for anything beyond local dev (see step 5) — SQLite is a
  single-process fallback only.

## 1) Clone and enter the project

```bash
git clone <your-repo-url>
cd Rest Saas
```

## 2) Create and activate a virtual environment

On Windows:

```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
```

On macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 3) Install Python dependencies

```bash
pip install -r requirements.txt
```

## 4) Install Node dependencies

```bash
cd ingestion/ingestion-engine
npm install
cd ../..
```

## 5) Configure environment variables

```bash
copy .env.example .env
```

At minimum, set `DJANGO_SECRET_KEY`, `FIELD_ENCRYPTION_KEY`, and
`TRANSIT_PRIVATE_KEY` (generation commands are in the comments in
`.env.example`). Everything else has a working local default except the
GitHub App block (step 8) and Google OAuth (optional — "Continue with
Google" returns 503 until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set;
see `.env.example` for where to get them).

## 6) Run database migrations

```bash
python manage.py migrate
```

## 7) Start Redis, the app server, and the job worker

Three processes, each in its own terminal:

```bash
redis-server                                   # or your Docker/Memurai/Upstash equivalent
python manage.py runserver                     # Django + DRF API
python manage.py rqworker ingestion             # runs actual ingestion jobs
```

`POST /api/ingestion/run/` returns 202 immediately with a job id — the
worker process above is what actually spawns the Node inspector and does
the work. Without it running, jobs stay `pending` forever.

**On Windows**, the plain `rqworker` command crashes on the first job with
`AttributeError: module 'os' has no attribute 'fork'` — RQ's default worker
forks a child process per job, and Windows has no `fork()`. Use RQ's
non-forking worker instead:

```bash
python manage.py rqworker ingestion --worker-class rq.worker.SimpleWorker
```

(Linux/macOS don't need this flag — the default worker works there.)

## 8) (Optional) Set up the GitHub App

GitHub access is App-based, not a pasted personal access token: each user
installs the App on exactly the repos they choose, and a short-lived
installation token is minted server-side per ingestion run — nothing
long-lived is ever stored. Creating the App itself is a one-time, per-
deployment step:

1. Log in as any user and hit `GET /api/integrations/github/manifest/` in a
   browser (not curl — it auto-submits a form to github.com). Requires
   `GITHUB_APP_BASE_URL` in `.env` to be reachable by your browser (an
   ngrok/tunnel URL is fine for local dev).
2. Approve the App on github.com. It redirects back and shows the App's
   `id`/private key/secrets once.
3. Paste them into `.env` (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, etc.)
   and restart the server.

After that, any user can connect their own GitHub account from the
Connections page.

## API overview

All endpoints below require `Authorization: Token <key>` except
`/api/auth/register/`, `/api/auth/login/`, the OAuth login-start/callback
endpoints, and `/healthz`/`/readyz`.

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Liveness — process is up, no dependency checks |
| `GET /readyz` | Readiness — database + Redis reachability, 503 if either is down |
| `POST /api/auth/register/`, `/login/`, `/logout/`, `GET /me/` | Username/password accounts |
| `GET /api/auth/google/login-url/`, `/callback/` | "Continue with Google" (503 until configured — see step 5) |
| `GET /api/crypto/public-key/` | RSA public key the frontend encrypts connection credentials with client-side before sending |
| `POST/GET /api/connections/`, `DELETE /api/connections/<id>/` | Encrypted, reusable Postgres/Mongo/storage connections (credentials never echoed back) |
| `GET /api/integrations/github/login-url/`, `/login-callback/` | "Continue with GitHub" — combined login + first-install |
| `GET /api/integrations/github/install-url/`, `/callback/` | Install the GitHub App on additional repos (already-logged-in user) |
| `GET/DELETE /api/integrations/github/installations/` | List/revoke GitHub installs |
| `POST /api/integrations/github/webhook/` | GitHub App lifecycle events (signature-verified) |
| `POST /api/ingestion/run/` | Enqueue an ingestion job (202 + job id); rate-limited per user |
| `GET /api/ingestion/jobs/<id>/` | Poll job status/progress |
| `GET /api/ingestion/` | List your saved contexts |
| `GET /api/ingestion/<id>/` | Full saved context |
| `GET /api/ingestion/<id>/claude-context/` | The distilled, LLM-ready payload — `?task=<text>` scopes it to a task, `?max_tokens=<int>` enforces a hard token budget |
| `GET /api/ingestion/<id>/freshness/` | Live drift check against the original sources |
| `GET /api/ingestion/<id>/diff/` | Structural diff against the previous run of the same project |
| `GET /api/audit-log/` | Your own audit trail |

### Example: register, connect Postgres, run an ingestion

```bash
curl -X POST http://127.0.0.1:8000/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "a-strong-password"}'
# => {"token": "...", "user": {...}}

curl -X POST http://127.0.0.1:8000/api/connections/ \
  -H "Authorization: Token <token>" -H "Content-Type: application/json" \
  -d '{"name": "prod-db", "kind": "postgres", "config": {"postgres_url": "postgresql://user:pass@host:5432/db"}}'
# => {"id": "<connection-id>", ...}   -- config is never echoed back

curl -X POST http://127.0.0.1:8000/api/ingestion/run/ \
  -H "Authorization: Token <token>" -H "Content-Type: application/json" \
  -d '{"postgres_connection_id": "<connection-id>"}'
# => 202 {"job_id": "...", "status": "pending", "status_url": "..."}
```

## Running tests

```bash
pip install -r requirements-dev.txt
pytest
```

Uses `pytest-django`; the test database is created/destroyed automatically
and never touches your real `db.sqlite3`/`DATABASE_URL`. Current coverage:
account registration/login correctness, the auth rate limits, and a full
two-user adversarial tenancy/IDOR suite (`ingestion/tests_tenancy.py`) —
every ownership-scoped endpoint is checked against a second user trying to
read/modify/delete the first user's data by id, including ids smuggled
inside a POST body rather than the URL.

## Security notes

- Credentials are encrypted **in the browser** (AES-256-GCM, wrapped with
  an RSA-OAEP public key served from `/api/crypto/public-key/`) before the
  connection-create request is even sent, then encrypted again at rest
  server-side (Fernet, `FIELD_ENCRYPTION_KEY`) — app-level envelope
  encryption, swappable for a real KMS later without a schema change. See
  `core/transit_crypto.py` for what this does and doesn't guarantee (the
  server still has to see the plaintext momentarily to actually run an
  ingestion — no architecture where the server dials into your database
  *and* never sees the credential can claim otherwise).
- `postgres_url`/`mongo_url`/storage endpoints are checked against an SSRF
  guard (both Python pre-flight and a Node-side re-check right before
  connecting) before anything dials out — private/loopback/link-local/
  metadata addresses are rejected unless explicitly trusted via
  `SSRF_ALLOWED_HOSTS`.
- Every ingestion/connection/job endpoint is scoped to `request.user`; a
  non-owned id 404s rather than 403ing, so it can't be used to probe for
  the existence of someone else's data. Mechanically verified by
  `ingestion/tests_tenancy.py` (see "Running tests" above), not just
  asserted.
- `/api/ingestion/run/` is rate-limited per user (`INGESTION_RATE_LIMIT`,
  default 20/hour). `/api/auth/login/` and `/api/auth/register/` are
  rate-limited per IP (`AUTH_LOGIN_RATE_LIMIT`, default 10/min;
  `AUTH_REGISTER_RATE_LIMIT`, default 10/hour) — added 2026-09-28 after a
  production-readiness audit found both were previously unthrottled.
