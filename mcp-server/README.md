# contexa-mcp

An MCP server that exposes Contexa's saved ingestion contexts to Claude Code / Claude Desktop directly — no more copy-pasting `claude_context` JSON into a chat by hand.

It's a thin wrapper: every tool here is a direct call to the existing Contexa REST API (`Rest Saas/`). No extraction or ingestion logic lives in this package.

## Tools

| Tool | What it does |
|---|---|
| `list_projects` | List your saved ingestion contexts (summary only — counts, not full schema). |
| `get_context` | Fetch the distilled `claude_context` for one saved context id. Pass `task` to trim it to what's relevant (roadmap.md P2). |
| `check_freshness` | Age, plus a real live drift check against the actual source when possible (roadmap.md P3). |
| `get_changes` | Structural diff (tables/routes/key files added/removed, column type changes) against the last run of the same project (roadmap.md P5). |
| `list_connections` | Your saved Postgres/Mongo/storage connections (ids + names, never credentials). |
| `list_github_installations` | Your connected GitHub App installations. |
| `run_ingestion` | Start a fresh ingestion run against given connection(s)/installation and wait for it to finish. |

## Setup

1. Get an API token: `POST http://localhost:8000/api/auth/login/` with your username/password (or grab it from your browser's `localStorage.cxa_token` after logging into the Contexa dashboard).
2. Install dependencies once: `npm install` in this folder.
3. Add this to Claude Code's or Claude Desktop's MCP config (`claude_desktop_config.json`, or Claude Code's `.mcp.json`):

```json
{
  "mcpServers": {
    "contexa": {
      "command": "node",
      "args": ["/absolute/path/to/Contexa/mcp-server/src/index.js"],
      "env": {
        "CONTEXA_API_URL": "http://localhost:8000",
        "CONTEXA_API_TOKEN": "<your token>"
      }
    }
  }
}
```

4. Restart Claude Code/Desktop. Ask it to "list my Contexa projects" to confirm it's connected.

## Notes

- `CONTEXA_API_URL` defaults to `http://localhost:8000` if unset.
- `CONTEXA_API_TOKEN` is required — every tool call fails immediately with a clear message if it's missing.
- Not yet published to npm — run it via a local path (`node .../src/index.js`) as shown above. `npx contexa-mcp` is the target once published (see `roadmap.md` P1).
