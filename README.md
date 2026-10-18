# Contexa

**New: reusable base packs and task-specific AI context.** Connect your repository, describe a change, and copy complete relevant code contracts, ORM models and enums within an estimated budget. Database records are excluded. See [the context-pack release guide](PRODUCTION.md) for usage, supported stacks, upgrade steps, privacy behavior, verification, and remaining launch gates.

An automated context-extraction platform: connect a codebase, a database, and cloud storage, and get back one distilled, structured JSON context package sized for handing to an AI coding assistant — instead of pasting files by hand or letting an agent re-derive the same facts on every session.

See `problem.md` for the motivating pain point, `Contexa_Project_Proposal.docx` for the full product proposal, and `roadmap.md` for what's being built next.

## Layout

```
Rest Saas/            Django + DRF backend — auth, tenancy, encrypted connections,
                       GitHub App integration, async ingestion jobs (Django-RQ),
                       and the Node.js ingestion engine under ingestion/ingestion-engine/
Rest Saas Frontend/   React + Vite console — connections, ingestion runs, saved
                       contexts, architecture graph view, audit log
mcp-server/           MCP server exposing saved contexts to Claude Code/Desktop
                       directly, instead of copy-pasting JSON into a chat
problem.md            The original problem statement
initial_idea.md       Earlier draft of the idea before it became Contexa
gaps.md               Security/architecture review that shaped the current backend
roadmap.md            Prioritized plan for evolving this into a usable product
```

## Getting started

Backend setup, environment variables, and the GitHub App onboarding flow are documented in `Rest Saas/README.md`. The frontend is a standard Vite app — `npm install && npm run dev` from `Rest Saas Frontend/`.

Both the backend and the ingestion engine need a `.env` — copy `Rest Saas/.env.example` to `Rest Saas/.env` and fill in real values locally. **Never commit a real `.env`** — see `.gitignore`.
