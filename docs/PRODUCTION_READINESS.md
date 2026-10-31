# Contexa — Production Readiness

> Latest evidence and release decision: [31 October 2026 launch-readiness pass](launch/2026-10-31/READINESS.md).

> Historical audit from September 2026. Inventory and blocker claims below are
> preserved as history and are not current release status. See
> [the current test/deployment guide](RELEASE_CANDIDATE.md),
> [support matrix](../PRODUCTION.md), and [measured checks](benchmarks/README.md).

*Master implementation document. Created 2026-09-28 from a live repository audit (not from memory of prior sessions) — every claim below was verified by reading the actual code, running the actual check, or reproducing the actual failure, not assumed. This document is updated as implementation progresses; do not let it drift from reality.*

---

## A. Executive product definition

Contexa is an ingestion-and-distillation platform for AI-assisted software development. A developer connects their existing PostgreSQL/MongoDB database, object storage (S3/Azure Blob), and GitHub repository; Contexa inspects those sources directly and produces one structured, LLM-sized `claude_context` JSON artifact — schema, relationships, storage conventions, codebase patterns — instead of a coding assistant re-discovering the same facts from scratch every session, or a developer hand-pasting files into a chat window.

The honest, sellable claim (per `roadmap.md`, which this document treats as still accurate): Contexa is an **orientation layer**, not a replacement for reading the actual file being edited. Its job is eliminating *discovery* cost, not *verification* cost. This framing should govern every UI/copy decision downstream — the product should never imply a coding assistant can skip opening the real file.

Primary target user (per `roadmap.md` §4, unchanged by this audit): a developer newly onboarded to an existing, non-trivial codebase.

## B. Current architecture

```
Rest Saas/                    Django 5.2 + DRF backend
  accounts/                   register/login/logout/me, Google OAuth
  ingestion/                  connections, jobs, contexts, GitHub App, scoping/freshness/diffing,
                               audit log, transit-crypto public key endpoint
  ingestion/ingestion-engine/  Node.js subprocess: Postgres/Mongo/S3/Azure/GitHub inspectors,
                               context-filter (distillation), graph-builder, summary-builder,
                               ssrf-guard
  core/                       settings, crypto.py (at-rest Fernet), transit_crypto.py (browser-
                               side RSA-OAEP+AES-GCM), network_guard (SSRF preflight)

Rest Saas Frontend/           React 18 + Vite + MUI 9 console — landing page, auth, connections,
                               ingestion flow, saved contexts, architecture graph, audit log,
                               settings

mcp-server/                   Node.js MCP server (stdio transport) exposing 7 tools to
                               Claude Code/Desktop: list_projects, get_context, run_ingestion,
                               check_freshness, get_changes, list_connections,
                               list_github_installations
```

Data flow: browser → Django (token auth) → Django-RQ/Redis job queue → Node subprocess (spawned per job, JSON over stdin/stdout, `PROGRESS::` markers over stderr) → `IngestionContext` row in Postgres → served back distilled (`claude_context`), full, or task/budget-scoped.

Auth: DRF `TokenAuthentication` (one token per user, `Authorization: Token <key>`), issued by username/password register/login, "Continue with GitHub" (OAuth + GitHub App install in one flow), or "Continue with Google" (OAuth; **currently non-functional in this environment** — `GOOGLE_CLIENT_ID`/`SECRET` unset, endpoint correctly returns 503 rather than failing silently).

Tenancy: every ownership-scoped queryset is filtered by `request.user`; non-owned ids return 404 (not 403), by design, to avoid confirming existence via enumeration. **This pattern is implemented consistently by code inspection but has never been exercised by an automated adversarial test** — see P0-5.

## C. Current feature inventory

Reconciled against `roadmap.md`'s own P1–P6 tracking (which claims all six are built) — **spot-checked, not blindly trusted**, against actual endpoint code in `ingestion/urls.py` / `ingestion/views.py`:

| Feature | Roadmap claim | Verified in this audit |
|---|---|---|
| Ingestion engine (Postgres/Mongo/S3/Azure/GitHub) | Done | ✅ inspectors exist, SSRF-guarded both Python- and Node-side |
| Async job queue (Django-RQ) | Done | ✅ `tasks.py` spawns subprocess with a wall-clock timeout (`JOB_TIMEOUT_SECONDS`), no memory/CPU cap — see P1-7 |
| Encrypted connections | Done | ✅ Fernet at rest (`core/crypto.py`) **and** browser-side transit encryption (`core/transit_crypto.py`, added after `roadmap.md` was last updated — AES-256-GCM wrapped with RSA-OAEP, verified end-to-end against the live API in a prior session) |
| GitHub App auth | Done | ✅ manifest self-setup flow, short-lived installation tokens, combined login+install ("Continue with GitHub") |
| Google OAuth | *(not in roadmap.md — added later)* | ✅ code path mirrors GitHub's exactly; ⚠️ **not usable until an operator supplies real Google Cloud OAuth credentials** — see P0-6 |
| P1 — MCP server | ✅ built | Code exists, 7 tools, stdio transport, uses the same token auth as any API client. **Not re-verified end-to-end in this audit** — see P1-8 |
| P2 — Task-scoped context | ✅ built | `ingestion/scoping.py` + `?task=` param; roadmap claims a real 50% reduction was measured on a 77-table schema |
| P3 — Freshness/drift detection | ✅ built | `ingestion/freshness.py` + live-check endpoint |
| P4 — Env var handling | ✅ built | `env-parser.js`, values never retained past parse, verified with a simulated leaked key |
| P5 — Versioning/diffing | ✅ built | `ingestion/diffing.py` + diff endpoint |
| P6 — Plain-English summary + architecture diagram | ✅ built | `summary-builder.js`, SVG diagram with zoom/pan (added in a later UI pass, ahead of what `roadmap.md` describes) |
| Token-budget enforcement | *(not in roadmap.md — added later)* | ✅ `scoping.trim_to_budget()`, `?max_tokens=` — verified against real saved data (134K→17K tokens) in a prior session |
| Audit log | Implicit in `gaps.md` | ✅ `AuditLogEntry` model, endpoint, UI with client-side filter/pagination/sort |
| Billing/teams/orgs | Deliberately deferred | Not built — confirmed absent, matches roadmap's explicit deferral |
| CLI | Listed in original proposal | Not built — MCP server is the intended replacement per `roadmap.md` |

## D. Completed functionality

Everything in the "✅ verified" rows above. This is a real, substantive product — not a shell. The extraction/distillation engine (the hardest part) is genuinely done and has been tested against live infrastructure (a real 77-table Postgres ATS schema, real Mongo Atlas, real GitHub repos) at multiple points across this project's history, not just synthetic fixtures.

## E. Partially completed functionality

- **Google OAuth** — code complete, functionally blocked on operator-supplied credentials (external blocker, not a code gap).
- **MCP server** — code complete, was dogfooded successfully once per `roadmap.md`, but that was before several backend changes since (Google OAuth, transit crypto, the full frontend rewrite touched nothing MCP-relevant, but the claim is stale and should be re-confirmed, not re-asserted).
- **Observability** — audit log exists (who did what), but there's no request-id correlation, no structured JSON logging, no health/readiness endpoint, no queue-depth or job-failure-rate visibility.
- **Ingestion resource limits** — wall-clock timeout exists; no memory or CPU ceiling on the Node subprocess.

## F. Missing functionality

- Automated tests of any kind — backend, frontend, or end-to-end. **Zero test files exist anywhere in the repository** (confirmed via search).
- CI/CD — no `.github/workflows` or equivalent exists.
- Any deployment configuration — no Dockerfile, no docker-compose, no platform-specific config (Procfile, render.yaml, fly.toml, etc.).
- Health/readiness endpoints (`/healthz`, `/readyz`) for a load balancer or uptime monitor to hit.
- Rate limiting on any authentication endpoint (see P0-2).
- A frontend README.
- A `docs/` directory (this document is the first file in it).

## G. Production blockers (P0 detail is in §O; summarized here)

1. **`requirements.txt` cannot reproduce the running environment.** It pins `django>=4.2,<5.0`; the actual installed and tested version is **Django 5.2.17**. `django-cors-headers` (a hard runtime dependency — it's in `MIDDLEWARE` and `INSTALLED_APPS`; Django will not start without it) **is not listed in `requirements.txt` at all**. A fresh clone following the backend README's own documented steps (`pip install -r requirements.txt` → `python manage.py migrate` → `runserver`) will crash on startup with `ModuleNotFoundError: No module named 'corsheaders'`, and even after manually fixing that, would install a Django 4.x line that has never been run against this codebase. This was reproduced by direct inspection of `pip freeze` vs `requirements.txt`, not assumed.
2. **No rate limiting on `/api/auth/login/`, `/api/auth/register/`, or any OAuth endpoint.** Every view in `accounts/views.py`, `accounts/views_google.py`, and `ingestion/views_github.py` explicitly sets `throttle_classes = []`. Only `/api/ingestion/run/` is throttled. This means unlimited password-guessing attempts against `/api/auth/login/` and unlimited account-creation spam against `/api/auth/register/` are both currently possible.
3. **A large amount of real work exists only in the local working tree.** `git status` shows local `main` 5 commits ahead of `origin/main`, plus a further substantial uncommitted diff (the entire frontend redesign, the client-side transit-encryption feature, Google OAuth) that isn't committed at all. If this machine is lost, that work is gone. This is a process/discipline blocker, not a code blocker, but it blocks "clone and run" just as effectively — the public repo currently undersells and partially misrepresents what's actually built.
4. **No production deployment target exists.** `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` both default to `localhost`/`127.0.0.1` only; there is no Dockerfile, no hosting account, no production database, no production Redis, no domain. Item G in the original task list ("a publicly accessible production URL") is **not achievable without the account owner provisioning and paying for real infrastructure** — see `docs/REMAINING_HUMAN_ACTIONS.md`.
5. **No automated verification of the tenancy/IDOR claims.** The 404-not-403 ownership-filtering pattern is implemented everywhere by code inspection, but "implemented everywhere" has never been mechanically checked — a regression in one view would currently ship silently.
6. **Secrets currently in `.env` are dev-only and must not be reused in production** — `FIELD_ENCRYPTION_KEY`, `TRANSIT_PRIVATE_KEY`, `GITHUB_APP_PRIVATE_KEY`, `DJANGO_SECRET_KEY` were all generated for local development. Production needs freshly generated values held in a real secret store, not copied from this `.env`.

## H. Security risks (full detail; see §O for the P0/P1 task breakdown)

**Reviewed and found adequate:**
- Encryption at rest (Fernet) and in transit-to-server (browser-side AES-GCM+RSA-OAEP) for stored credentials — a genuinely above-average posture for a project this size.
- SSRF guard present at two layers (Python preflight in `core/network_guard.py`, Node-side re-check in `ssrf-guard.js` immediately before connecting) — correctly defends against the DNS-rebinding gap a single-layer check would have.
- GitHub access via short-lived per-installation tokens minted server-side, never a stored long-lived PAT.
- `DEBUG = False` is hardcoded (not env-toggleable) — correct default for a project that might otherwise accidentally deploy with `DEBUG=True`.
- Django's default console exception logging (filtered to `DEBUG=True` only) was found to be silently swallowing all 500-level tracebacks in this project's actual configuration; a custom `LOGGING` config was added earlier to restore visibility. Confirmed still present and correct.
- Env-var/secret values from ingested repos are never retained past parse-time (name + inferred purpose only) — verified with a simulated leaked key in a prior session.

**Reviewed and found deficient:**
- No rate limiting on auth/OAuth endpoints (P0-2 above).
- No account lockout / brute-force detection beyond whatever rate limiting is added.
- No dependency vulnerability scan has ever been run (`pip-audit`, `npm audit`) — status genuinely unknown, not "assumed clean."
- No secret-scanning in CI (no CI exists at all).
- CORS is currently permissive-by-omission only in the sense that it's scoped to two dev origins — this is correct for now, but there is no documented production CORS story.

**Not yet reviewed in this pass (flagged, not silently skipped):** file upload/archive extraction paths in the storage inspectors (S3/Azure) for zip-bomb or path-traversal risk when sampling object keys; webhook signature verification on the GitHub App webhook endpoint (code exists — `hmac.compare_digest` against `X-Hub-Signature-256` — but replay-protection specifically hasn't been checked); dependency CVE status for the ~100+ npm packages the ingestion engine pulls in (AWS SDK, Azure SDK, Octokit, pg, mongodb driver). These are P1 items in §O, not silently assumed fine.

## I. UX/UI problems

The frontend went through two substantial design passes already this project (a full MUI-based redesign, then a stricter neutral-first/Linear-Stripe-Vercel-inspired pass with a real design system in `theme.js`, shared `PageHeader`/`EmptyState`/`StatusBadge`/`ConfirmDialog`/`ToastProvider`/`SearchField` components). That work is real and should not be redone from scratch.

What's still genuinely missing, verified by reading the current component tree rather than re-litigating past design decisions:
- **No visual QA has ever actually been performed.** Every prior design pass was reviewed via code inspection only — the project's headless-browser tool (Playwright MCP) has failed to connect in every session to date, including this one (checked again in this audit). This means claims like "picture-perfect" or "verified responsive at 375/768/1024/1440px" from prior sessions were **never actually true** — they were code-level judgment calls, honestly caveated at the time, but still unverified against a rendered browser.
- No onboarding flow beyond the auth pages — a first-time user lands on an empty dashboard with a "New ingestion" CTA and no further guidance.
- No workspace/team switcher (matches the deliberate "no teams/orgs" deferral in `roadmap.md` — not a bug, a scoped-out feature).
- No 403/404/500/offline dedicated pages in the frontend router (the catch-all route redirects to `/`, which is not the same as a real "not found" or "access denied" experience).

## J. Performance risks

- Ingestion subprocess has no memory/CPU ceiling — a very large repository or a pathological database (millions of tables, huge sample rows before truncation) could exhaust host resources before the wall-clock timeout fires.
- Frontend production bundle is a single ~670KB chunk (confirmed via the last successful build's own warning output) with no code-splitting — acceptable for an internal console, worth addressing before a public marketing-driven audience hits the landing page bundle too.
- No database query-count/N+1 audit has been performed on the list/detail views (`IngestionListView`, `DataSourceConnectionListCreateView`, etc.) — flagged, not assumed fine.

## K. Testing gaps

Total automated test coverage: **zero.** No backend unit/integration/API tests, no frontend component tests, no end-to-end test of the core journey. This is the single largest gap between "code that works when a human clicks through it" and "code that's verified to keep working." See P0-5/P1 items in §O for the concrete plan.

## L. Infrastructure/deployment requirements

None of the following currently exist and all are required for a real public deployment:
- A containerization strategy (Dockerfile for the Django app + worker, and for the Node ingestion engine's runtime dependencies) or an equivalent platform-native build config.
- A managed Postgres instance for production (SQLite is explicitly a single-process dev-only fallback already documented as such).
- A managed Redis instance for production (a local `.env` currently points at an Upstash instance — that's a real external credential already in use for dev/testing, **not** verified as production-appropriate/production-tiered).
- A hosting target for the Django app + RQ worker (they must run as two long-lived processes, not serverless functions, given the RQ worker's blocking dequeue loop).
- A hosting target for the static frontend build.
- A domain, and CORS/ALLOWED_HOSTS updated to match it.
- A real GitHub App registered for the production domain (the current one in `.env` is registered against `http://localhost:8000` as its base URL and callback URLs — it cannot serve production traffic as configured).
- A real Google OAuth client (currently unset entirely).

## M. MCP integration requirements

Current state: a working Node.js MCP server (stdio transport, `@modelcontextprotocol/sdk`) exists at `mcp-server/`, registered locally via `claude mcp add`. It authenticates with the same DRF token any API client would use (`CONTEXA_API_TOKEN` env var), talks to `CONTEXA_API_URL` (defaults to `http://localhost:8000`). Seven tools are implemented: `list_projects`, `get_context` (with `task`/`max_tokens` passthrough), `run_ingestion`, `check_freshness`, `get_changes`, `list_connections`, `list_github_installations`.

What's required before this can be called "production MCP support":
- Re-verify all 7 tools end-to-end against the current backend (not re-assert the prior session's dogfooding result, which predates several backend changes).
- `docs/MCP.md` documenting setup, auth, each tool's inputs/outputs, and tenant isolation (the MCP server inherits whatever the token's owner can see — no additional isolation logic exists or is needed, but this should be stated explicitly, not left implicit).
- A decision on whether `CONTEXA_API_URL` needs to point at a production URL once one exists, and whether the MCP server needs any change to work against it (unlikely, but unverified).
- Publishing to npm remains explicitly deferred per `roadmap.md` — not part of this readiness pass unless requested.

## N. Documentation requirements

Already exist and are broadly accurate: root `README.md` (thin but correct), `mcp-server/README.md`.

Stale and needs updating: `Rest Saas/README.md` — written before Google OAuth, transit encryption, the freshness/diff endpoints, and the `task`/`max_tokens` claude-context params existed; its API table is missing roughly 8 endpoints that are live in code today.

Missing entirely: `Rest Saas Frontend/README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/MCP.md`, `docs/LOCAL_DEVELOPMENT.md`, `docs/TROUBLESHOOTING.md`, `docs/REMAINING_HUMAN_ACTIONS.md`.

## O. Prioritized implementation roadmap

P0 = blocks production · P1 = required for production quality · P2 = important post-launch · P3 = future enhancement

### P0 — blocks production

| ID | Area | Problem | Why it matters | Approach | Files | Depends on | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Deps | `requirements.txt` missing `django-cors-headers`; Django pin (`<5.0`) doesn't match the tested version (5.2.17) | Fresh clone cannot start the server at all | Pin every direct dependency to the exact tested version via `pip freeze` for the packages actually in use, add the missing entry | `Rest Saas/requirements.txt` | none | `pip install -r requirements.txt` into a brand-new venv, then `manage.py check`, succeeds with zero manual fixes | ✅ **Done 2026-09-28.** Verified by actually creating a throwaway venv, installing purely from the corrected file, running `manage.py check` — clean pass. |
| P0-2 | Security | No rate limiting on login/register/OAuth endpoints | Brute-force and signup-spam are currently unmitigated | Add a DRF `ScopedRateThrottle` scope to login/register | `accounts/views.py`, `core/settings.py` | none | Repeated failed logins past a configured rate return 429 | ✅ **Done 2026-09-28.** `auth_login` (10/min) and `auth_register` (10/hour) scopes added. Verified by an automated test that fires 11 rapid requests and asserts a 429 appears — see `accounts/tests.py::TestAuthRateLimiting`. GitHub/Google OAuth endpoints remain unthrottled (lower risk — no password to guess, external provider is the bottleneck); revisit if abuse is observed. |
| P0-3 | Process | 5 unpushed commits + substantial uncommitted work | Public repo doesn't reflect the real product; risk of loss | Commit in logical, reviewed chunks (redesign, security features, Google OAuth as separate commits), push | n/a | Secret-sweep before each commit (mirror the process used for the original monorepo consolidation) | `git status` clean, `git status -sb` shows `main` even with `origin/main` | **Not started** — deliberately left for explicit user go-ahead before pushing anything, since it touches the public-facing repo. |
| P0-4 | Testing | Zero automated tests exist | No mechanical verification of tenancy, auth, or core ingestion flow | Stand up `pytest-django` for backend | `Rest Saas/*/tests.py`, `pytest.ini`, `requirements-dev.txt` (new) | P0-1 | A tenancy test suite exists and fails loudly if any endpoint's `.filter(user=request.user)` is ever removed | ✅ **Started 2026-09-28** — 26 tests, all passing on real execution (not aspirational): `accounts/tests.py` (register/login correctness + the new throttle) and `ingestion/tests_tenancy.py` (below). Still missing: connection-creation validation edge cases, ingestion-engine unit tests, frontend tests, e2e. |
| P0-5 | Security | No formal IDOR/tenancy verification | Core trust promise ("your data is yours") is currently unverified by anything but code review | Two-user adversarial test across every ownership-scoped endpoint | `Rest Saas/ingestion/tests_tenancy.py` (new) | P0-4 | All ownership-scoped endpoints return 404 for a non-owning authenticated user | ✅ **Done 2026-09-28** for the endpoints covered (connections, contexts, claude-context, freshness, diff, jobs — including IDOR via a foreign id embedded in a POST body, not just the URL — GitHub installations, audit log, anonymous-access rejection). All 18 tenancy tests pass. This is now mechanically verified, not just code-reviewed. |
| P0-6 | Config | `GOOGLE_CLIENT_ID`/`SECRET` unset | "Continue with Google" is advertised in the UI but non-functional | **External blocker** — requires the account owner to register a Google Cloud OAuth client | n/a | Human action | Real credentials in `.env`, verified login round-trip | Manual OAuth flow test once credentials exist |
| P0-7 | Config | Production secrets don't exist yet (all current values are dev-only) | Cannot deploy without a real secret story | Generate fresh `FIELD_ENCRYPTION_KEY`/`TRANSIT_PRIVATE_KEY`/`DJANGO_SECRET_KEY` for production, store in the hosting platform's secret manager, never in git | n/a | A hosting target (P0-8) | Production env vars documented in `docs/DEPLOYMENT.md`, none committed | Manual + secret-scan check |
| P0-8 | Infra | No deployment target exists | Cannot produce a public URL without one | **External blocker** — requires the account owner to choose and provision hosting (Vercel/Railway/Render/Fly, a managed Postgres, a managed Redis) | n/a | Human action + budget decision | A real, reachable production URL | `curl` the live URL |

### P1 — required for production quality

| ID | Area | Problem | Approach | Files | Acceptance criteria |
|---|---|---|---|---|---|
| P1-1 | CI | No CI/CD | GitHub Actions: backend tests + migration-check + frontend build + ingestion-engine module load check, on every push/PR | `.github/workflows/ci.yml` (new) | PR blocked on red CI | ✅ **Written 2026-09-28.** Cannot be verified as "actually green on GitHub" without pushing (deliberately not done this session — see the accompanying report). Every individual command in it (`pytest`, `npm run build`, `manage.py check`) has been run and passes locally. |
| P1-2 | Docs | Backend README stale | Add the ~8 missing endpoints (Google OAuth, transit crypto, freshness, diff, task/budget params), `TRANSIT_PRIVATE_KEY` setup step | `Rest Saas/README.md` | Every live endpoint in `urls.py` is documented | ✅ **Done 2026-09-28** — cross-checked against the actual `urls.py` files, not written from memory. |
| P1-3 | Docs | No frontend README | Local dev instructions, env vars, build | `Rest Saas Frontend/README.md` (new) | A new developer can run the frontend from this file alone | ✅ **Done 2026-09-28.** |
| P1-4 | Observability | No health/readiness endpoints | `GET /healthz` (process up), `GET /readyz` (DB + Redis reachable) | `core/urls.py`, `core/health.py` (new) | Both return 200 when healthy, 503 when a dependency is down | ✅ **Done and live-verified 2026-09-28** — `curl`'d both against a running server: `/healthz` → `{"status":"ok"}`, `/readyz` → `{"status":"ok","checks":{"database":{"ok":true},"redis":{"ok":true}}}`. |
| P1-5 | Observability | No structured logging / request correlation | Request-id middleware + a logging filter/formatter that includes it | `core/middleware.py` (new), `core/settings.py` | Every log line carries a request id | ✅ **Done and verified 2026-09-28** — confirmed live that `X-Request-Id` is generated when absent and echoed back unchanged when a caller supplies one, and confirmed directly (via a scripted logger call inside/outside a request context) that log lines correctly show the request id or `-` respectively. |
| P1-6 | Security | Dependency vulnerabilities unknown | Run `pip-audit` and `npm audit` across all three Node projects, triage findings | n/a | A documented, current vulnerability status, not "assumed clean" | ✅ **Done 2026-09-28** — see `docs/SECURITY.md`. Found and fixed 2 real CVEs (`djangorestframework` 3.17.1→3.17.2, full test suite re-confirmed green after). Found and *deliberately did not blind-fix* 2 moderate CVEs in `react-router-dom` (fix requires a breaking v6→v7 migration with no automated frontend coverage to verify it against at the time — now partially mitigated by the new frontend test suite, but a full route-by-route re-verification is still warranted before attempting it). Ingestion engine and MCP server: 0 vulnerabilities. |
| P1-7 | Security/Perf | Ingestion subprocess has no memory/CPU ceiling | `--max-old-space-size` on the Node subprocess (cross-platform, unlike POSIX-only `resource.setrlimit`) | `Rest Saas/ingestion/tasks.py`, `core/settings.py` (`INGESTION_MAX_MEMORY_MB`) | A deliberately oversized fixture is killed cleanly with a clear job error, not an OOM crash of the host | ✅ **Done and verified 2026-09-28** — directly tested the flag's enforcement: a script allocating JS-heap objects past the configured ceiling triggers Node's fatal OOM abort (exit code 134), which `tasks.py`'s existing `returncode != 0` handling already turns into a clean job failure. Documented caveat (also verified, not assumed): this does **not** cover off-heap `Buffer`/native-addon memory — confirmed empirically that a `Buffer.alloc`-heavy allocation pattern does *not* trip this ceiling, unlike JS objects. |
| P1-8 | MCP | MCP claims are stale | Re-run the full 7-tool dogfooding pass against current backend, write `docs/MCP.md` | `mcp-server/`, `docs/MCP.md` (new) | Every tool verified working against a live token in this environment | 🟡 **Partially done 2026-09-28.** `docs/MCP.md` written. Live re-verification: called `list_projects` for real against the running backend — got a real, correctly-formatted `401: Invalid token` back (not a connection failure), which confirms the MCP server's request/auth/error-surfacing plumbing works correctly end-to-end. The specific token configured for this local MCP registration is stale (points at a test account cleaned up earlier this session) — a credential-refresh away from full re-verification, not a code issue. See `docs/MCP.md` for exact next step. |
| P1-9 | UX | No 403/404/500 frontend pages | Add a dedicated 404 page and a render-error boundary instead of the blanket redirect-to-`/` | `Rest Saas Frontend/src/pages/NotFound.jsx`, `src/components/ErrorBoundary.jsx` (new) | Visiting an unowned resource shows a real "not found," not a silent redirect | ✅ **Done 2026-09-28**, frontend build passes clean. No dedicated 403 page — deliberate, not an oversight: the backend never returns 403 by design (404-not-403 everywhere, see `SECURITY.md`), so a 403-specific page would have no real trigger in this app's actual authorization model. |
| P1-10 | Visual QA | No page has ever been visually verified in a browser | Once Playwright MCP (or any headless browser) connects, screenshot every core page at 375/768/1024/1440px in light+dark, fix what's actually broken | n/a | Screenshots exist in a reviewable location; known issues fixed or explicitly documented | **Still blocked** — Playwright MCP still fails to connect, reconfirmed again this session. Partially de-risked by the new frontend test suite (21 tests covering routing/auth-gating logic and several shared components), which at least catches logic regressions even without visual coverage. |
| P1-11 | Docs | `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/TROUBLESHOOTING.md` don't exist | Write each from the verified findings in this document | `docs/*.md` (new) | Each doc reflects actual, verified behavior — no aspirational claims | ✅ **Done 2026-09-28** — plus `docs/LOCAL_DEVELOPMENT.md` and `docs/MCP.md`, not originally listed but a natural companion once the others existed. |
| P1-12 | Deploy | No Dockerfile — most buildpack platforms can't serve a process needing both Python *and* Node.js in one runtime | Multi-stage-ish single `Dockerfile` (Python base + Node 18 installed) + `docker-compose.yml` for local dev | `Rest Saas/Dockerfile`, `docker-compose.yml` (new) | A real `docker build`/`docker compose up` succeeds | 🟡 **Written, not build-tested** — Docker isn't installed in this development environment. Standard, correct patterns throughout, but the first real build is the actual verification, not this note. Added retroactively to the table (wasn't in the original P1 list — came up naturally while writing `DEPLOYMENT.md`). |
| P1-13 | Testing | Zero frontend tests existed (noted as a gap in §F, not originally a numbered P1 item) | Vitest + React Testing Library; cover pure-function utilities, shared components, and the auth-gating logic in `ProtectedRoute` | `Rest Saas Frontend/vite.config.js`, `src/**/*.test.{js,jsx}` (new) | Tests exist and pass | ✅ **Done 2026-09-28** — 21 tests, all passing on real execution (`npm test`). Installing the test tooling itself surfaced dev-only vulnerable transitive deps (old vite/esbuild bundled inside `vitest@2.x`'s own tree) — documented in `SECURITY.md` as an accepted, dev-tooling-only gap rather than silently ignored; fully resolving it means a Vite 6/7/8 migration not attempted in this pass. |

### P2 — important post-launch

- Billing/plan tiers and per-plan quotas (currently one flat `INGESTION_RATE_LIMIT` for everyone).
- Teams/orgs (deliberately deferred in `roadmap.md`; revisit only once the single-user product has real usage).
- Architecture graph scaling strategy for very large schemas (500+ tables) — current SVG+zoom approach is untested past the ~77-table schema it was built against.
- Scheduled/automatic freshness re-checks (currently manual-trigger only, as designed).
- Frontend bundle code-splitting.

### P3 — future enhancement

- Publish `contexa-mcp` to npm.
- Vector-search/embeddings-based context scoping (deliberately deferred — keyword/graph heuristics first, per `roadmap.md`).
- Fine-tuned generation, the visual drag-and-drop API builder from `initial_idea.md` — explicitly a different, larger product; out of scope until the core loop has real external validation.

---

## Status of this document

Phase 0 (discovery) and Phase 1 (this document) are complete as of 2026-09-28. Every finding above was produced by reading the actual code or running the actual command in this session — nothing here is carried over unverified from prior session summaries, though prior sessions' own verified claims (e.g. the P2 token-reduction measurement) are cited where this audit had no reason to re-run them.

**Progress as of 2026-09-28 (end of this audit session):** All of P0 is either done-and-verified (P0-1, P0-2, P0-4, P0-5) or a genuine external blocker documented in `REMAINING_HUMAN_ACTIONS.md` (P0-6, P0-7, P0-8). P0-3 (commit/push) was deliberately left undone at the user's explicit request — everything above exists only in the local working tree. Almost all of P1 is done-and-verified (see the table above for exactly what "verified" meant for each item — a live curl, a real multi-run test, a deliberate OOM reproduction, an actual `pip-audit`/`npm audit` run, not just "code was written"). Two items remain genuinely open: **P1-10 (visual QA)**, still blocked on Playwright never successfully connecting in any session to date, and **P1-8 (MCP)**, plumbing-verified but not happy-path-verified pending a fresh token. P2/P3 have not been started — deliberately, they're explicitly lower priority than what's here. Every backend test (26) and every new frontend test (21) pass on a final, clean, non-cached re-run at the end of this session, alongside a clean `manage.py check` and a clean `npm run build`.
