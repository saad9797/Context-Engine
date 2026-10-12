# Remaining Human Actions

*Genuinely external blockers only — things that require an account, a credential, a payment, or a decision only the project owner can make. Everything else is tracked as implementation work in `docs/PRODUCTION_READINESS.md`. Last verified: 2026-09-28.*

---

## 1. Google OAuth credentials

**Blocks:** "Continue with Google" (currently returns `503 Google sign-in is not configured yet` — a deliberate, honest degradation, not a bug).

**What's needed:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.
2. Add an authorized redirect URI: `{BACKEND_BASE_URL}/api/auth/google/callback/` (`http://localhost:8000/api/auth/google/callback/` for local dev; the real production URL once one exists).
3. Paste the resulting Client ID and Client Secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Restart the Django server.

No code changes needed — the integration is already built and mirrors the working GitHub OAuth flow exactly.

## 2. Production hosting decision + provisioning

**Blocks:** everything in `PRODUCTION_READINESS.md` §L (public URL, real deployment).

This repository has never been deployed anywhere. Making it publicly reachable requires the account owner to:

1. **Choose a hosting platform** for the Django app + RQ worker (these must run as two long-lived processes — not a serverless function, since the RQ worker holds a blocking Redis connection). Reasonable options given the existing stack: Railway, Render, or a small VPS. Vercel is not suitable for the backend (no long-running worker support) but is fine for the static frontend build.
2. **Provision a managed Postgres instance** for production (the current `.env` has no `DATABASE_URL` set, meaning it's running on local SQLite — explicitly a dev-only fallback, not safe for concurrent production writes).
3. **Provision a managed Redis instance** for production. Note: the current `.env` already points `REDIS_URL` at a real Upstash instance — confirm whether that instance is intended to be the production one or was only ever meant for local dev/testing; if the latter, provision a separate production instance.
4. **Register a domain** (or decide to launch on a platform-provided subdomain first).
5. **Create a budget decision** — all of the above cost money at any real usage volume; this document does not make that call.

Once these exist, the actual deployment steps will be documented in `docs/DEPLOYMENT.md` (to be written as part of P1 in `PRODUCTION_READINESS.md`) — but the accounts and infrastructure themselves cannot be created without the owner's identity, payment method, and platform choice.

## 3. Production GitHub App registration

**Blocks:** "Continue with GitHub" and repository ingestion, once deployed publicly.

The GitHub App currently configured in `.env` (`GITHUB_APP_ID=4929769`, etc.) is registered with `GITHUB_APP_BASE_URL=http://localhost:8000` as its base URL and callback URLs. It **cannot** serve a production domain as-is. Once a production URL exists (blocker #2 above):

1. Either update the existing App's URLs in GitHub's App settings to the production domain, or run the app's own one-time manifest-flow setup again (`GET /api/integrations/github/manifest/`, operator/staff-only) against the production URL to create a fresh App.
2. Update `.env` on the production host with whichever App's credentials are in use.

This is a five-minute task once a production URL exists — it's blocked only on #2, not on anything else.

## 4. Production secrets

**Blocks:** safe production deployment.

`FIELD_ENCRYPTION_KEY`, `TRANSIT_PRIVATE_KEY`, and `DJANGO_SECRET_KEY` currently in `.env` were generated for local development and must not be reused in production (if the dev `.env` were ever exposed, reusing these in production would mean that exposure compromises production too). Before deploying:

1. Generate fresh values (commands are documented as comments in `.env.example`).
2. Store them in the hosting platform's secret manager — never commit them, never reuse the dev values.

This is mechanical (no external account needed beyond the hosting platform's own secret store from blocker #2), but is listed here because it must happen *at* deployment time, not before.

## 5. Playwright / headless browser access for visual QA

**Blocks:** `PRODUCTION_READINESS.md` P1-10 (actual screenshot-based visual verification across viewports/themes).

The Playwright MCP server has failed to connect (`CONNECT_TIMEOUT`) in every session across this project's history, including the one that produced this document. All UI work to date has been verified by code inspection only, never by an actual rendered screenshot. This needs either:
- The user reconnecting/fixing the Playwright MCP server on their end (`/mcp` or the relevant Claude Code config), or
- The user performing the manual cross-viewport visual pass themselves and reporting back what's broken.

This is not a credentials issue in the usual sense, but it is something only the user can unblock from outside this session.

---

## What is *not* on this list

Everything else in `PRODUCTION_READINESS.md` — the missing test suite, the missing CI/CD, the `requirements.txt` fix, the missing rate limiting, the stale documentation, the uncommitted work — is implementation work that can be done without any external account or credential, and is tracked there instead, not here.
