"""Generate a self-contained Colab notebook without installing ML packages locally."""
import ast
import base64
import hashlib
import json
from pathlib import Path
import textwrap
import zlib

ROOT = Path(__file__).resolve().parent
cells = []


def md(text):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": textwrap.dedent(text).strip() + "\n"})


def code(text):
    source = textwrap.dedent(text).strip() + "\n"
    ast.parse(source)
    cells.append({"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source})


md("""
# Contexa — train and evaluate a context reranker

**Start here:** upload this notebook to Colab, select **Runtime → Change runtime type → GPU**, then **Runtime → Run all**.
The default public pilot is self-contained and uses licensed, public, before-change source. No Contexa API token, paid model API, Hugging Face login, local setup, or private repository is needed. Original synthetic examples remain available as a smoke-test mode.

This fine-tunes a small pretrained **cross-encoder** to rank candidate code units against a developer's task. It does **not** train a general-purpose coding LLM, discover an entire repo by itself, generate code, or guarantee the exact context. Contexa must still retrieve candidates, resolve dependencies, remove secrets and enforce budgets.

**Important:** the public pilot uses patch-overlap weak labels. Changed units are positives; unchanged units are uncertain negatives. This cannot establish complete-context correctness. Both demo and pilot models remain `production_recommended: false`. Tests compare unseen repositories, not randomly split snippets. Public source can also occur in the pretrained model's unknown training corpus.

**Private data:** make a private copy if this notebook is shared with “anyone can edit.” Never upload production rows, credentials or unapproved customer source. The dataset scanner catches only some known leaks. No model or dataset is automatically published to Hugging Face. The ZIP omits raw training records and optimizer checkpoints; trained weights can still memorize sensitive data.

Save important checkpoints to Drive by enabling the option in Step 2. Colab's local `/content` files disappear when its VM resets; free GPUs and uninterrupted runtime are not guaranteed.
""")

md("""
## 1. Install text-model dependencies
This uses Colab's existing PyTorch/GPU installation. It does not replace CUDA or install software on your computer.
If Colab requests a runtime restart after package installation, restart and run the notebook again.
""")
code('''
import os, sys, subprocess
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["WANDB_DISABLED"] = "true"
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                       "transformers==4.57.6", "safetensors==0.7.0", "tqdm==4.67.1"])
print("Dependencies ready. PyTorch/CUDA were not replaced.")
''')

md("""
## 2. Configuration and GPU check
- The bundled public-change pilot runs by default, with no dataset upload needed.
- Set `USE_DEMO_DATA = True` for a synthetic smoke test, or disable both modes to upload reviewed labels.
- Set `PERSIST_TO_DRIVE = True` to keep epoch checkpoints through a VM reset. Google will ask you to authorize your own Drive mount. Rerunning with the same data/config resumes at the next epoch.
- If memory runs out, lower `BATCH_SIZE` to 2. Keep the same configuration when resuming.
""")
code('''
from pathlib import Path
import json, random, hashlib, time, math, gc, shutil
import torch
import importlib.metadata

USE_DEMO_DATA = False
USE_PUBLIC_DATA = True
PERSIST_TO_DRIVE = False
ALLOW_CPU = False  # Set True only if you intentionally accept much slower CPU training.
BASE_MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"
BASE_REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
SEED = 42
EPOCHS = 2
BATCH_SIZE = 4
GRAD_ACCUMULATION = 4
LEARNING_RATE = 2e-5
MAX_LENGTH = 384
MAX_QUERY_TOKENS = 128
EVALUATION_BUDGET = 600  # Small enough to test token efficiency on the short demo units.
RESUME_IF_AVAILABLE = True

if not torch.cuda.is_available() and not ALLOW_CPU:
    raise RuntimeError("No GPU is attached. Choose Runtime → Change runtime type → GPU, reconnect, and rerun. GPU availability depends on Colab.")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("PyTorch:", torch.__version__, "Device:", DEVICE)
if DEVICE.type == "cuda":
    print("GPU:", torch.cuda.get_device_name(0), "VRAM GB:", round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1))
if PERSIST_TO_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
    WORK_ROOT = Path("/content/drive/MyDrive/ContexaTraining")
else:
    WORK_ROOT = Path("/content/contexa_training")
    print("Checkpoints are temporary. Enable Drive persistence before long runs.")
WORK_ROOT.mkdir(parents=True, exist_ok=True)
random.seed(SEED)
torch.manual_seed(SEED)
if DEVICE.type == "cuda":
    torch.cuda.manual_seed_all(SEED)
''')

md("## 3. Data preparation, split rules, and metrics\nThe following helpers run locally inside your Colab VM. They never execute candidate source code.")
helper_source = (ROOT / "notebook_helpers.py").read_text(encoding="utf-8")
code(helper_source)

md("""
## 4. Load the bundled public pilot, demo, or reviewed records

The default public pilot is embedded below with attribution notices; no upload is needed. Its 0/2 labels are uncertain unchanged/observed changed units, rather than verified irrelevant/essential context. The following schema also supports a separate reviewed dataset.

**JSONL = one candidate record per line.** Every task needs at least four candidates including an essential and an irrelevant candidate. Include difficult negatives such as a similarly named controller from another feature. Provide the same requirements on every candidate belonging to one task.

Required fields: `repo_id`, `task_id`, `task`, `candidate_id`, `path`, `content`, `label`.
Optional: `endpoints`, `access`, `rules`, `response_shape`, `role`.
Labels: **2 essential**, **1 useful**, **0 irrelevant** (names also accepted). Candidate `content` should be a complete function, class/type, ORM model/enum block, or short file—not a directory listing or database records.

```json
{"repo_id":"project-a","task_id":"interview-create","task":"Create an interview endpoint","endpoints":"POST /interviews","access":"Recruiters","rules":"Reject overlaps","response_shape":"Use sendSuccess","candidate_id":"interview-model","path":"prisma/schema.prisma","role":"model","content":"model Interview {\\n id Int @id\\n}","label":2}
```

At least **3 repositories** are required for a disjoint split; use many more for meaningful generalization. Before real training, have a developer review the complete candidate set for each task, including the shared auth/response contracts and relevant enums. Synthetic labels and model-generated labels alone do not establish correctness.
""")
public_file = ROOT / 'public_data/candidates.jsonl'
public_payload = base64.b64encode(zlib.compress(public_file.read_bytes())).decode() if public_file.exists() else ''
public_notices = {p.name: p.read_text(encoding='utf-8') for p in (ROOT / 'public_data').glob('*.txt')}
manifest_file = ROOT / 'public_data/manifest.json'
if manifest_file.exists():
    public_notices['manifest.json'] = manifest_file.read_text(encoding='utf-8')
code('BUNDLED_PUBLIC_DATA = ' + repr(public_payload) + '\nPUBLIC_NOTICES = ' + repr(public_notices) + '\n' + '''
if USE_DEMO_DATA:
    rows = make_demo_rows()
    print("DEMO ONLY: original synthetic labels; not proof of production retrieval quality.")
elif USE_PUBLIC_DATA:
    import base64, zlib
    if not BUNDLED_PUBLIC_DATA:
        raise ValueError("No bundled pilot: regenerate the notebook after collecting public data.")
    rows = [json.loads(line) for line in zlib.decompress(base64.b64decode(BUNDLED_PUBLIC_DATA)).decode().splitlines() if line.strip()]
    print("PUBLIC PILOT: patch-overlap weak labels, not verified complete context. No production promotion.")
else:
    from google.colab import files
    uploaded = files.upload()
    if len(uploaded) != 1:
        raise ValueError("Upload exactly one reviewed JSONL file.")
    raw = next(iter(uploaded.values()))
    if len(raw) > 100 * 1024 * 1024:
        raise ValueError("Dataset exceeds this notebook's 100 MB input limit.")
    rows = [json.loads(line) for line in raw.decode("utf-8-sig").splitlines() if line.strip()]
    del uploaded, raw
rows = validate_rows(rows)
weak_labels = any(r.get("labels_verified") is False for r in rows)
splits = split_repositories(rows, SEED)
fingerprint = dataset_hash(rows)
run_config = dict(base_model=BASE_MODEL, revision=BASE_REVISION, seed=SEED, epochs=EPOCHS,
                  batch_size=BATCH_SIZE, gradient_accumulation=GRAD_ACCUMULATION,
                  learning_rate=LEARNING_RATE, max_length=MAX_LENGTH, max_query_tokens=MAX_QUERY_TOKENS,
                  evaluation_budget=EVALUATION_BUDGET, demo=USE_DEMO_DATA, weak_labels=weak_labels, dataset_sha256=fingerprint,
                  torch_version=str(torch.__version__), transformers_version=importlib.metadata.version("transformers"))
run_id = hashlib.sha256(json.dumps(run_config, sort_keys=True).encode()).hexdigest()[:16]
RUN_DIR = WORK_ROOT / run_id
RUN_DIR.mkdir(parents=True, exist_ok=True)
if USE_PUBLIC_DATA and not USE_DEMO_DATA:
    notice_directory = RUN_DIR / "public_source_notices"
    notice_directory.mkdir(exist_ok=True)
    for name, notice in PUBLIC_NOTICES.items():
        (notice_directory / name).write_text(notice, encoding="utf-8")
split_manifest = {}
repo_sets = {}
for name, subset in splits.items():
    ids = {r["repo_id"] for r in subset}
    repo_sets[name] = ids
    split_manifest[name] = dict(repositories=len(ids), tasks=len({(r["repo_id"],r["task_id"]) for r in subset}), candidates=len(subset),
        repository_hashes=sorted(hashlib.sha256(repo.encode()).hexdigest() for repo in ids))
assert not repo_sets["train"] & repo_sets["validation"]
assert not repo_sets["train"] & repo_sets["test"]
assert not repo_sets["validation"] & repo_sets["test"]
overlap = set(hashlib.sha256(passage_text(r).encode()).hexdigest() for r in splits["train"]) & set(hashlib.sha256(passage_text(r).encode()).hexdigest() for r in splits["test"])
if overlap:
    raise ValueError("Identical candidate text crosses train/test repositories. Deduplicate independent projects before evaluating.")
(RUN_DIR / "run_config.json").write_text(json.dumps(run_config, indent=2), encoding="utf-8")
(RUN_DIR / "split_manifest.json").write_text(json.dumps(split_manifest, indent=2), encoding="utf-8")
print(json.dumps(split_manifest, indent=2))
print("Run ID:", run_id)
''')

md("""
## 5. Load the pinned pretrained model and validate sequence lengths
The base model is Apache-2.0 licensed. Downloads are public and do not need an account token. This is a general passage reranker; its suitability for code must be measured rather than assumed.

Training rejects overlong task/unit pairs instead of silently discarding a model relation or function tail. Split a long file into complete, independently labeled code units, shorten task text, or increase `MAX_LENGTH` up to 512. Exported inference can score long candidates in windows while preserving their original content.
""")
code('''
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from tqdm.auto import tqdm
import torch.nn.functional as F
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, trust_remote_code=False)
model = AutoModelForSequenceClassification.from_pretrained(BASE_MODEL, revision=BASE_REVISION,
            use_safetensors=True, trust_remote_code=False).to(DEVICE)
assert model.config.num_labels == 1, "This pipeline requires a one-logit reranker."
assert 32 <= MAX_LENGTH <= min(512, model.config.max_position_embeddings)
long_units = 0
for row in rows:
    query_ids = tokenizer.encode(query_text(row), add_special_tokens=False)
    if len(query_ids) > MAX_QUERY_TOKENS:
        raise ValueError("A task exceeds MAX_QUERY_TOKENS; shorten its requirements or deliberately raise the query limit.")
    size = len(tokenizer.encode(query_text(row), passage_text(row), add_special_tokens=True, truncation=False))
    long_units += size > MAX_LENGTH
if long_units:
    raise ValueError(f"{long_units} training units exceed MAX_LENGTH. Split them into complete functions/model blocks and relabel; no automatic training truncation was applied.")
print("All training units fit without truncation. Parameters:", f"{sum(p.numel() for p in model.parameters()):,}")
''')

md("## 6. Shared inference function\nThis scores candidates. It does not modify source or decide which dependencies are mandatory. Scores are ranking signals, not calibrated probabilities.")
code('''
@torch.inference_mode()
def neural_scores(query, candidates, active_model=None):
    active_model = active_model if active_model is not None else model
    active_model.eval()
    result = []
    for start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[start:start + BATCH_SIZE]
        encoded_batch = tokenizer([query] * len(batch), [passage_text(r) for r in batch],
                                  padding=True, truncation=False, return_tensors="pt").to(DEVICE)
        logits = active_model(**encoded_batch).logits.view(-1).float().cpu().tolist()
        result.extend(logits)
    return result

baseline_validation = evaluate(splits["validation"], neural_scores, EVALUATION_BUDGET)
print("Pretrained validation metrics:", json.dumps(baseline_validation, indent=2))
print("Token cost = compact JSON UTF-8 bytes / 3, an estimate; not a provider tokenizer.")
''')

md("""
## 7. Fine-tune using graded pairwise relevance
The loss teaches `essential > useful > irrelevant` for the **same task**. Epoch selection uses validation repositories only; the held-out test results are not used to select checkpoints.

The notebook saves an optimizer checkpoint after every epoch. With Drive persistence enabled, rerunning the same config/data resumes at the next epoch. An interruption during an epoch loses that epoch's unfinished updates. This notebook only reloads its own checkpoint path; never substitute an untrusted `.pt` file.
""")
code('''
pairs = training_pairs(splits["train"], SEED)
if not pairs:
    raise ValueError("No graded positive/negative training pairs were formed.")
if len(pairs) > 50000:
    raise ValueError("Start with fewer than 50,000 training pairs for this Colab experiment.")
optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=.01)
use_fp16 = DEVICE.type == "cuda"
scaler = torch.amp.GradScaler("cuda", enabled=use_fp16)
last_path = RUN_DIR / "last.pt"
start_epoch, best_key, best_directory, history = 0, (-1., -1., -1.), None, []
if RESUME_IF_AVAILABLE and last_path.exists():
    checkpoint = torch.load(last_path, map_location=DEVICE, weights_only=True)
    if checkpoint["run_id"] != run_id:
        raise ValueError("Checkpoint/config mismatch; start a separate run.")
    model.load_state_dict(checkpoint["model"])
    optimizer.load_state_dict(checkpoint["optimizer"])
    scaler.load_state_dict(checkpoint["scaler"])
    start_epoch = checkpoint["completed_epochs"]
    best_key, best_directory, history = tuple(checkpoint["best_key"]), Path(checkpoint["best_directory"]), checkpoint["history"]
    torch.set_rng_state(checkpoint["torch_rng"].cpu())
    if DEVICE.type == "cuda" and checkpoint["cuda_rng"]:
        torch.cuda.set_rng_state_all([state.cpu() for state in checkpoint["cuda_rng"]])
    del checkpoint
    print("Resuming after completed epoch", start_epoch)

print("Training pairs:", len(pairs), "Epochs:", EPOCHS, "Effective pair batch:", BATCH_SIZE * GRAD_ACCUMULATION)
training_started = time.perf_counter()
for epoch in range(start_epoch, EPOCHS):
    ordered = list(pairs)
    random.Random(SEED + epoch).shuffle(ordered)
    model.train()
    optimizer.zero_grad(set_to_none=True)
    batches = math.ceil(len(ordered) / BATCH_SIZE)
    epoch_losses = []
    progress = tqdm(range(batches), desc=f"Epoch {epoch + 1}/{EPOCHS}")
    for batch_index in progress:
        batch = ordered[batch_index * BATCH_SIZE:(batch_index + 1) * BATCH_SIZE]
        queries = [pair[0] for pair in batch]
        positives, negatives = [pair[1] for pair in batch], [pair[2] for pair in batch]
        inputs = tokenizer(queries + queries, positives + negatives, padding=True, truncation=False, return_tensors="pt").to(DEVICE)
        weights = torch.tensor([pair[3] for pair in batch], dtype=torch.float32, device=DEVICE)
        group_size = min(GRAD_ACCUMULATION, batches - (batch_index // GRAD_ACCUMULATION) * GRAD_ACCUMULATION)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16, enabled=use_fp16):
            logits = model(**inputs).logits.view(-1)
            positive_logits, negative_logits = logits[:len(batch)], logits[len(batch):]
            raw_loss = (F.softplus(-(positive_logits - negative_logits).float()) * weights).sum() / weights.sum()
            loss = raw_loss / group_size
        if not torch.isfinite(loss):
            raise RuntimeError("Nonfinite loss; stop and inspect data or lower the learning rate.")
        scaler.scale(loss).backward()
        if (batch_index + 1) % GRAD_ACCUMULATION == 0 or batch_index + 1 == batches:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
        epoch_losses.append(float(raw_loss.detach().cpu()))
        progress.set_postfix(loss=round(sum(epoch_losses) / len(epoch_losses), 4))
    metrics = evaluate(splits["validation"], neural_scores, EVALUATION_BUDGET)
    key = (metrics["ndcg_at_5"], metrics["essential_recall_at_budget"], -metrics["irrelevant_token_fraction"])
    history.append(dict(epoch=epoch + 1, loss=sum(epoch_losses) / len(epoch_losses), validation=metrics))
    print("Validation:", json.dumps(metrics, indent=2))
    if key > best_key:
        best_key = key
        best_directory = RUN_DIR / f"best_epoch_{epoch + 1}"
        model.save_pretrained(best_directory, safe_serialization=True)
        tokenizer.save_pretrained(best_directory)
    state = dict(run_id=run_id, completed_epochs=epoch + 1, model=model.state_dict(), optimizer=optimizer.state_dict(),
                 scaler=scaler.state_dict(), best_key=list(best_key), best_directory=str(best_directory), history=history,
                 torch_rng=torch.get_rng_state(), cuda_rng=torch.cuda.get_rng_state_all() if DEVICE.type == "cuda" else [])
    temporary = RUN_DIR / "last.tmp"
    torch.save(state, temporary)
    os.replace(temporary, last_path)
    del state
    (RUN_DIR / "training_history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
print("Training time this session, minutes:", round((time.perf_counter() - training_started) / 60, 2))
if best_directory is None or not (best_directory / "model.safetensors").exists():
    raise RuntimeError("No complete best checkpoint exists. Inspect training output before exporting.")
''')

md("""
## 8. Evaluate the selected model on untouched test repositories
This compares three rankers on identical candidate sets and budgets: a keyword baseline, the original pretrained model, and the selected fine-tuned checkpoint. It measures **candidate ranking**, not full-repository retrieval recall or code compilation. A required file missing from the candidate set cannot be recovered by a reranker.

`essential_recall_at_budget` should increase; `irrelevant_token_fraction` should decrease. Tiny demo test sets and synthetic labels are not statistically reliable. Freeze a real test set before tuning, and do not repeatedly tune against it.
""")
code('''
del optimizer
del model
gc.collect()
if DEVICE.type == "cuda": torch.cuda.empty_cache()
model = AutoModelForSequenceClassification.from_pretrained(str(best_directory), use_safetensors=True, trust_remote_code=False).to(DEVICE)
trained_validation = evaluate(splits["validation"], neural_scores, EVALUATION_BUDGET)
trained_test = evaluate(splits["test"], neural_scores, EVALUATION_BUDGET)
del model
gc.collect()
if DEVICE.type == "cuda": torch.cuda.empty_cache()
model = AutoModelForSequenceClassification.from_pretrained(BASE_MODEL, revision=BASE_REVISION,
            use_safetensors=True, trust_remote_code=False).to(DEVICE)
pretrained_test = evaluate(splits["test"], neural_scores, EVALUATION_BUDGET)
keyword_test = evaluate(splits["test"], keyword_scores, EVALUATION_BUDGET)
del model
gc.collect()
if DEVICE.type == "cuda": torch.cuda.empty_cache()

beats_pretrained = (trained_test["ndcg_at_5"] >= pretrained_test["ndcg_at_5"] + .01
    and trained_test["essential_recall_at_budget"] >= pretrained_test["essential_recall_at_budget"]
    and trained_test["irrelevant_token_fraction"] <= pretrained_test["irrelevant_token_fraction"])
evaluation_report = dict(format="contexa.reranker-evaluation.v1", demo=USE_DEMO_DATA,
    production_recommended=False, candidate_quality_gate_passed=bool(beats_pretrained and not USE_DEMO_DATA and not weak_labels),
    weak_labels=weak_labels, metric_interpretation="With weak labels, essential recall measures observed changed-unit coverage; irrelevant fraction means unchanged-unit token fraction, not verified irrelevance.",
    reason="Demo data cannot establish production quality." if USE_DEMO_DATA else ("Patch-derived weak labels cannot establish complete-context correctness; production promotion is disabled." if weak_labels else "Human review, broader held-out evaluation, latency and end-to-end generated-code checks are still required."),
    run_id=run_id, config=run_config, splits=split_manifest, pretrained_validation=baseline_validation,
    trained_validation=trained_validation, test={"keyword":keyword_test,"pretrained":pretrained_test,"trained":trained_test},
    scope="Ranking within supplied candidates; no claim of complete-repo recall or first-try compilation.",
    token_estimate="UTF-8 bytes / 3; no provider-token or message-limit guarantee.")
(RUN_DIR / "evaluation_report.json").write_text(json.dumps(evaluation_report, indent=2), encoding="utf-8")
print(json.dumps(evaluation_report["test"], indent=2))
print(evaluation_report["reason"])
print("Candidate quality gate:", evaluation_report["candidate_quality_gate_passed"], "Production approved:", False)
''')

md("""
## 9. Export the model and a CPU-compatible inference adapter
The ZIP includes safe-tensor model weights, tokenizer, provenance/configuration, evaluation report and `inference.py`. It excludes raw training data and resume checkpoints. Treat the weights as a candidate artifact; don't automatically replace Contexa's current selector.

The adapter scores long source in bounded overlapping windows and returns the maximum score per unit. Selection keeps whole original units. It deliberately leaves mandatory dependency expansion, secrecy checks and final pack budgets to Contexa. Long inputs beyond the configured window cap raise an error rather than silently omit the tail.
""")
inference_source = (ROOT / "inference_template.py").read_text(encoding="utf-8")
code("INFERENCE_SOURCE = " + repr(inference_source) + "\n" + '''
bundle = RUN_DIR / "export"
if bundle.exists(): shutil.rmtree(bundle)
bundle.mkdir()
shutil.copytree(best_directory, bundle / "model")
if (RUN_DIR / "public_source_notices").exists():
    shutil.copytree(RUN_DIR / "public_source_notices", bundle / "public_source_notices")
(bundle / "inference.py").write_text(INFERENCE_SOURCE, encoding="utf-8")
(bundle / "requirements.txt").write_text("torch>=2.6,<3\\ntransformers==4.57.6\\nsafetensors==0.7.0\\n", encoding="utf-8")
for name in ("evaluation_report.json", "run_config.json", "split_manifest.json", "training_history.json"):
    shutil.copy2(RUN_DIR / name, bundle / name)
card = f"""# Contexa context reranker — candidate model

Base: {BASE_MODEL} at {BASE_REVISION}; base model license Apache-2.0.
Training data mode: {'synthetic demonstration' if USE_DEMO_DATA else 'read run_config.json and evaluation_report.json for label provenance'}.
Dataset SHA256: {fingerprint}. Run ID: {run_id}.
Model selection: repository-disjoint validation; final test uses held-out repositories.
Production approved: NO. Read evaluation_report.json before integrating.
Scores are not calibrated probabilities. This ranks provided candidates, not an entire repository.
Keep Contexa's credential filters, dependency rules and estimated-budget checks.
No guarantee of exact context, compile success, or privacy of training data encoded in weights.
Training-data licensing/permission must be checked before distributing a custom-data model.
See the base model card for upstream notices: https://huggingface.co/{BASE_MODEL}
"""
(bundle / "MODEL_CARD.md").write_text(card, encoding="utf-8")
readme = """# Using the exported candidate
Install requirements in a separate Python environment with enough RAM.
Do not deserialize untrusted .pt files; inference loads safetensors only.

from inference import ContexaReranker
ranker = ContexaReranker('model', device='cpu')
units = [{'path':'src/models/Interview.ts','role':'model','content':'export type Interview = {id:number};'}]
scores = ranker.score('Add an interview endpoint for recruiters', units)

The list of scores matches the input unit order. Preserve original source when building packs.
Run latency/memory benchmarks and inspect the evaluation report before enabling this in Contexa.
"""
(bundle / "README.md").write_text(readme, encoding="utf-8")
archive_path = Path(shutil.make_archive(str(RUN_DIR / ("contexa-reranker-demo" if USE_DEMO_DATA else "contexa-reranker-candidate")), "zip", bundle))
archive_sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
print("ZIP:", archive_path.name, "Size MB:", round(archive_path.stat().st_size / 2**20, 1))
print("SHA256:", archive_sha)
''')

md("## 10. Reload the exported adapter and smoke-test it\nThis checks the packaged model can be loaded through the same CPU interface intended for local integration.")
code('''
import importlib.util
spec = importlib.util.spec_from_file_location("contexa_export_inference", bundle / "inference.py")
export_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_module)
ranker = export_module.ContexaReranker(bundle / "model", device="cpu", max_length=MAX_LENGTH, max_query_tokens=MAX_QUERY_TOKENS)
sample_group = [r for r in splits["test"] if r["task_id"] == splits["test"][0]["task_id"]]
scores = ranker.score(query_text(sample_group[0]), sample_group)
assert len(scores) == len(sample_group) and all(math.isfinite(score) for score in scores)
print("CPU export reload passed for", len(scores), "candidate units.")
del ranker
gc.collect()
''')

md("""
## 11. Download your artifacts
Send back **`evaluation_report.json` first** so we can review whether training improved anything. Keep the ZIP for integration. A demo-trained ZIP is for testing the integration, not a customer-quality release.

If the browser blocks multiple automatic downloads, run the two download calls separately. If Drive persistence is on, the files are also in your `MyDrive/ContexaTraining/<run-id>/` folder.
""")
code('''
from google.colab import files
files.download(str(RUN_DIR / "evaluation_report.json"))
files.download(str(archive_path))
''')

md("""
## Next steps and references
- Use real, sanitized, developer-reviewed labels across repositories and stacks, including hard negatives and tasks where the right action is to ask for missing information.
- This notebook only compares a keyword baseline with pretrained/trained rerankers. Before deployment, also compare the full current Contexa pipeline, candidate-retrieval recall, dependency completeness, latency/RAM and generated-code compile/test outcomes.
- Integration should retrieve a bounded candidate set, rerank it, add mandatory imports/models/enums, then budget whole units. Keep a fallback if the model is missing, slow or worse than the existing selector.
- [Sentence Transformers training guidance](https://www.sbert.net/docs/cross_encoder/training_overview.html), [base model card](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2), [Transformers training](https://huggingface.co/docs/transformers/training), [Colab runtime limitations](https://research.google.com/colaboratory/faq.html).

**Verification note:** this notebook's Python syntax, demo data validation, split separation and metric/budget helpers were tested locally without installing ML packages. GPU training and model download/reload require your Colab run and have not been claimed as completed.
""")

notebook = {"nbformat": 4, "nbformat_minor": 5,
    "metadata": {"colab": {"name": "Contexa_Reranker_Colab.ipynb", "provenance": []},
                 "accelerator": "GPU", "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
    "cells": cells}
for index, cell in enumerate(cells):
    cell["id"] = hashlib.sha256(f"{index}:{cell['source']}".encode()).hexdigest()[:12]
destination = ROOT / "Contexa_Reranker_Colab.ipynb"
destination.write_text(json.dumps(notebook, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Created {destination.name}: {len(cells)} cells, {destination.stat().st_size:,} bytes")
