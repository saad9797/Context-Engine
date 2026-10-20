# Public change pilot

113 candidate units, nine PR-title tasks, six independent repositories. Sources:
Flask, Django, Django REST Framework, Sequelize, Mongoose and Vue. Source URLs,
base commit IDs, task URLs and license notice filenames accompany every row.
Retain the accompanying license notices when redistributing this source.

This is **weak supervision**, not reviewed complete-context ground truth:

- 2: a complete small before-change unit overlaps a patch's old-line positions.
- 0: an unchanged complete small unit from the same changed file. It can still
  be a necessary dependency; it is not proven irrelevant.

No customer data, source execution, generated-code execution or paid AI labels
were used. Unsupported/oversized units are omitted whole. The manifest records
rejected tasks. Root license recognition and supported file SPDX checks are
conservative filters, not a complete legal audit.

`baseline_report.json` reports repository-disjoint keyword baselines with weak
label interpretations. It does not evaluate the full production selector.
`tokenizer_preflight.json` records an actual check using the pinned base model's
tokenizer: maximum pair length 226, against 384 allowed. No truncation occurred.
There is no trained-model result for this pilot yet.

Reproduce from the project root:

```powershell
& '.\Rest Saas\.venv\Scripts\python.exe' docs/training/collect_public_data.py
& '.\Rest Saas\.venv\Scripts\python.exe' docs/training/benchmark_public_data.py
& '.\Rest Saas\.venv\Scripts\python.exe' docs/training/build_notebook.py
& '.\Rest Saas\.venv\Scripts\python.exe' -m unittest discover -s docs/training -p 'test_*.py'
```

Public downloads are cached in ignored `public_cache/`; public API quotas may
limit new collection. JS/TS parsing uses the existing frontend Babel parser.
The generated notebook bundles the dataset and notices and requires no dataset
upload. Set `USE_PUBLIC_DATA=False` to use a separate reviewed dataset.

This small library-source pilot does not demonstrate all-stack application/DB
coverage, minimum complete context, or generated-code compilation. Weak-label
models cannot pass the notebook's candidate quality gate and are never
automatically enabled for customers.
