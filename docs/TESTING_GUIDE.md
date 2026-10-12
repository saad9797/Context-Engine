# Testing Guide — walking through Contexa as a real user

*A step-by-step manual QA script, not a description of automated tests (those are `pytest`/`npm test` — see `LOCAL_DEVELOPMENT.md`). Written 2026-09-28 for the state of the app at that point.*

## Before you start

Everything below assumes the app is running locally per `docs/LOCAL_DEVELOPMENT.md`: backend on `http://localhost:8000`, worker running, Redis up, frontend on `http://localhost:5173`. Sanity-check first:

```bash
curl http://localhost:8000/healthz
curl http://localhost:8000/readyz
```

Both should say `"status": "ok"`. If `/readyz` shows `redis.ok: false`, start Redis before anything else — nothing ingestion-related will work without it.

## 1. Landing page (logged out)

Visit `http://localhost:5173`. You should see the marketing page — hero, feature grid, "how it works," a trust section about credential encryption. Click "Get started free" and "Continue with GitHub" — both should take you to the right auth page.

## 2. Register an account

Go to `/register`. Try submitting with a password under 8 characters — it should be rejected with a clear message (Django's password validators). Then register for real with a valid username/password. You should land on the dashboard, logged in.

Try registering a *second* account with the same username in another browser tab (or after logging out) — should be rejected cleanly.

## 3. "Continue with GitHub"

From `/login`, click "Continue with GitHub." This requires the GitHub App to already be configured (see `REMAINING_HUMAN_ACTIONS.md` item 3 if it isn't) — if not configured, you should get a clear "not configured yet" message, not a blank error. If it is configured: approve on github.com, you should land back on the dashboard logged in, and — if this is the first time this GitHub identity has been used — get funneled straight into the GitHub App install picker in the same flow.

## 4. "Continue with Google"

Same as above but for Google — **expected to fail with a clear "not configured" message** unless you've completed `REMAINING_HUMAN_ACTIONS.md` item 1. This is the correct, honest behavior right now, not a bug.

## 5. Add a connection

Go to Connections. Add a Postgres connection with a real (or intentionally throwaway/test) database URL. Watch for the "encrypted in your browser before it's sent" note in the dialog — open your browser's dev tools Network tab while saving and confirm the request body contains `transit_payload` (base64 blobs), not a plaintext `postgres_url` anywhere.

Try adding a connection with a bad/malformed connection string — should fail with a clear error, not a blank screen or a raw stack trace.

## 6. Try an SSRF-guarded connection (optional, security-specific)

Add a connection pointing at `postgresql://user:pass@127.0.0.1:5432/db` or `postgresql://user:pass@169.254.169.254/db`. The connection itself will save (SSRF checking happens at ingestion time, not save time) — but running an ingestion against it should fail cleanly with an SSRF-rejection message, not silently succeed or hang.

## 7. Run a real ingestion

New Ingestion → pick a connection → Run. You should land on a progress page showing real stages (not a fake progress bar) — "Connecting to sources," then per-source stages, then "Building architecture graph," then "Distilling claude_context." This should track actual backend job state (check `GET /api/ingestion/jobs/<id>/` in dev tools if you want to confirm the frontend isn't faking it).

On completion, you land on the results page.

## 8. Explore a saved context

Check each tab: Overview (plain-English summary + stat cards), the source-specific tabs (Postgres/Mongo/Storage/Codebase — whichever you connected), Architecture (try the diagram's zoom controls and the name filter), Raw JSON. Nothing should be empty/broken — if a tab doesn't apply (e.g. no Mongo connected), it shouldn't appear at all.

## 9. claude_context viewer

From the results page, "View claude_context." Try the task-scoping box (type something like "add an endpoint for user profiles") and confirm the payload visibly shrinks and the `_scoping` info banner explains what happened. Try the token-budget chips (8K/4K/2K) and confirm the size changes accordingly. Try "Copy as Claude prompt" and "Copy JSON" — paste somewhere to confirm they actually copied something real.

## 10. Freshness and diff

Back on the results page, click "Check freshness." If checked against a live source, it should say either "no drift" or specifically what changed — not a generic error. Run the *same* connection through ingestion a second time (without changing anything) and check the "Changes" tab appears and correctly shows "nothing changed."

## 11. Audit log

Go to Audit Log — you should see entries for everything you just did (connection created, ingestion run, etc.), most recent first. Try the search/filter box and the pagination controls.

## 12. Tenant isolation (the important one)

Register a **second** account in a private/incognito window. Confirm:
- The second account's dashboard is empty (doesn't see the first account's saved contexts).
- Manually editing the URL to a context id you copied from the first account (e.g. `/contexts/<first-account's-id>`) shows a "not found" page, not the other account's data.
- Connections and audit log are similarly empty/isolated.

This is mechanically tested already (`pytest` — see `PRODUCTION_READINESS.md` P0-5), but worth seeing with your own eyes once.

## 13. Settings

Check your API token is visible (masked by default, reveal/copy buttons work). This is the token you'd use to set up the MCP server (`docs/MCP.md`) — copy it and confirm it's a real-looking DRF token (40 hex characters).

## 14. Responsive check

Resize your browser (or use dev tools' device toolbar) to roughly 375px, 768px, 1024px, 1440px wide. The sidebar should collapse to a drawer on mobile; nothing should horizontally scroll or overlap. **This hasn't been automatedly verified** (see `PRODUCTION_READINESS.md` P1-10) — this manual pass is currently the only way it gets checked at all.

## 15. Dark mode

Toggle the theme switcher in the top bar. Everything from step 1 onward should still be legible and consistent in dark mode, not just "not broken."

## 16. Error states

- Log out, then try to visit a protected page directly by URL — should redirect to login, not show a blank page or crash.
- Visit a nonsense URL like `/this-does-not-exist` — should show the new 404 page, not silently bounce you to the dashboard.
- Turn off the backend server entirely and try clicking around — should show clear "couldn't reach the server" errors, not indefinite spinners.

## What "done testing" looks like

If everything above behaves as described, the core product loop works end to end as designed. Anything that doesn't match — write it down with the exact step number above; that's a real, reproducible bug report, not a vague "something's off."
