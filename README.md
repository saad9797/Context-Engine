# Contexa

**Task-specific context in one copy.** Connect a repository, describe a change, and prepare a self-contained handoff with source contracts, dependencies, ORM models and explicit gaps within one estimated budget. Large JS/TS/Python files contribute complete source units. Database records are excluded. Start with the [test and deployment guide](docs/RELEASE_CANDIDATE.md) and [measured contract checks](docs/benchmarks/README.md). A custom trained model is not enabled.

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

Backend setup, environment variables, and the GitHub App onboarding flow are documented in `Rest Saas/README.md`. Use Node 22.12+ LTS and `npm ci` then `npm run dev` from `Rest Saas Frontend/`.

For the current customer workflow, use [the release guide](docs/RELEASE_CANDIDATE.md): review a local folder or connect sources, describe one change, inspect the selected contracts and gaps, then copy the handoff into your AI chat. Private saved handoffs preserve the request and original export for later. [Research and support limits](docs/PRODUCT_RESEARCH.md) explain the stack priorities, public-codebase checks and what remains unproven.

Both the backend and the ingestion engine need a `.env` — copy `Rest Saas/.env.example` to `Rest Saas/.env` and fill in real values locally. **Never commit a real `.env`** — see `.gitignore`.
