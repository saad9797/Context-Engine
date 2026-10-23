# Rest Saas Frontend

React 18 + Vite + MUI console for Contexa — connections, ingestion runs,
saved contexts, the claude_context viewer, the architecture graph, and the
audit log. Talks to the Django backend in `../Rest Saas/` over its REST API
with a DRF token (`Authorization: Token <key>`).

## Requirements

- Node.js 22 LTS (22.12 or later) or 24 LTS. The Vite 8 / Vitest 5 toolchain requires a compatible current runtime.
- The backend running (see `../Rest Saas/README.md`) — this app has no
  standalone mode; every page calls the API.

## Local development

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`. The backend's `CORS_ALLOWED_ORIGINS`
already defaults to include this — no extra config needed for a stock
local setup.

## Environment variables

None are required for local dev — the API base URL defaults to
`http://localhost:8000`. To point at a different backend, create `.env`:

```
VITE_API_BASE_URL=http://localhost:8000
```

(Vite only exposes env vars prefixed `VITE_` to client code — see
`src/api/client.js` for the resolution logic.)

## Build

```bash
VITE_API_BASE_URL=https://your-api.example.com npm run build  # outputs to dist/
npm run preview  # serve the production build locally to sanity-check it
```

`dist/` is a static site — any static host (Vercel, Netlify, S3+CloudFront,
nginx) can serve it. It needs the backend's real URL baked in at build time
via `VITE_API_BASE_URL`. Production builds reject missing, insecure or localhost API origins.

For PowerShell, set `$env:VITE_API_BASE_URL='https://your-api.example.com'` before
running `npm run build`. Local development still defaults to localhost.

BrowserRouter requires a host fallback to `/index.html` for direct links and
refreshes. On Render use source `/*`, destination `/index.html`, action **Rewrite**.
See [Render release instructions](../docs/RENDER_RELEASE.md) and the root
[render.yaml](../render.yaml); manually created services need the rule applied
in their Render settings or a Blueprint sync.

## Project structure

```
src/
  api/            fetch client + browser-side transit-encryption helper
  context/        Auth and theme-mode React context providers
  components/     shared components (PageHeader, EmptyState, StatusBadge,
                   ConfirmDialog, ToastProvider, SearchField, ...) and
                   components/results/ (context viewer, architecture
                   diagram, diff/changes views)
  pages/          one file per route — see src/App.jsx for the route table
  theme.js        the single source of truth for color/type/spacing tokens;
                   don't scatter raw hex codes or px values through pages
```

## Verification

`npm test` runs the frontend component and workflow tests. `npm run build`
checks the production bundle. After deployment, run:

```bash
npm run check:deployment -- --frontend https://your-site.example.com --api https://your-api.example.com
```

This read-only check covers direct route loads, assets, API readiness, CORS and
unauthenticated access enforcement. It does not replace authenticated customer
workflow checks or visual/cross-browser QA. See the release instructions above.
