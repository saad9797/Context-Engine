import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.mark.skipif(not shutil.which("node"), reason="Node is required by the ingestion runner")
def test_runner_delivers_large_snapshot_before_exiting():
    engine = Path(__file__).parent / "ingestion-engine"
    # Isolate transport from external APIs. Payload exceeds OS pipe buffers.
    script = """
      const engine = require.resolve('./src/index');
      require.cache[engine] = { id: engine, filename: engine, loaded: true,
        exports: { runIngestion: async () => ({ payload: 'x'.repeat(2 * 1024 * 1024) }) } };
      require('./run');
    """
    result = subprocess.run(
        ["node", "-e", script], cwd=engine, input="{}",
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert len(json.loads(result.stdout)["payload"]) == 2 * 1024 * 1024


@pytest.mark.skipif(not shutil.which("node"), reason="Node is required by the ingestion runner")
def test_worker_saves_large_utf8_snapshot(monkeypatch):
    from . import tasks

    job = MagicMock(user_id=1)
    jobs = MagicMock()
    jobs.objects.get.return_value = job
    contexts = MagicMock()
    monkeypatch.setattr(tasks, "IngestionJob", jobs)
    monkeypatch.setattr(tasks, "IngestionContext", contexts)
    monkeypatch.setattr(tasks, "_build_runner_config", lambda _: {})
    monkeypatch.setattr(tasks, "_validate_ssrf", lambda _: None)
    monkeypatch.setattr(tasks.freshness, "compute_stored_fingerprint", lambda _: "fingerprint")
    real_popen = subprocess.Popen
    # U+201D includes byte 0x9D in UTF-8, which is undefined in Windows cp1252.
    producer = "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({text: '\\u201d'.repeat(100000)})));"
    def start_producer(args, **kwargs):
        assert kwargs["encoding"] == "utf-8"
        return real_popen(["node", "-e", producer], **kwargs)
    monkeypatch.setattr(tasks.subprocess, "Popen", start_producer)
    tasks.run_ingestion_job("example-job")
    assert job.status == "succeeded"
    assert contexts.objects.create.call_args.kwargs["data"]["text"] == "\u201d" * 100000
