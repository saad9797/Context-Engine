# Contexa context-pack release

The current customer flow uses **Complete handoff**: one self-contained JSON
within one estimated copy budget. See the [current test/deployment guide](docs/RELEASE_CANDIDATE.md)
and [measured contract checks](docs/benchmarks/README.md). Base/task splitting
below remains available as an advanced conversation-reuse option. The trained
pilot model is not integrated; retrieval uses static parsing and dependency tracing.

Contexa's job is to give a coding assistant enough evidence to make a specific change, without making the developer paste an entire project or production database. A schema dump cannot supply ORM relation names, response helpers, authorization contracts, or business requirements. A smaller dump is not enough: selection must preserve those contracts.

## Customer workflow

1. Connect a repository. Optionally add PostgreSQL, MySQL, MongoDB, or object storage to supplement it. Use database accounts with metadata/read-only permissions.
2. Build a snapshot. Repository files are pinned to a commit; files are captured whole, up to explicit capture limits. Private keys and environment files are excluded.
3. Open **Prepare AI packs**. Paste the **base pack** once in a new Claude/ChatGPT/Codex conversation. It contains the detected runtime stack, shared plumbing, and a complete implementation/route example when one fits.
4. Describe the task, endpoints/interfaces, access, business rules, and expected response. Optionally pin repository-relative files.
5. Prepare and copy the **task pack**. It contains requirements, relevant source, Prisma model/enum blocks and one hop of related models, or relevant SQL/MongoDB schema. It references the exact base pack by `base_id`.
6. Read context gaps and omissions. Increase the budget, pin a file, or rebuild when source is missing. Unmatched tasks never silently expand to the entire repository. Copied packs tell the assistant to ask for missing contracts.
7. Run generated code through the project's own compiler, tests, and review. Contexa does not run customer code and cannot promise that another model's output compiles on its first attempt.

Paste the base again in a new conversation, after rebuilding, or if the conversation no longer contains it. Claude free-plan usage also depends on conversation history, model, output, and provider limits; reducing input does not guarantee a fixed number of messages.

## What is supported

| Layer | Implemented | Limits |
|---|---|---|
| JS/TS, Node, Express, React/Next | Babel-parsed complete source units; named/default/namespace import and barrel traversal; nearest captured tsconfig aliases; reverse route mounting and global middleware | Static retrieval, not type checking or semantic understanding. Dynamic loading, inherited behavior, generated code and package exports can require follow-up. Vue/Svelte use a reported whole-file fallback. |
| Prisma | Balanced extraction of complete `model`, `enum`, and `type` blocks; exact relation fields and mapping attributes; referenced enums and one model-relation hop | No DMMF/type checking; very large schema files beyond capture limits require splitting/pinning or a future retrieval adapter. |
| Django/DRF, Flask, FastAPI, SQLAlchemy | Python AST declarations with decorators; local imports/constants; complete model/serializer classes; reverse URL references; captured Django auth/user-model configuration | Inherited/runtime behavior is not reconstructed. Large complete classes can require a larger budget. No customer code is imported/executed. |
| Mongoose and other source-defined models | Complete source files selected by entity name and imports | No execution of schema factories; dynamic runtime fields remain unknown. |
| PostgreSQL | Metadata, columns, UDT names, enum values, keys/relations and constraints; no application-row queries | Existing drift checks remain available. |
| MySQL | Encrypted connections, source picker, async schema inspection, columns including ENUM/SET definitions, primary/unique/foreign keys; verified TLS for remote hosts | One SQL database per snapshot. Live MySQL drift checks, views, routines and CHECK constraints are not implemented. UI reports the freshness gap. Tested with a mocked metadata driver; real-server integration validation remains required. |
| MongoDB | Bounded document sampling for types only; retained validators, shapes, indexes and inferred references | Sample values are not stored. Inferred fields do not establish a complete schema; `$jsonSchema` validators are retained where present. |
| Other languages/frameworks | Existing language detection and complete relevant source (Go/Java/C#/PHP/Ruby/Rust) | Source-assisted fallback, not dedicated semantic adapters. Do not advertise equivalent semantic coverage. |
| MCP | `get_context_packs`, optional `pack: base/task/both`, structured requirements and budgets | Existing `get_context` remains a legacy overview tool. Use task-only responses after loading the matching base. |

Capture currently allows at most 128 KB per file, 2 MB total, 220 files, 100 controller files and 60 per other role. Snapshot metadata records capture limits and failures. Export limits operate on complete units: oversized units are omitted with a reason, not cut at arbitrary character boundaries. Tokens are estimated from compact JSON UTF-8 bytes divided by three; this is not the Claude tokenizer and not a guaranteed hard limit on provider billing.

## Privacy and trust

- PostgreSQL/MySQL inspectors query schema metadata rather than application rows.
- MongoDB reads a bounded sample in memory to infer types, then discards values. Database schema validators may contain intentional enum constants.
- New snapshots and both legacy export endpoints pass through a privacy filter. Historical sample rows/documents, value-bearing shape strings, object samples/folder listings and known credential literals are removed. Source fields and relation names remain useful.
- The new context-pack API uses explicit fields; raw architecture graphs, DB record samples, file trees, scripts, dev dependencies, environment values, generic CRUD hints and commit-author data are not part of copied packs.
- Credential detection is defense in depth, not a universal data-loss-prevention guarantee. Users still review private source, unusual literals and business-sensitive metadata before sharing with an AI provider. Never automatically send repository content to an external model.
- Packs label source as reference data, not instructions. Repository text is untrusted and may include prompt injection. Customer code is parsed/read, never executed by the pack builder.
- Source ownership is checked on context retrieval and rebuild. Rebuild revalidates access to the original connections and GitHub installation. No tokens are returned in pack metadata.

## Upgrade and operate

Use Node.js 22.12+ LTS for the frontend, engine and CI. React Router is 7.18.4; the frontend now uses Vite 8.3.4, Vitest 5.0.5 and React plugin 6.1.2. The full frontend npm audit, including development dependencies, reports no known vulnerabilities. CI installs engine drivers for backend transport/schema tests and checks frontend workflows, the build and the full dependency audit.

The task workspace also supports reviewed folder imports without GitHub or a worker, private immutable saved exports and user-reported outcomes, declared validation scripts, source previews, owner-scoped deletion and bounded storage/build reservations. See [the research and support limits](docs/PRODUCT_RESEARCH.md) before making customer-facing claims. The new `0008_saved_handoffs` migration must be applied.

Backend:

```powershell
cd "Rest Saas"
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py sanitize_snapshots
# Review the dry-run count before removing old record samples:
.\.venv\Scripts\python.exe manage.py sanitize_snapshots --apply
.\.venv\Scripts\python.exe -m pytest -q
```

Engine and frontend:

```powershell
cd "Rest Saas/ingestion/ingestion-engine"
npm ci
cd "../../.."
cd "Rest Saas Frontend"
npm ci
npm run build
npm test
```

Restart web and worker processes after Python changes. Windows development worker:

```powershell
python manage.py rqworker ingestion --worker-class ingestion.workers.WindowsWorker
```

Linux production worker:

```sh
python manage.py rqworker ingestion --worker-class ingestion.workers.ProductionWorker
```

These workers cap Redis idle dequeue waits at 15 seconds (or less for a short socket timeout), leaving a margin below configured managed-provider socket timeouts. Use a process supervisor to restart failed workers and alert on pending jobs, lost heartbeats, failed builds, queue latency and provider rate limits. `runserver` and Windows `SimpleWorker` are development tools; use the existing Gunicorn deployment path and the forking worker in production.

Rebuild existing snapshots to fetch files that the previous 8 KB/60-file/150 KB capture omitted. Sanitization cannot recreate missing source. The rebuild API creates a new snapshot and preserves the old snapshot's identity/history.

For the existing GitHub App, configure OAuth callback to `/api/integrations/github/login-callback/`, setup callback to `/api/integrations/github/callback/`, and enable **Redirect on update**. New manifests now set these separately, enable update redirects, and permit installation on other accounts. Existing app settings still require changing in GitHub's console. Use public HTTPS callbacks outside localhost development.

## API

`POST /api/ingestion/{snapshot_id}/context-pack/` requires the snapshot owner's authenticated token:

```json
{"task":"Add interview scheduling","endpoints":"POST /interviews","access":"Recruiters only","rules":"Reject overlaps and use existing validation","response_shape":"Use the shared response helper","include_paths":["src/controllers/interviewController.ts"],"max_tokens":4000}
```

Response: `{handoff, base, task, report}`. Prefer `handoff` for one self-contained copy within `max_tokens`. `include_symbols` accepts exact declaration names or `path#symbol`. Split base/task budgets remain separate. A too-small budget for request metadata returns an error. `POST /api/ingestion/{snapshot_id}/rebuild/` reuses currently authorized sources, accepts optional `include_paths` to prioritize missing files, and returns a new job id. Paths must be safe repository-relative source paths. Capture also considers generic helper filenames; named folders are not required.

## Release evidence and remaining launch gates

Automated coverage includes exact Prisma mappings/relations/enums, comments and quoted braces, complete source for JS/TS/Python/PHP, import resolution, SQL enums, budgets, unmatched tasks, stable base identity, no retained record samples, tenant isolation, malformed API inputs, UTF-8 runner transport, MySQL metadata-only queries/TLS, and frontend stale-copy prevention.

Before a public launch: complete live MySQL integration tests, browser/mobile/accessibility review, fixture-based retrieval recall evaluation on representative large projects, and human-reviewed generated-code compile/test benchmarks. Add service-level monitoring, deployment/restore drills, retention controls, provider throttling and credential rotation. This change provides a working context-pack release, not evidence that every production/operational launch gate has passed.

Measure the actual customer outcome: required-symbol/model/enum recall, missing-import rate, input tokens per task, unnecessary-source rate, secret/sample leakage, and generated-code compile/test pass rate. Compare the new packs with the old overview on the same tasks and model, then report measured improvements rather than claiming guaranteed first-try code.

## Research behind the design

### Public-data reranker pilot

`docs/training/collect_public_data.py` collects public PR titles and complete small units from pinned **before-change** commits, with root license notices and source attribution. The initial pilot contains 113 candidates across nine tasks and six independent Python/JS/TS framework/ORM repositories. Patch-overlap labels are weak supervision: an unchanged function can still be necessary context. Repository-disjoint evaluation prevents splitting snippets from one project across train/test, but cannot establish absence from the pretrained model's unknown corpus.

The Colab notebook embeds this data and notices; no customer labeling or data upload is required. Weak-label and synthetic runs cannot pass its candidate quality gate or enable production deployment. The CPU baseline is explicitly separate from the full Contexa selector; no generated-code compile outcome is claimed. Broader application/database tasks, retrieval coverage, actual trained-model results and runtime measurements remain release gates. This pilot does not establish universal stack support.

- [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): prioritize small, relevant, high-signal context; retrieval and context management matter more than simply increasing the window.
- [Prisma database mapping](https://www.prisma.io/docs/orm/v6/prisma-schema/data-model/database-mapping) and [relations](https://docs.prisma.io/docs/orm/v6/prisma-schema/data-model/relations): source ORM names and relations cannot reliably be reconstructed from physical table names alone.
- [Django model fields](https://docs.djangoproject.com/en/4.2/ref/models/fields/): choices, foreign keys and related names are application contracts worth preserving in source.
- [TypeScript paths](https://www.typescriptlang.org/tsconfig/paths.html): aliases are project configuration, not safe guesses from filenames.
- [MySQL column metadata](https://dev.mysql.com/doc/refman/8.0/en/information-schema-columns-table.html): `COLUMN_TYPE` preserves detail such as ENUM/SET definitions that `DATA_TYPE` alone lacks.
- [MongoDB validation](https://www.mongodb.com/docs/manual/core/schema-validation/): a validator and a sampled document shape provide different levels of certainty.
- [Stack Overflow 2025 technology survey](https://survey.stackoverflow.co/2025/technology): used to prioritize broad JS/TS/Python and relational/document database coverage, not as evidence that the adapters are complete.
- [RQ connection timeouts](https://python-rq.org/docs/connections/): Redis socket timeouts must exceed worker dequeue waits.
