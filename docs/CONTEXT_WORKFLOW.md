# Task context and repair workflow

Contexa prepares source evidence for a bounded change. It cannot guarantee that
a particular free chat model will implement it correctly or have enough usage
remaining. Verify the resulting change against the project's acceptance criteria.

## Install and run

Use the existing backend/frontend setup, then apply migrations 0009 and 0010:

```powershell
cd 'Rest Saas'
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe -m pip install -r requirements-semantic.txt
.\.venv\Scripts\python.exe manage.py prepare_code_model
.\.venv\Scripts\python.exe manage.py rqworker context --worker-class ingestion.workers.ContextWorker
```

Keep the existing ingestion worker for connected-source snapshots. The context
worker is separate and persistent: it loads the model before accepting jobs.
Compressed float32 vectors are stored privately with the
snapshot, keyed by source hashes and model/window policy, so restarts reuse the
index. Index checkpoints also allow retries to reuse completed work. Deleting
the snapshot cascades to this cache. In local `INGESTION_EXECUTION_MODE=inline`,
a single background
thread prepares context without Redis job dispatch. Production uses worker mode.
Never use inline mode to bypass production capacity management.

The revision is pinned in `ingestion/semantic.py`. Model preparation downloads
public weights and model implementation; review that pinned implementation when
upgrading it. Customer requests use local files only and never download models.
Customer source is processed on your server, not sent to Hugging Face.
Source-derived vectors/hashes are private snapshot data in the database; source
text is not duplicated in the vector cache. Standalone benchmark callers use a
bounded process cache. Customer job source is not retained in a global AST cache.
`CONTEXA_SEMANTIC=0` explicitly disables semantic search. Missing packages/weights,
capacity errors and busy inference fall back to lexical search and are reported
in the workspace. A fallback is not reported as successful semantic retrieval.

For containers, build the base before the context image:

```sh
docker compose -f compose.production.yml build web
docker compose -f compose.production.yml build context
docker compose -f compose.production.yml up -d
```

The context image installs CPU torch and prepares the pinned model at build time.
It has a separate 3 GB memory ceiling; profile your workload before sizing live
capacity. These Docker instructions require validation in a Docker environment.
The development compose context service runs lexical retrieval by default; use
the model image for semantic retrieval. No paid API account is required.

## Customer experience

1. Import a folder or connect a repository. Review excluded files before upload.
2. Describe one change, its access rules and observable acceptance criteria.
3. Prepare context. This starts a background job; reload resumes the same job.
4. Review source coverage, selected contracts and gaps. Copy the handoff into
   the AI chat. Its embedded instructions request missing source before coding.
5. Paste an AI source request or compiler/test error into the follow-up box.
   Prepare again. The refreshed handoff includes the original request and the
   feedback; it replaces the previous export for that snapshot.
6. Apply patches and run checks locally. Reimport/rebuild after code changes,
   before requesting another implementation. The update-folder and rebuild actions
   carry the prepared task into the new snapshot. Contexa never runs customer code.
7. Save a handoff and record its outcome. Saving a prepared job preserves its
   exact output, rather than recomputing a potentially different selection.

Source capture supports 1,200 eligible files, 512,000 UTF-8 bytes per file and
12,000,000 bytes total. The export has its own 1,000–32,000 estimated-token
budget. Source files over capture limits are excluded, never silently cut.
GitHub role quotas have been removed. API tree truncation and skipped eligible
folder files mark capture partial. Folder scope is always a user selection,
not proof that an entire repository was uploaded. Secrets and generated files
remain excluded. Relevant source tests can now be selected as behavioral evidence.

Default retrieval uses weighted lexical source matching and static dependency
closure without model inference. The workspace defaults to a 10,000-token
copy budget because smaller budgets dropped required markers in regression
fixtures; users can choose smaller copies, but must review omissions.
The API accepts `retrieval_mode: fast` (default) or `semantic`. Expanded semantic
search is an explicit slower option, not a requirement for preparing context.

Expanded search combines weighted lexical matching and CodeRankEmbed using reciprocal
rank fusion, then follows static dependencies and supported framework conventions.
Explicit file/symbol pins are preserved. Exact compound identifiers retain their
scope. Long embedding inputs are searched through overlapping tokenizer windows;
exported source units remain intact. Similarity is not a confidence percentage.
JS/TS/Python have dedicated source parsing; other languages use whole-file
fallback with a visible analysis limitation.

## Operations and privacy

`POST /api/ingestion/{snapshot}/prepare/` returns a preparation ID with HTTP 202.
`GET /api/ingestion/{snapshot}/prepare/{id}/` returns pending/running/failed or
succeeded with output. Every operation is owner-scoped and sends `no-store`.
Two preparations per account may be active. Temporary jobs expire after 24 hours
and at most ten completed jobs per account are retained on subsequent creation.
Pending jobs expire after 15 minutes; running jobs expire after 15 minutes
without progress, and production RQ execution has a 15-minute timeout. The UI
allows queueing plus execution time. Missing workers fail fast instead of
stranding new requests. Cleanup is lazy on prepare/poll;
schedule `python manage.py cleanup_context_preparations` for wall-clock retention.
Deleting a snapshot cascades to its preparations and saved handoffs.

Only the preparation ID is stored in browser session storage for reload recovery.
Original requests, pasted logs and exports are private server-side data. Known
credential patterns are redacted; users must remove other sensitive log content.
Backups need their own retention policy. Source is reference data, not executable
instructions. Source hashes prevent unchanged windows being embedded repeatedly.

The synchronous legacy `context-pack/` endpoint uses lexical retrieval to avoid
loading models into web processes. New UI task requests use the background path.

## Evidence required for reliability claims

Run the backend/frontend suites and pinned public-app contract checks. These
establish mechanics and regression behavior; they do not establish generated-code
success. Use `docs/benchmarks/evaluate_hybrid.py` to compare lexical and hybrid
retrieval on reproducible fixtures, recording missing contracts, unwanted source,
budgets and latency. These fixtures informed implementation and are not blind.

Before advertising a success percentage, evaluate at least 30 new tasks across
unfamiliar projects using the same receiving model and equal input budgets.
Compare manual context, lexical Contexa and hybrid Contexa. Record acceptance-test
outcomes, preparation effort, missing-context requests, repair turns and operating
cost. Review failures to separate retrieval, requirements and model errors. Do
not substitute source-marker coverage for a successfully completed change.

## Local verification recorded for this implementation

The pinned weights were SHA256-checked and real local inference was exercised.
`benchmarks/hybrid_report.json` compares lexical and hybrid retrieval on four
previously used public fixtures. Both retained the same 34/34 checked contracts
at a 10,000 estimated-token budget. Tight 4,000-token exports remain incomplete.
No additional explicitly forbidden markers appeared. These results show that the
integration preserves these checks; they do not demonstrate better coding-model
success or independent generalization.

On this shared, memory-constrained 8 GB Windows machine, cold searches took about
76?872 seconds, while cached searches took about 0.6?7.2 seconds. Model loading
also has startup cost. These are local observations, not production latency
promises. The persistent snapshot cache and worker preload address repeat work;
initial indexing still needs suitable hosting capacity and clear user progress.

`benchmarks/workflow_smoke.json` records a real isolated local HTTP flow through
login, background preparation, CodeRankEmbed, follow-up source selection, log
redaction, cache reuse across process restart and exact export saving. It did not
invoke a coding model or execute customer source. Browser surfaces were not
available for visual review. Component tests and the production frontend build
were used; Docker execution and live deployment remain environment checks.

## Latency evidence and release gate

Run `python docs/benchmarks/evaluate_fast.py` from the repository root using the
backend environment. See `docs/benchmarks/fast_report.json` for three repeated
retrieval calls at each budget over four fixed fixtures. These measurements
start with captured source and exclude upload, source ingestion, worker queue,
HTTP, hosting cold starts and real coding-model outcomes. They are not a live
latency SLA. Fast mode avoids embedding inference and the duplicate lexical
selection pass; ranking computes document lengths once.

The existing context worker is shared by both modes. A slow semantic job can
still delay fast jobs. Before public launch, measure end-to-end latency under
concurrent traffic and provision separate worker capacity/queues if expanded
search is offered to customers. A target such as 95% of ordinary preparations
within 10 seconds is a release criterion, not a result established here.

A meaningful acceptance test must give only the exported context and task to a
fresh free AI chat, apply its patch in an isolated checkout, run the project's
checks and inspect behavior. Compare with task-only and manually selected
context. Track completed changes, repair rounds, missing source and latency on
unseen projects. Retrieval marker coverage does not prove coding success.
