# Contexa: Evolution Roadmap

*What to build next to turn the current prototype into a product developers actually adopt and pay for.*

This document picks up from `problem.md`, `initial_idea.md`, `gaps.md`, and `Contexa_Project_Proposal.docx`. It assumes the security/architecture work in `gaps.md` is done (it is — auth, tenancy, encrypted connections, GitHub App, async jobs, SSRF guard, unified architecture graph all exist and are tested). This document is about the next layer: **making the thing worth using**, not just safe to run.

---

## 1. The one-sentence reframe

The proposal pitches Contexa as "give Claude everything it needs to write production-ready code without errors." That's the wrong promise, and believing it will misdirect the roadmap.

**The real, honest, sellable claim:** Contexa is an **orientation layer**. It answers "what does this system actually look like" fast and cheaply, for things a coding assistant cannot cheaply discover itself (a live database's real schema, a cloud bucket's real structure, cross-cutting relationships between DB and code). It does **not** replace reading the actual file you're about to edit — no assistant should generate a change against a schema summary without opening the real model file first.

Every decision below follows from this reframe. The product's job is to eliminate *discovery* cost, not *verification* cost. Chasing "zero-error code generation from JSON alone" leads to a package that's either too vague to be useful or so large it defeats its own purpose.

---

## 2. Where the product actually stands today

Worth being precise about this before planning further, because the proposal's roadmap (Phases 1–6) doesn't match reality one-to-one.

| Proposal phase | Status |
|---|---|
| 1. Ingestion Engine (Postgres, Mongo, GitHub, cloud storage) | **Done**, and hardened: SSRF-guarded, async (RQ), scan-all-databases for Mongo, redaction, encrypted connection storage. |
| 2. Aggregation & Schema (unified JSON, versioned) | **Partially done.** One JSON envelope exists (`claude_context`) with a stable-ish shape. No schema version negotiation, no diffing between runs of the same project. |
| 3. Optimization Layer (relevance ranking, task-scoped export) | **Not built.** Every context returns everything, every time. |
| 4. Cloud/Infra Introspection | **Done** for S3/Azure Blob; env var handling (proposal §6.4) is **not built at all**. |
| 5. Delivery Layer (dashboard, REST API, CLI) | **Dashboard + REST API done.** No CLI. No MCP server (the thing that actually closes the loop with Claude Code). |
| 6. SaaS Shell (auth, quotas, billing, teams) | **Auth + per-endpoint rate limiting done.** No billing, no teams/orgs, no quotas per plan tier. |

So: the extraction engine — the hardest, most novel part — is genuinely solid. What's missing is almost entirely on the *consumption* side (how does a context package actually get used) and the *trust* side (how do you know it's still accurate, how is it shared safely). That should reorder priorities relative to the original proposal, which spent most of its detail on extraction.

---

## 3. Priority-ranked roadmap

Ranked by "how much this unlocks the core value prop," not by build difficulty. Effort is rough (solo dev, reusing what already exists).

### P1 — MCP server (Claude Code / Claude Desktop integration)

**Why first:** everything else you build is wasted if the delivery mechanism stays "copy JSON, paste into chat." That's friction a developer routes around after the second use. An MCP server is the difference between "a tool I remember to use" and "a tool that's just there."

**What to build:**
- A thin MCP server (Node, using the official `@modelcontextprotocol/sdk`) that wraps your existing `GET /api/ingestion/<id>/claude-context/` endpoint.
- Tools to expose:
  - `list_projects` — the user's saved contexts (id, project name, repo, last ingested).
  - `get_context(project_id, scope?)` — fetch the distilled context, optionally scoped (depends on P2).
  - `run_ingestion(project_id)` — trigger a fresh run and poll until done, so staleness can be fixed from inside a Claude Code session instead of switching to the browser.
  - `check_freshness(project_id)` — depends on P3, but even a stub ("last ingested 6 hours ago") is useful immediately.
- Auth: reuse the existing DRF token — the MCP server just needs the user's API token in its config, same as any other API client.
- Ship it as an npm package (`npx contexa-mcp`) with a one-line config snippet for `claude_desktop_config.json` / Claude Code's MCP settings. This is also a distribution channel — "add one line to your MCP config" is a much lower-friction install than "sign up for a SaaS dashboard."

**Effort:** small–medium. You already have the API; this is a translation layer, not new extraction logic.

**This is the single highest-leverage thing you can build right now.**

---

### P2 — Task-scoped optimization layer

**Why:** this is the layer your own proposal (§6.6) says "directly answers the cost problem," and it's the one thing standing between "aspirational token savings" and "measured token savings" you can put a number on in your pitch.

**What to build:**
- Accept an optional `task` string (or a small `{ area: "backend" | "frontend" | "email" | ..., keywords: [...] }` payload) alongside a context request.
- Score relevance per section of the existing `claude_context`:
  - Tables/collections: keyword match against name, column names, and detected roles (`route/controller`, `data-model`, etc. — you already tag these in `key_files_by_role`).
  - Route patterns: match against the task keywords the same way.
  - Storage containers: only include if the task mentions upload/file/image/etc., or if `object_storage_column_mapping` links a relevant table to it.
- Start with **keyword/heuristic scoring, not embeddings.** The proposal mentions pgvector/RAG for this — don't build that yet. A cheap TF-ish match against already-structured field names (which you have, because your inspectors already extract them) will get you 80% of the value with none of the infra (no vector DB, no embedding cost, no retrieval-quality tuning). Save embeddings for when heuristics visibly fail on a real user's repo.
- Output both: the full package (fallback, always available) and the scoped one, so a user can compare — this comparison *is* your proof for the token-savings claim. Log the before/after token count (rough estimate via a tokenizer library) so you can show real numbers, not projected ones.

**Effort:** medium. This is new logic but sits entirely on data you already extract — no new ingestion work.

---

### P3 — Freshness / drift detection

**Why:** an outdated context package is worse than no context package, because nobody thinks to double-check it. This is a trust mechanism, and trust is the actual thing you're selling (a developer has to trust the package enough to hand it to an assistant without re-verifying everything by hand — otherwise the product saves no time).

**What to build:**
- Store a lightweight fingerprint per source at ingestion time: for Postgres/Mongo, a hash of the schema shape (table/column names + types, or collection names + merged field set) — not the data, just the shape. For GitHub, the commit SHA already ingested.
- A cheap `check_freshness` endpoint: re-fetch just the shape fingerprint (fast — no full sampling pass) and compare. Surface `"schema changed since last ingestion"` as a clear signal, not a silent staleness.
- Surface this everywhere the context is consumed: the dashboard, the API response itself (`_meta.freshness: { checked_at, drifted: bool }`), and the MCP tool.
- Nice-to-have once this exists: a scheduled re-check (not full re-ingestion) so the dashboard can show "3 of your 5 projects have drifted" without the user asking.

**Effort:** small–medium. Reuses existing inspectors, just runs a cheap subset of what they already do.

---

### P4 — Env var / secrets handling (proposal §6.4 — currently entirely missing)

**Why:** you've already invested heavily in security posture (encrypted connections, SSRF guard, GitHub App instead of PATs, audit log — see `gaps.md`). Env var handling is explicitly described in your own proposal as opt-in-per-key with no scraped values, and right now none of that exists. This is a credibility gap if a security-conscious team evaluates the product against its own pitch deck.

**What to build:**
- A per-project list of env **key names** (not values) the user explicitly opts into including — read from a `.env.example`/`.env.template` file already visible in the ingested repo (you already parse this for `env_template` in the codebase inspector — surface the *keys* from it as a checklist, don't add new scraping).
- For each opted-in key, infer purpose from the name (regex heuristics: `*_URL`/`*_DSN` → connection string, `*_KEY`/`*_SECRET`/`*_TOKEN` → credential, else → config) and record that inference plus a `present: bool`, never a value — matching what the proposal already promises.
- Explicitly exclude anything matching your existing `SENSITIVE_KEYS` pattern (already defined in the Mongo/Postgres inspectors) from ever being eligible to opt into, even manually.

**Effort:** small. Mostly a UI + a naming-heuristic function; no new infrastructure.

---

### P5 — Versioning & diffing

**Why:** "reusable and versionable" is one of your four core value props (§4) and currently a context package is just an unversioned snapshot that gets overwritten by the next run. Diffing is also what makes P3 (drift) actionable instead of just alarming — "here's what changed" is more useful than "something changed."

**What to build:**
- Don't overwrite `IngestionContext` on re-run — you already create a new row per run, which is good. Add a `previous_context` FK or a lightweight diff computed on demand between two runs of the same project (same repo/connection refs).
- Diff at the shape level (tables added/removed, columns added/removed/type-changed, routes added/removed) — not a raw JSON diff, which would be noisy on every timestamp/sample-data change.
- Surface this as a real feature in the UI (a "What changed since last run" view) — this is also genuinely useful to a *human* teammate reviewing what the codebase looked like when they left vs. now, independent of AI use at all.

**Effort:** medium. Mostly UI + a diffing function over already-structured data.

---

### P6 — The human-facing moat (underweighted in the current proposal)

**Why this matters strategically:** the proposal's differentiation table (§8) frames Contexa entirely against AI-assistant context problems. That's real, but it's also the part most exposed to being commoditized — Claude Code, Cursor, and Copilot are all actively improving at live repo exploration and caching (this very project uses a memory-file system for exactly that reason). A product whose entire pitch is "we're a cache in front of what agents will eventually do themselves" has a shrinking moat.

The harder-to-copy angle is **cross-system, human-readable system documentation that happens to also be AI-consumable** — not the other way around. A live, always-current "here is what our system actually looks like" view (the architecture graph you already built in `gaps.md` item 6) is valuable to:
- A new hire on day one, with no AI involved at all.
- A team lead deciding where a new feature should live.
- An auditor or new CTO doing due diligence on an unfamiliar codebase.

**What to build:**
- Invest in the **Architecture Graph view** (already exists as a grouped list per `gaps.md`) becoming an actual visual diagram — this was explicitly flagged as a follow-up when it was first built. This is the single most demo-able, screenshot-able feature you have, and demos sell SaaS products more than JSON schemas do.
- Add a plain-English summary layer on top of the raw graph: "This app has 3 core resources (Users, Courses, Enrollments), a Django REST backend, and stores assignment files as binary blobs directly in Postgres rather than object storage" — generated once per ingestion (you can literally use Claude for this generation step, calling it from `tasks.py` after the graph is built) and cached alongside the context package. This single paragraph is what a new developer actually wants to read first, before touching JSON at all.

**Effort:** medium–large (the visual diagram specifically; the plain-English summary is small since it reuses infrastructure you already have).

---

## 4. Target audience — sharpen it

The proposal's four target-user bullets (§13) are all reasonable but too broad to design against simultaneously. Pick a primary for the next 2–3 months of building, because P1–P6 above serve them differently:

- **Best-fit primary right now: developers newly onboarded to an existing, non-trivial codebase** (your own origin story, and the sharpest pain point in `problem.md`). This user has the least tribal knowledge, the most urgent need, and the clearest "aha" moment when a Mongo cluster's real shape shows up in one JSON file instead of three days of asking teammates. Design the MCP flow and the plain-English summary (P6) specifically for this person's first hour with a new repo.
- **Secondary, once P2 exists: solo/freelance developers juggling multiple client codebases** — the task-scoping and multi-project switching in the MCP server matters most here.
- **Defer:** the team/org tier and the visual drag-and-drop API generator from `initial_idea.md`. That's a different, much larger product (a code-generation platform, not a context platform) and building toward it now would dilute focus before the core context product has proven its value with real usage.

---

## 5. Competitive positioning — the sentence to actually use

Don't pitch against Claude Code/Cursor's context window. Pitch against what they structurally cannot do:

> "Claude Code can read your files. It can't see inside your database, and it re-discovers your architecture from scratch every session. Contexa gives it both, in one call, and keeps a version history a human can read too."

This survives the "agents are getting better at exploring repos" objection, because it's true regardless of how good repo exploration gets — an LLM still cannot query a live Postgres/Mongo instance's real shape without a tool built for exactly that.

---

## 6. Metrics that prove the value prop (build these before charging money)

You cannot sell "cuts your AI costs" on faith. Instrument it from day one of P2:

- **Token count, before/after**, per context request: full package size vs. task-scoped size vs. what a comparable manual file-paste would have cost. Log this server-side; surface an aggregate ("You've saved an estimated N tokens this month") on the dashboard. This number is your entire pricing justification.
- **Time-to-first-correct-generation** for a new project: how long from "connect repo" to "assistant produces a working, on-convention API endpoint" — this is the onboarding pain point from `problem.md` made measurable.
- **Drift rate**: how often a project's schema changes between ingestions — this validates (or kills) the need for P3/P5 investment, and is a good "we take this seriously" data point for security-conscious buyers.

---

## 7. Suggested build order (next 2–3 months, solo)

1. **P1 (MCP server)** — smallest effort, unlocks real usage of everything already built, lets you start dogfooding immediately.
2. **P2 (task-scoped optimization)** — turns the core pitch from aspirational into measured; do this while dogfooding P1 so you have real tasks to test scoring against.
3. **P3 (freshness/drift)** — cheap, and directly addresses the biggest trust risk once people start actually relying on the MCP flow day-to-day.
4. **P6's plain-English summary** — small effort, disproportionate demo/onboarding value; do this before investing in the full visual diagram.
5. **P4 (env vars)** — closes a real gap against your own security pitch; low effort, do it opportunistically alongside the above.
6. **P5 (versioning/diffing) and P6's visual diagram** — bigger investments, justified once P1–P3 prove people are actually using this repeatedly (versioning only matters if there's a "before" to compare against — i.e., repeat usage, which P1 is what drives).

Deliberately not in this list yet: billing, teams/orgs, the visual drag-and-drop builder, fine-tuned LLM generation, vector search/RAG. All of those are real parts of the longer-term proposal, but building them before P1–P3 prove the core loop works risks polishing a product nobody has validated wants the thing you're polishing.
