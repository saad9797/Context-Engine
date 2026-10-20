# Testable context-handoff release

The primary workflow is now a single task-specific JSON handoff. A trained
model is **not integrated or required**. This release uses static source
parsing, weighted lexical ranking and dependency traversal. No customer source
is sent to an AI provider by Contexa.

Use Node 22 LTS, version 22.12 or later (or Node 24 LTS), and run `npm ci`
in `Rest Saas Frontend` after pulling this release. The frontend toolchain is
Vite 8.3.4 / Vitest 5.0.5 / React plugin 6.1.2. The full npm audit is clean.

## Test the customer flow

With your existing local `.env` configured, start these in separate terminals
from the project root (PowerShell). Keep Redis available at the configured URL.
Apply the new saved-handoff migration first: in `Rest Saas`, run
`.\.venv\Scripts\python.exe manage.py migrate`.

```powershell
# Terminal 1: API
cd 'Rest Saas'
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000

# Terminal 2: frontend
cd 'Rest Saas Frontend'
npm run dev -- --host 127.0.0.1 --port 5173

# Terminal 3: needed for connected-source snapshots/rebuilds (not folder imports)
cd 'Rest Saas'
.\.venv\Scripts\python.exe manage.py rqworker ingestion --worker-class ingestion.workers.WindowsWorker
```

Open `http://127.0.0.1:5173`. Existing snapshots can generate handoffs without
the ingestion worker. Background server startup was blocked by automatic
approval review in the implementation session; these commands are provided
for the operator to run directly.

1. Under **Build a project snapshot**, choose a local folder, inspect the file
   preview/exclusions, and click **Create snapshot and prepare AI context**.
   Alternatively connect a repository and build/rebuild its snapshot. Source
   must be captured; database metadata cannot supply application contracts.
2. Open **Prepare AI packs**, describe the change and specify its interface,
   access rules, business rules and response expectations.
3. Review **Complete handoff**, its omissions and dependency warnings. Copy JSON,
   copy with instructions for AI chat, or download it. It works without a prior
   base pack and respects one estimated JSON budget.
4. If selected contracts do not fit, try the suggested budget or narrow the
   task. An `incomplete` handoff must not be presented as sufficient.
5. Paste into an AI chat. If it requests another contract, enter the exact
   symbol or `path#symbol` under **Additional symbols**, then prepare again.
   If its file was not captured, pin the file and rebuild: requested paths are
   prioritized within capture limits instead of repeating the same omission.
6. Apply generated changes through your usual review, compiler and tests.
7. Use **Save handoff** to keep the exact export, then record whether it helped
   or needed more context. **Browse saved handoffs** restores the original
   request, budget and export. Results are private user assessments, not an
   automated accuracy score. Saved exports can be deleted individually.

Folder imports accept 220 UTF-8 source/manifests, 128 KB per file, 2 MB total.
Credentials/generated/vendor files are excluded before browser reads and the
server validates paths and byte limits again. Known credential patterns are
redacted before storage; this is not an exhaustive secret scanner. Review the
source preview before upload. Oversized/excluded files remain visible in the
local review. For large repositories, select a focused folder or use GitHub
capture with explicit file pins. Reimport a folder to capture later changes.
Folder snapshots have a content digest, not an invented Git commit.

Each owner can keep 100 snapshots including active build reservations, at most
two simultaneous connected-source builds, and 30 saved handoffs per snapshot.
**Delete snapshot** in the context workspace removes it and its saved handoffs;
source connections stay connected. These limits apply in addition to throttles.

The handoff includes validation scripts declared in relevant `package.json`
files, their working directories and provenance. Scripts are never executed by
Contexa; review them and supply missing checks for stacks without captured
script declarations. Dependencies are detected from captured imports/manifests.
React JSX components, nested Python packages, FastAPI mounts and Next App Router
ancestor layouts/templates and middleware receive explicit dependency handling.
Unsupported/new grammar or absent requested contracts marks the handoff incomplete.

Large JS/TS/Python modules contribute complete top-level declarations or
statements with their needed original imports and source line locations.
Classes remain complete; arbitrary method fragments are not substituted.
Unshown declarations remain in the original module. Other source languages
use a reported whole-file fallback. Aliases use the closest captured tsconfig;
dynamic module loading, inherited framework behavior, generated code and
uncaptured source can still need explicit follow-up.

Reusable base and task-only tabs remain for long conversations. Task-only
copies require their matching base. Complete handoffs do not.

## Reproduce local validation

```powershell
cd 'Rest Saas'
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
cd ..
& '.\Rest Saas\.venv\Scripts\python.exe' docs/benchmarks/run_context_checks.py
cd 'Rest Saas Frontend'
npm test
npm run build
npm audit --omit=dev
```

Installer/runtime dependencies were updated after an environment audit found
advisories: PyJWT 2.15.0, PyMongo 4.18.2, sqlparse 0.6.0, urllib3 2.8.0,
pip 26.2 and setuptools 83.0.0. Pinned build tooling is installed in Docker as
well as development; audit evidence is under `docs/benchmarks/`.

See [benchmark scope and results](benchmarks/README.md). Controlled checks and
two public apps pass at their stated budgets; this is not a broad generated-code
success claim. Live provider login, real MySQL, deployed mobile/browser tests,
backup restoration and an independent coding-model trial remain environment-
dependent release checks. The previous trained model showed no held-out gain
and is not silently enabled.

## Deploy the backend and worker

`Rest Saas/Dockerfile` uses Node 22, runs as an unprivileged user and excludes
local secrets/data through `.dockerignore`. Docker is unavailable on this
workstation; the image-build/smoke job in CI must pass before deployment.

Copy `docs/production.env.example` to `Rest Saas/.env.production` and fill real
values through your secret manager. Use fresh keys for a new deployment;
preserve existing encryption keys when upgrading a deployment with saved
connections. Configure external PostgreSQL and Redis and a TLS reverse proxy.
The proxy must discard client-supplied `X-Forwarded-Proto` and set it itself;
the production profile trusts that header. API port 8000 is bound to loopback
in the supplied compose file and should not be exposed around the proxy.

```sh
docker compose -f compose.production.yml build
docker compose -f compose.production.yml run --rm web python manage.py check --deploy
docker compose -f compose.production.yml run --rm web python manage.py migrate
docker compose -f compose.production.yml up -d
```

The production settings profile rejects SQLite, local-only/wildcard hosts,
short placeholder Django secrets and non-HTTPS public URLs. It enables HTTPS
redirects, HSTS, secure cookies, framing protection and nosniff. Review Django's
deployment warnings: CSRF middleware is absent in this token-only API; HSTS
subdomain and preload policies are deliberately not assumed for your domains.

Build the frontend with `VITE_API_BASE_URL=https://your-api-domain npm run build`
and host `dist/` on a static HTTPS host with SPA fallback to `index.html`.
Set GitHub App callbacks and optional Google OAuth credentials to the deployed
HTTPS URLs. They require access to your provider accounts; source changes alone
cannot configure them.

Check `/healthz` for process liveness and `/readyz` for DB/Redis readiness.
Alert on readiness failures, queue age, worker heartbeats and failed ingestions.
Public readiness responses contain generic failure codes, not driver details.
Context generation is tenant-scoped, `no-store`, and limited to 60 requests/hour
per authenticated user by default (`CONTEXT_PACK_RATE_LIMIT`).

Before upgrading, back up the database and retain its credential encryption
keys. Test restoration and keep the previous image available for rollback.
Migrations are an explicit step; starting a replica does not run them.
