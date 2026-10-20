# Product decisions and evidence — 19 October 2026

The customer job is to give a coding assistant enough **application contracts
for one change**, without repeatedly pasting a repository or a database dump.
Useful context contains authoritative names, relevant implementation and
dependencies, and clear unknowns. Small output alone is not proof of sufficiency.

## Research and priorities

Stack Exchange Inc.'s [2026 language survey](https://survey.stackoverflow.co/2026/technology/data/languages)
reports JavaScript 62.0%, Python 58.0%, TypeScript 43.8%, Java 27.6% and C# 27.1%
among respondents to that question (n=14,099, multiple selections allowed).
Its [database question](https://survey.stackoverflow.co/2026/technology/data/databases)
reports PostgreSQL 57.9%, SQLite 42.1%, MySQL 35.1% and MongoDB 19.0% (n=12,061).
Attribution: Stack Exchange Inc., Stack Overflow Developer Survey 2026,
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). These are survey
respondents, not market shares or the share of developers we support.

[GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
places TypeScript first by monthly contributors in August 2025. That is a
different population and metric from Stack Overflow. Together these sources
support starting with JS/TS and Python, without assuming Java/.NET or other
ecosystems are unimportant. Java, C#, Go, PHP, Ruby and Rust currently receive
bounded whole-file retrieval, not the same semantic dependency coverage.

[Anthropic's context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
supports retrieving high-signal information rather than indiscriminately growing
context. [Aider's repository map](https://aider.chat/docs/repomap.html) demonstrates
the relevance of parsed symbols and references under a token budget.
[Repomix](https://repomix.com/guide/) already addresses repository packing;
[its security guidance](https://repomix.com/guide/security) also illustrates why
secret checking matters. These products' existence is not evidence that our
selection algorithm has equivalent performance. Contexa's intended distinction
is task contracts plus repository/database metadata, an explicit omission report,
and a repeatable handoff workflow across browser-based AI tools.

Framework documentation explains why file-name matching alone misses contracts:

* [Prisma mapping](https://docs.prisma.io/docs/orm/v6/prisma-schema/data-model/database-mapping):
  database names can differ from application model and field names. Preserve
  Prisma blocks, relation names, enums and mappings instead of substituting DDL.
* [FastAPI larger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/):
  dependencies and router mounting can live outside the handler file.
* [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure):
  layouts and templates are loaded by convention, requiring explicit handling.
* [MongoDB validation](https://www.mongodb.com/docs/manual/core/schema-validation/):
  validators and flexible document shapes are different kinds of evidence.
  A sampled shape cannot be represented as an exhaustive schema contract.

## Changes implemented from those findings

| Customer pain | Delivered behavior | Limit |
| --- | --- | --- |
| GitHub setup blocks first use | Review and import a local folder; open the task workspace immediately | Source/manifests only; 220 files, 128 KB each, 2 MB total |
| Generic words retrieve unrelated modules | Exact compound identifiers take precedence over their generic words | Does not infer an unspecified business intent |
| JSX-only imports disappear | JSX component and namespace references participate in dependency traversal | Dynamic runtime component selection remains uncertain |
| Endpoint has no mount/auth context | Trace nested Python packages and FastAPI router mounts/global dependencies | Unsupported grammar is explicitly flagged |
| Page lacks surrounding application contracts | Add ancestor Next App Router layouts/templates and request middleware | Matcher behavior needs review; Pages Router is not a complete convention adapter |
| AI invents validation commands | Include captured package scripts, working directory and manifest path | Scripts are never run; other stacks may require the developer's commands |
| Important libraries fall outside presets | Include imported npm libraries and declared versions, including unfamiliar libraries | Bounded metadata, not lockfile resolution; monorepo version conflicts still need review |
| Work is lost between visits | Private saved request/export history with original output and digest | 30 saved handoffs per snapshot; explicit save action |
| "Precise" cannot be assessed | Private outcome and missing-context feedback per saved handoff | Self-reported; no automatic compilation or accuracy claim |
| Private code lives indefinitely without controls | Delete saved exports or the snapshot and its exports | Database backups require a separately configured retention policy |
| One tenant can exhaust workers/storage | 100 snapshots including active reservations; 2 concurrent builds; throttles | Hosting-wide monitoring/capacity still require live operations |

## Public projects inspected and retained

Four MIT-licensed snapshots are pinned with original license notices under
`benchmarks/public_apps/`. No downloaded app, dependency installation or test
was executed. Collection reads bounded archives in memory, never extracts them.

| Project | Relevant stack | Commit |
| --- | --- | --- |
| [Express RealWorld](https://github.com/SeuRonao/realworld-express-prisma) | Express, TypeScript, Prisma | `1f5a21ed6eec656410655cab9d5d3c7148b57a93` |
| [Django RealWorld](https://github.com/Sean-Miningah/realWorld-DjangoRestFramework) | Django REST Framework, Python | `8e4729aaee0a3deef8fcf5ca53a02b1565440c97` |
| [Official FastAPI template](https://github.com/fastapi/full-stack-fastapi-template) | FastAPI, SQLModel, Pydantic, React | `b1125d8839482cb7bbae603ddc6d0081bf87532e` |
| [Next Real World](https://github.com/jimleestone/next-real-world) | Next.js, React Hook Form, Apollo, Prisma/MySQL | `ed60a30ce642a4544ffdcb5898ef80ee67147f1d` |

Two other candidates were rejected because the collector could not establish
an explicit compatible root license. They were not retained as fixtures.
These four cases are regression evidence, not a representative market sample.
They informed implementation and therefore are not blind held-out evaluation.

Run `benchmarks/run_context_checks.py` and `benchmarks/expanded_checks.py`.
The reports include exact commits, fixture hashes, omissions and budget checks.
At 10,000 estimated tokens all 34 explicitly checked contracts are present
across the four tasks. FastAPI remains flagged incomplete because one file uses
newer Python grammar: the full original file and conservative imports are kept,
but dependency analysis cannot be certified. Tight budgets can omit additional
dependencies even when all our explicit marker checks happen to pass.

## What the release does and does not establish

There is no trained selector integrated and no per-request AI API cost.
Static analysis and retrieval are real working functionality. They cannot
prove the minimum sufficient context for an arbitrary new task. Source data
is untrusted reference data; generated code still requires review and checks.
No code-generation model was called for these evaluations. No provider's free
usage limits, generated-code compile success or customer success rate was
measured. Smaller JSON does not guarantee a longer Claude free-plan session.

The next evidential step is consenting customer trials on new tasks: hold
model/version and total input budget constant, record requests for missing
contracts, actual compiler/test outcomes and time to a usable change. The new
saved-handoff outcomes make individual review possible; they do not create
independent training labels or authorize using private code for training.

This release includes deployment configuration and automated checks, but live
OAuth, TLS, managed database/Redis, backup restoration, operational alerting,
payment-provider setup and browser/device acceptance remain environment-specific.
Do not sell universal stack support, guaranteed first-compile output, or a
production SLA on the basis of local retrieval tests.
