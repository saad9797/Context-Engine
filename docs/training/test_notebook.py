"""Validate the deliverable without importing Torch or accessing private project data."""
import ast
import collections
import copy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from notebook_helpers import (make_demo_rows, validate_rows, split_repositories, training_pairs,
                              ranking_metrics, select_under_budget, keyword_scores, evaluate)

ROOT = Path(__file__).resolve().parent


class NotebookTests(unittest.TestCase):
    def test_generated_notebook_cells_parse_and_have_no_saved_outputs(self):
        notebook = json.loads((ROOT / "Contexa_Reranker_Colab.ipynb").read_text(encoding="utf-8"))
        self.assertEqual(notebook["nbformat"], 4)
        self.assertEqual(notebook["metadata"]["accelerator"], "GPU")
        self.assertEqual(len({cell["id"] for cell in notebook["cells"]}), len(notebook["cells"]))
        for cell in notebook["cells"]:
            if cell["cell_type"] == "code":
                ast.parse(cell["source"])
                self.assertEqual(cell["outputs"], [])
                self.assertIsNone(cell["execution_count"])

    def test_demo_splits_are_repository_disjoint(self):
        data = validate_rows(make_demo_rows())
        self.assertEqual(len(data), 192)
        splits = split_repositories(data)
        repos = {key: {r["repo_id"] for r in rows} for key, rows in splits.items()}
        self.assertEqual([len(repos[k]) for k in ("train", "validation", "test")], [6, 3, 3])
        self.assertFalse(repos["train"] & repos["test"])
        self.assertFalse(repos["train"] & repos["validation"])
        self.assertTrue(training_pairs(splits["train"]))
        self.assertEqual(split_repositories(data), splits)
        metrics = evaluate(splits["test"], keyword_scores, 600)
        for key in ("ndcg_at_5", "essential_recall_at_budget", "irrelevant_token_fraction", "mrr"):
            self.assertGreaterEqual(metrics[key], 0)
            self.assertLessEqual(metrics[key], 1)

    def test_duplicate_candidates_and_credentials_are_rejected(self):
        rows = make_demo_rows()
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_rows(rows + [rows[0]])
        rows[0]["content"] = "postgresql://person:private-password@host/database"
        with self.assertRaisesRegex(ValueError, "private data"):
            validate_rows(rows)

    def test_metrics_reward_essential_code_and_never_cut_large_units(self):
        units = [{"candidate_id":"a", "path":"essential.ts", "content":"model A {}", "label":2},
                 {"candidate_id":"b", "path":"noise.ts", "content":"const noise=1;", "label":0}]
        high = ranking_metrics(units, [1.,0.], budget=100, k=1)
        low = ranking_metrics(units, [0.,1.], budget=100, k=1)
        self.assertEqual(high["ndcg_at_5"], 1.)
        self.assertEqual(low["ndcg_at_5"], 0.)
        units[0]["content"] = "x" * 10000
        chosen, used = select_under_budget(units, [100.,0.], budget=50)
        self.assertNotIn(0, chosen)
        self.assertLessEqual(used, 50)
        self.assertEqual(units[0]["content"], "x" * 10000)

    def test_export_structure_without_including_training_records(self):
        notebook = json.loads((ROOT / "Contexa_Reranker_Colab.ipynb").read_text(encoding="utf-8"))
        source = next(cell["source"] for cell in notebook["cells"] if cell["cell_type"] == "code" and cell["source"].startswith("INFERENCE_SOURCE ="))
        import shutil, hashlib
        with tempfile.TemporaryDirectory(prefix="contexa-notebook-qa-") as temporary:
            root = Path(temporary)
            best = root / "best_epoch_1"
            best.mkdir()
            (best / "model.safetensors").write_bytes(b"packaging-structure-test-only")
            for name in ("evaluation_report.json", "run_config.json", "split_manifest.json", "training_history.json"):
                (root / name).write_text("{}", encoding="utf-8")
            (root / "private_training_records.jsonl").write_text("must-not-export", encoding="utf-8")
            namespace = dict(RUN_DIR=root, best_directory=best, USE_DEMO_DATA=True, BASE_MODEL="test-model",
                             BASE_REVISION="test-revision", fingerprint="test-fingerprint", run_id="test-run", Path=Path,
                             shutil=shutil, hashlib=hashlib)
            exec(compile(source, "notebook-export-cell", "exec"), namespace)
            with zipfile.ZipFile(namespace["archive_path"]) as archive:
                names = archive.namelist()
                self.assertIn("model/model.safetensors", names)
                self.assertIn("inference.py", names)
                self.assertFalse(any("private_training" in name or name.endswith(".pt") for name in names))
                requirements = archive.read("requirements.txt").decode()
                self.assertEqual(len(requirements.splitlines()), 3)
                self.assertNotIn("\\n", requirements)
                ast.parse(archive.read("inference.py").decode())


if __name__ == "__main__":
    unittest.main()
