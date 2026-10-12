# MCP Integration

Contexa ships a Model Context Protocol server (`mcp-server/`) so Claude Code/Claude Desktop can call the platform directly from an agentic coding session instead of a human copy-pasting `claude_context` JSON into a chat.

## Architecture

- **Transport:** stdio (the standard for a locally-run MCP server — Claude Code/Desktop spawns it as a child process).
- **Implementation:** Node.js, `@modelcontextprotocol/sdk`. It is a thin wrapper — every tool is a direct call to the existing Contexa REST API (`Rest Saas/`). No extraction/ingestion logic lives in the MCP server itself.
- **Auth:** the same DRF token any other API client uses, supplied via the `CONTEXA_API_TOKEN` environment variable in the MCP server's own config block (not a separate auth system, not OAuth — see Setup below for how to obtain one).
- **Tenant isolation:** inherited entirely from the backend. The MCP server has no isolation logic of its own — it can only see/do whatever the token's owner can see/do via the REST API, which is the same tenancy boundary verified in `ingestion/tests_tenancy.py`. There is no cross-tenant risk specific to the MCP layer that isn't already covered by the backend's own authorization.

## Tools

| Tool | Inputs | What it does |
|---|---|---|
| `list_projects` | none | Your saved ingestion contexts, summary only (counts, sources included) |
| `get_context` | `context_id` (required), `task` (optional) | The distilled `claude_context`. `task` trims it to what's relevant — check the response's `_scoping.matched`; `false` means nothing matched closely enough and the full context was returned instead |
| `run_ingestion` | one of `postgres_connection_id`/`mongo_connection_id`/`github_installation_id` (+owner/repo), optional `timeout_seconds` (default 180) | Starts a fresh ingestion run and waits for it to finish, returning the new `context_id` |
| `check_freshness` | `context_id` | Age, plus a real live drift check when possible — check `checked_live` before trusting `drifted` |
| `get_changes` | `context_id` | Structural diff against the previous run of the same project — check `has_previous` first |
| `list_connections` | none | Your saved connection ids/names/kinds (never credentials) |
| `list_github_installations` | none | Your connected GitHub App installations |

## Setup

See `mcp-server/README.md` for the exact config snippet. Summary: get a token via `POST /api/auth/login/` (or from `localStorage.cxa_token` in the browser after logging into the dashboard), add the server to Claude Code/Desktop's MCP config with `CONTEXA_API_URL`/`CONTEXA_API_TOKEN` env vars, restart, and ask Claude to "list my Contexa projects" to confirm the connection.

## Verification status

The full 7-tool set was dogfooded successfully in an earlier development session (per `roadmap.md`'s own tracking) against a real 77-table schema. Re-attempted against the *current* backend on 2026-09-28: calling `list_projects` live against the running server returned a real, correctly-formed error — `Contexa API GET /api/ingestion/ → 401: Invalid token.` — rather than a connection failure or a silent hang. This actually confirms the important part: the MCP server correctly makes a real HTTP call to the live API, correctly attaches the configured token, and correctly surfaces the API's own error response instead of swallowing or mangling it. The **cause** is mundane and outside the code entirely — the `CONTEXA_API_TOKEN` currently configured for this local MCP server registration belongs to an account/session that's since been invalidated (several throwaway test accounts were created and deleted during this same audit session; the configured token likely points at one of them, or the token was rotated by a logout elsewhere).

**To finish this verification:** get a fresh token (`POST /api/auth/login/`, or from the dashboard's Settings page — see `Rest Saas Frontend/src/pages/Settings.jsx`, which surfaces the current token directly) and update it in the MCP server's config (`CONTEXA_API_TOKEN`), then re-run `list_projects` through `get_changes` against real saved data. Until that's done, treat this as "plumbing confirmed correct, happy-path not yet re-exercised" rather than either "broken" or "fully re-verified."

## Distribution

Not yet published to npm (`roadmap.md` explicitly defers this) — install via a local path as documented in `mcp-server/README.md`. `npx contexa-mcp` is the eventual target.
