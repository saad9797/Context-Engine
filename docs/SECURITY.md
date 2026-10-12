# Security

*What's actually implemented and verified, what's known-deficient, and what hasn't been reviewed yet — as of the 2026-09-28 production-readiness audit. This document makes no claim it hasn't checked; see `docs/PRODUCTION_READINESS.md` §H for the audit this was extracted from.*

## Authentication

DRF `TokenAuthentication` — one token per user (`rest_framework.authtoken.models.Token`), sent as `Authorization: Token <key>`. Three ways to get one:

- Username/password (`AUTH_PASSWORD_VALIDATORS` enforces Django's standard four validators, including an 8-character minimum — this is not a default, it was explicitly configured, since Django's `startproject` template is what normally adds these and this project doesn't use that template).
- "Continue with GitHub" — GitHub App OAuth, links via `GitHubIdentity.github_id` (a stable numeric id, not the mutable `login` name).
- "Continue with Google" — same pattern via `GoogleIdentity.google_id` (the OIDC `sub` claim). **Not currently usable** — credentials unset in this environment (see `REMAINING_HUMAN_ACTIONS.md`).

**Rate limiting** (added 2026-09-28 — previously absent, a real gap): login and register are throttled per-IP via DRF `ScopedRateThrottle` (`auth_login`: 10/min, `auth_register`: 10/hour, both env-configurable). OAuth login/callback endpoints remain unthrottled — lower risk since there's no password to guess and the external provider is the actual bottleneck, but revisit if abuse is ever observed.

**Not implemented:** account lockout after N failed attempts (rate limiting slows brute-force, it doesn't stop a distributed one), 2FA, session/device management, password reset flow (there is no "forgot password" endpoint at all currently).

## Authorization / multi-tenancy

Every ownership-scoped queryset is filtered by `request.user`; a non-owned id returns 404, never 403 (see `ARCHITECTURE.md`). **Mechanically verified** as of this audit by `Rest Saas/ingestion/tests_tenancy.py` — a two-user adversarial suite covering connections, saved contexts, claude-context/freshness/diff sub-resources, jobs (including an id smuggled inside a POST body, not just the URL), GitHub installations, and the audit log. 26/26 tests pass. This was previously "implemented consistently by code inspection" and unverified by anything mechanical — that gap is closed.

**Known limitation:** this coverage is endpoint-level, not exhaustive of every possible parameter combination. New endpoints must add their own tenancy test — there is no framework-level enforcement (e.g. no row-level security at the database layer) that would catch a missing `.filter(user=...)` automatically.

## Credential handling

Two independent layers, deliberately not conflated:

1. **In transit, browser → server:** connection credentials (`postgres_url`, `mongo_url`, storage keys) are encrypted client-side before the HTTP request is sent — AES-256-GCM with a per-submission key, that key wrapped with an RSA-OAEP public key fetched from `/api/crypto/public-key/`. See `core/transit_crypto.py` and `Rest Saas Frontend/src/api/transitCrypto.js`. This is real, working, end-to-end-tested encryption — not a marketing claim — but it does not mean the server never sees the plaintext: the server has to decrypt it to actually connect to your database on your behalf, which is the product's entire function. Any claim of "the server never sees your credentials" for a product like this would be false; this document doesn't make that claim.
2. **At rest:** the (by-then-decrypted-once, immediately-re-encrypted) credential is stored via app-level Fernet envelope encryption (`core/crypto.py`, key from `FIELD_ENCRYPTION_KEY`). Swappable for a real KMS later without a schema change — the encrypted value is an opaque `TextField`.

GitHub access uses short-lived (~1hr) per-installation tokens minted server-side on demand (`github_app.mint_installation_token`), never a stored long-lived personal access token.

Credential plaintext is never echoed back to the client after creation (`DataSourceConnectionSerializer.config`/`transit_payload` are both `write_only`).

## SSRF

Two independent layers: a Python preflight (`core/network_guard.py`, runs before the job is even enqueued to spawn a subprocess) and a Node-side re-check immediately before each `pg`/`mongodb`/storage-endpoint connection (`ingestion-engine/src/ssrf-guard.js`) — the second layer exists specifically to close the DNS-rebinding gap a single preflight-only check would have (a hostname can resolve to a safe IP at preflight time and a private/metadata IP by the time the actual connection happens). Loopback/link-local/RFC1918/multicast/the `169.254.169.254` cloud metadata address are rejected unless explicitly trusted via `SSRF_ALLOWED_HOSTS`.

## Ingestion engine threat model

The ingestion engine processes untrusted external input by design — it's told to connect to *some* database/repo/bucket and inspect it. Reviewed:

- **Malicious database contents** (a crafted row/column name, an oversized table): sample rows are capped (`MAX_SAMPLE_ROWS`), and the distillation step (`context-filter.js`) already strips scan statistics and extension-internal data before anything reaches storage. A single pathologically large text field in a sample row is not currently size-capped independently of the row-count cap — flagged, not yet fixed.
- **Malicious/oversized GitHub repositories:** the file tree has a size cutoff (`FILE_TREE_MAX_FILES_FOR_FULL_TREE`) past which the full tree is replaced with a truncated summary; individual file content reads are capped.
- **Resource exhaustion (memory/CPU):** a wall-clock timeout (`JOB_TIMEOUT_SECONDS`, 600s) has always existed. A V8 heap ceiling (`--max-old-space-size`, default 512MB, `INGESTION_MAX_MEMORY_MB`) was added 2026-09-28 — this is a **partial** guard: it caps the JS heap, not native-addon/buffer memory the AWS/Azure SDKs can allocate off-heap, and there's no cross-platform equivalent of POSIX `resource.setrlimit` for total process RSS (Windows, which this project is developed on, has no rlimit mechanism at all). A determined adversary with a repo/database designed specifically to allocate large off-heap buffers could still pressure host memory. Full process-level sandboxing (a container with a hard cgroup memory limit) is the real fix and is a deployment-time concern, not something Python's `subprocess` module can provide directly — see `docs/DEPLOYMENT.md`.
- **Path traversal / symlinks / archive extraction:** **not yet reviewed** — the GitHub inspector reads file contents via the GitHub API (not a local `git clone` + filesystem walk), which structurally avoids most local-path-traversal risk, but this hasn't been explicitly verified against a repo containing crafted paths. Flagged as an open item, not assumed safe.
- **Command/subprocess injection:** the Node engine does not shell out to any external CLI (no `git`, no `unzip`) — it uses HTTP-API clients (Octokit, AWS SDK, Azure SDK, `pg`, `mongodb`) exclusively. This structurally rules out shell-injection risk from ingested content, verified by reading the inspector source, not assumed.

## Webhook verification

The GitHub App webhook endpoint verifies `X-Hub-Signature-256` via `hmac.compare_digest` against `GITHUB_APP_WEBHOOK_SECRET`. **Not yet reviewed:** replay protection (a captured valid webhook payload could in principle be replayed — GitHub doesn't include a nonce/timestamp binding by default that this code currently checks).

## Dependency vulnerability scan (P1-6 — completed 2026-09-28)

Ran `pip-audit` against the backend and `npm audit` against all three Node projects (frontend, ingestion engine, MCP server).

- **`djangorestframework==3.17.1` had two real CVEs** — `PYSEC-2026-3827`/CVE-2026-73228 (DRF's `request.data` bypasses Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` for JSON/form-urlencoded bodies — a resource-exhaustion risk, not auth bypass or RCE per the advisory itself) and `PYSEC-2026-3828`/CVE-2026-73229 (`AdminRenderer` can leak GET-only-permission data via a 400 response to an invalid write request, when `AdminRenderer` is enabled and the client negotiates HTML — this project doesn't customize `DEFAULT_RENDERER_CLASSES`, so DRF's default renderer set applies; not independently re-verified whether `AdminRenderer` specifically is reachable here, but the fix is free regardless). **Fixed** — upgraded to `3.17.2`, full test suite re-run and confirmed green.
- **Ingestion engine and MCP server:** 0 vulnerabilities.
- **Frontend: `react-router-dom` has 2 moderate-severity CVEs** (open redirect via backslash in `<Link>`/`useNavigate`; arbitrary constructor injection via `deserializeErrors()` during SSR hydration — this app has no SSR, so that specific one likely doesn't apply here, but wasn't independently re-verified). The fix requires a **major version bump (v6→v7)**, which `npm audit fix --force` itself flags as breaking. **Not applied in this pass** — react-router-dom v7 changed enough of the routing API that a blind upgrade risks silently breaking navigation across every page, and this project has no automated frontend tests and no working headless-browser tool to verify a migration with. This is real, open, and tracked as its own item (`PRODUCTION_READINESS.md` P1) rather than either ignored or blindly "fixed" without verification.

## What has not been reviewed at all (flagged, not silently skipped)

- CSRF: DRF's `TokenAuthentication` is not vulnerable to CSRF the way cookie-based session auth is (no ambient credential a third-party site can trigger use of), but this hasn't been explicitly re-confirmed against every view — flagged as a quick, low-risk verification still owed.
- Full audit of DRF serializer-level input validation across every endpoint for injection-adjacent issues beyond what Django's ORM already parameterizes for.
- Whether any code path in the frontend actually feeds attacker-influenced input into `navigate()`/`<Link to>` in a way the react-router-dom open-redirect CVE could exploit — no such sink was found by inspection, but this wasn't exhaustively verified across every page.

## Reporting

No security contact/disclosure process exists yet — add one (even a simple "email X" line in the root README) before any public launch.
