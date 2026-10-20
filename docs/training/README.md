# Train a Contexa context reranker in Colab

Download **Contexa_Reranker_Colab.ipynb**, open [Google Colab](https://colab.research.google.com/), and choose **File → Upload notebook**. Make a private copy before using private training data. Select **Runtime → Change runtime type → GPU**, then **Runtime → Run all**.

The default run now uses a bundled public-change pilot: 113 candidates from nine changes across Flask, Django, Django REST Framework, Sequelize, Mongoose and Vue. No dataset preparation or labeling is required from you. Licenses and pinned before-change commits are included. This is a small weakly supervised pilot, not evidence of production quality. Set `USE_DEMO_DATA = True` for the earlier synthetic smoke test.

The notebook installs pinned text-model dependencies, checks GPU availability, validates data, splits by repository, measures the pretrained baseline, fine-tunes a small model with pairwise relevance loss, selects the best epoch using validation repositories, evaluates held-out test repositories, and exports a ZIP. The export includes a CPU inference adapter, model weights/tokenizer, configuration, evaluation report and model card. It excludes raw training records and optimizer state.

**Download and send back `evaluation_report.json` first.** Keep the ZIP for integration. A demo-trained model must not be silently promoted to customer use. The notebook always labels production approval as false; the real-data quality gate is only one input to human deployment review.

Public collection is handled by `collect_public_data.py`; downloaded code is parsed, never executed. Label 2 means a complete unit overlaps a patch against the base commit; label 0 means an unchanged unit in the same changed file. Neither label proves whether a unit is sufficient or unnecessary for implementing the task. The report explains the weak-label metric meanings. Public and demo models cannot pass the production quality gate. For externally reviewed data, disable both `USE_DEMO_DATA` and `USE_PUBLIC_DATA` and upload sanitized JSONL. No database-application coverage or first-try compilation claim follows from this library-source pilot.

Checkpoint persistence is optional: set `PERSIST_TO_DRIVE = True` before starting a long run and authorize the mount yourself. With identical data and configuration, rerunning resumes from a completed epoch. Without persistence, a VM reset loses `/content`. GPU availability and session duration depend on Colab. Do not assume a guaranteed runtime.

Training time is not benchmarked here. The notebook prints actual training time on your assigned GPU. Fine-tuning a useful model depends on data quality and coverage; a successful demo run does not establish exact-context retrieval or generated-code compilation.

Local checks (no ML installation):

```powershell
.\"Rest Saas"\.venv\Scripts\python.exe docs/training/build_notebook.py
.\"Rest Saas"\.venv\Scripts\python.exe -m unittest discover -s docs/training -p "test_notebook.py" -v
```

The generated notebook is self-contained: the builder embeds `notebook_helpers.py` and `inference_template.py`. No companion files need uploading. Training/GPU execution and actual exported-weight reload have not been run locally; those are verified by running the notebook in your Colab session.
