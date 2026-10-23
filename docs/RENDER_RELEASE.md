# Render routing fix and release verification

The live frontend is `https://context-engine-frontend.onrender.com` and its
compiled API origin is `https://context-engine-z4s8.onrender.com`.

## Confirmed live failures

Direct GETs to `/dashboard`, `/login` and `/connections` returned Render's
plain-text 404, while `/` and the compiled JavaScript returned 200. React's
BrowserRouter cannot run until the host serves `index.html` for deep links.

The backend `/healthz` returned 200. An initial `/readyz` request returned 503
with `database_unavailable`; a subsequent deployment check returned 200 with
both PostgreSQL and Redis healthy. Investigate that intermittent database
failure in the service logs and monitor readiness across deployments.
CORS for the deployed frontend was healthy.
Authentication correctly rejects unauthenticated protected API requests.
These observations do not constitute an authenticated customer acceptance test.

## Source validation (2026-10-23)

- Frontend: 60 tests passed across 15 files, including login deep-link return,
  safe return destinations, API timeouts and hosting error responses.
- Production build passed with the deployed HTTPS API origin. A localhost API
  origin was deliberately rejected by the production build guard.
- The built production frontend served the same app shell at all ten direct
  route shapes when tested with Vite preview.
- Local deployment smoke checks passed: routes, assets, liveness, readiness,
  authentication enforcement and CORS.
- Final public deployment smoke check still failed on all ten deep routes (404).
  The public API, readiness, CORS and unauthenticated enforcement passed.
- Render Blueprint YAML parses and points to the generated static output. It
  has not been synced or accepted by Render in this session. No Render account
  connection or deployment credentials were available.

## Apply the host routing fix

For the **existing** static site, open Render > context-engine-frontend >
Redirects/Rewrites and add:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | **Rewrite** |

Keep existing specific redirects ahead of the catch-all. Do not redirect users
to `/index.html`: the URL must stay `/dashboard` or the requested deep link.
Render serves real assets before applying a matching rewrite.

The root `render.yaml` defines this same rule, security/cache headers, root
directory, build/publish commands and the existing public API origin. Sync it
through a Render Blueprint to manage the service in source control. Adding the
file to a manually-created service's repository does **not** by itself change
that service's routing settings. Review the Blueprint plan before applying it;
it must update the existing frontend rather than create an unrelated duplicate.

## Verify the production database

Inspect the backend's Render logs, database status and `DATABASE_URL` in Render's
environment settings. Verify the database is running, the URL belongs to the
intended production PostgreSQL instance, credentials are current, and network
and TLS settings permit access. Do not copy the local SQLite database into
production or generate a new empty database over customer data. Back up an
existing production database before schema migration.

After database connectivity is restored, run `python manage.py migrate --noinput`
using the deployed release and verify `/readyz` returns 200. Both migrations 0009
and 0010 are required for the new context preparation/vector cache workflow.

## Build and run the release

The current release defaults to fast source/dependency retrieval and a
10,000-token export budget. Expanded semantic search is an explicit slower
option. Deploy both the frontend and backend and restart the context worker so
the new request policy is used. See `benchmarks/fast_report.json` for bounded
local latency evidence; it is not an end-to-end production timing guarantee.

The frontend now requires a public HTTPS API origin for a production build:

```powershell
cd 'Rest Saas Frontend'
$env:VITE_API_BASE_URL='https://context-engine-z4s8.onrender.com'
npm ci
npm test
npm run build
```

Vite reads this variable at build time. Changing a Render variable requires a
new build/deploy. No secrets belong in `VITE_*` variables. Local `npm run dev`
continues to default to localhost; explicitly local artifact builds can use
`npm run build -- --mode development` and must not be published.

Deploy the backend and separate ingestion/context workers using
[CONTEXT_WORKFLOW.md](CONTEXT_WORKFLOW.md). PostgreSQL, Redis and workers must
share the correct environment. Semantic model weights must be provisioned on
the context worker. Never claim semantic retrieval based on a keyword fallback.

## Verify the deployed product

```powershell
cd 'Rest Saas Frontend'
npm run check:deployment -- --frontend https://context-engine-frontend.onrender.com --api https://context-engine-z4s8.onrender.com
```

This checks direct loads for all route shapes, matching app HTML, JavaScript
content type, backend liveness/readiness, authentication enforcement and CORS.
It exits nonzero while a host rewrite or database readiness check fails. It
does not create accounts, inspect private projects, execute source or call a
coding model.

Then test with an authorized account: refresh a saved task URL, log out and log
back in to that same URL, import a real project, prepare context, copy it into
an AI, and run the generated change's acceptance checks. Repeat the source/error
follow-up and save/restore/delete flows. Test Google/GitHub callbacks on the real
domains if those login methods are enabled.

The source fix is reviewable, but the live routing fix and authenticated release
workflow still require deployment and verification. Paid subscription checkout, merchant setup, support/legal
details, recovery email delivery, backup restoration and production monitoring
need concrete business configuration and live verification; a routing patch is
not evidence that those are operational.

References: [Render rewrites](https://render.com/docs/redirects-rewrites) and
[Blueprint configuration](https://render.com/docs/blueprint-spec).
