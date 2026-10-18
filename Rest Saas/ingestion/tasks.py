"""
The Django-RQ task that actually runs an ingestion. Enqueued by
IngestionJobCreateView and executed by a separate `rqworker` process — never
on a request thread. See ingestion/views.py and README for how to run the
worker.
"""

import json
import re
import subprocess
import threading
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from core.network_guard import assert_safe_config

from . import freshness
from .privacy import safe_snapshot
from .github_app import mint_installation_token
from .models import DataSourceConnection, GitHubAppInstallation, IngestionContext, IngestionJob

INGESTION_RUNNER = Path(__file__).resolve().parent / "ingestion-engine" / "run.js"

# Off the request thread now, so a large schema/repo can be given real time
# instead of racing a 120s HTTP timeout.
JOB_TIMEOUT_SECONDS = 600

# Caps the Node subprocess's V8 heap (--max-old-space-size, in MB) — added
# 2026-09-28 (production-readiness audit): a pathologically large schema or
# repo previously had no resource ceiling beyond the wall-clock timeout
# above, so a slow memory blowup could exhaust host RAM well before 600s
# elapsed. This is a real but partial guard, not an absolute one — it caps
# V8's own heap, not native-addon/buffer memory the AWS/Azure SDKs can
# allocate off-heap, and there is no cross-platform equivalent of POSIX
# resource.setrlimit for total process RSS (Windows has no rlimit at all).
# When the heap ceiling is hit, Node exits non-zero with a clear OOM
# message, which the existing `returncode != 0` handling below turns into a
# normal failed-job error instead of taking the host down.
INGESTION_MAX_MEMORY_MB = int(getattr(settings, "INGESTION_MAX_MEMORY_MB", 512))

_PROGRESS_RE = re.compile(r"^PROGRESS::(\{.*\})\s*$")

# Best-effort scrub so a stray secret echoed into a stack trace or driver
# error message doesn't end up sitting in IngestionJob.error in the DB.
_SECRET_PATTERNS = [
    re.compile(r"(postgres(?:ql)?|mongodb(?:\+srv)?)://[^\s\"']+", re.IGNORECASE),
    re.compile(r"gh[a-z]_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
]


def _scrub(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text


def _normalise_storage(cfg):
    """snake_case (as stored/submitted) -> camelCase (as the Node runner expects)."""
    if not cfg:
        return None
    return {
        "type": cfg.get("type"),
        "accessKeyId": cfg.get("access_key_id"),
        "secretAccessKey": cfg.get("secret_access_key"),
        "region": cfg.get("region"),
        "endpoint": cfg.get("endpoint"),
        "bucket": cfg.get("bucket"),
        "connectionString": cfg.get("connection_string"),
    }


def _build_runner_config(job: IngestionJob) -> dict:
    refs = job.connection_refs or {}

    connection_ids = [
        cid
        for cid in (
            refs.get("postgres_connection_id"),
            refs.get("mysql_connection_id"),
            refs.get("mongo_connection_id"),
            refs.get("storage_connection_id"),
        )
        if cid
    ]
    connections = {
        str(c.id): c
        for c in DataSourceConnection.objects.filter(user_id=job.user_id, id__in=connection_ids)
    }

    config = {
        "postgresUrl": None,
        "mysqlUrl": None,
        "mongoUrl": None,
        "mongoDbName": refs.get("mongo_db_name"),
        "storageConfig": None,
        "github": None,
        "meta": refs.get("meta", {}),
    }

    if refs.get("postgres_connection_id"):
        conn = connections.get(str(refs["postgres_connection_id"]))
        if conn is None:
            raise ValueError("Postgres connection not found for this user.")
        config["postgresUrl"] = conn.get_config().get("postgres_url")
        conn.__class__.objects.filter(id=conn.id).update(last_used_at=timezone.now())

    if refs.get("mysql_connection_id"):
        conn = connections.get(str(refs["mysql_connection_id"]))
        if conn is None or conn.kind != "mysql":
            raise ValueError("MySQL connection not found for this user.")
        config["mysqlUrl"] = conn.get_config().get("mysql_url")
        if not config["mysqlUrl"]:
            raise ValueError("MySQL connection URL is missing.")
        conn.__class__.objects.filter(id=conn.id).update(last_used_at=timezone.now())

    if refs.get("mongo_connection_id"):
        conn = connections.get(str(refs["mongo_connection_id"]))
        if conn is None:
            raise ValueError("Mongo connection not found for this user.")
        mongo_cfg = conn.get_config()
        config["mongoUrl"] = mongo_cfg.get("mongo_url")
        if not config["mongoDbName"]:
            config["mongoDbName"] = mongo_cfg.get("mongo_db_name")
        config["mongoScanAllDatabases"] = bool(refs.get("mongo_scan_all_databases"))
        conn.__class__.objects.filter(id=conn.id).update(last_used_at=timezone.now())

    if refs.get("storage_connection_id"):
        conn = connections.get(str(refs["storage_connection_id"]))
        if conn is None:
            raise ValueError("Storage connection not found for this user.")
        config["storageConfig"] = _normalise_storage(conn.get_config())
        conn.__class__.objects.filter(id=conn.id).update(last_used_at=timezone.now())

    installation_id = refs.get("github_installation_id")
    if installation_id:
        installation = GitHubAppInstallation.objects.filter(
            user_id=job.user_id, installation_id=installation_id
        ).first()
        if installation is None:
            raise ValueError("GitHub installation not found for this user.")
        token_data = mint_installation_token(installation_id)
        config["github"] = {
            "token": token_data["token"],
            "owner": refs.get("github_owner"),
            "repo": refs.get("github_repo"),
            "branch": refs.get("github_branch"),
        }

    return config


def _validate_ssrf(config: dict) -> None:
    assert_safe_config(
        postgres_url=config.get("postgresUrl"),
        mysql_url=config.get("mysqlUrl"),
        mongo_url=config.get("mongoUrl"),
        storage_config=config.get("storageConfig"),
    )


def run_ingestion_job(job_id):
    job = IngestionJob.objects.get(id=job_id)
    job.status = "running"
    job.started_at = timezone.now()
    job.stage = "starting"
    job.save(update_fields=["status", "started_at", "stage"])

    try:
        runner_config = _build_runner_config(job)
        _validate_ssrf(runner_config)

        proc = subprocess.Popen(
            ["node", f"--max-old-space-size={INGESTION_MAX_MEMORY_MB}", str(INGESTION_RUNNER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        stderr_lines = []
        stdout_chunks = []

        def _read_stderr():
            for line in proc.stderr:
                stderr_lines.append(line)
                match = _PROGRESS_RE.match(line.strip())
                if not match:
                    continue
                try:
                    payload = json.loads(match.group(1))
                except json.JSONDecodeError:
                    continue
                IngestionJob.objects.filter(id=job.id).update(
                    stage=str(payload.get("stage", ""))[:100],
                    progress_pct=max(0, min(100, int(payload.get("pct", 0) or 0))),
                )

        def _read_stdout():
            # Must be drained concurrently with stderr, not after proc.wait():
            # a claude_context JSON payload easily exceeds the OS pipe buffer
            # (64KB on Windows), so waiting until the process exits to read it
            # deadlocks — the child blocks on write() while we block on wait().
            for chunk in iter(lambda: proc.stdout.read(65536), ""):
                stdout_chunks.append(chunk)

        stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
        stdout_thread = threading.Thread(target=_read_stdout, daemon=True)
        stderr_thread.start()
        stdout_thread.start()

        proc.stdin.write(json.dumps(runner_config))
        proc.stdin.close()

        try:
            proc.wait(timeout=JOB_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise TimeoutError(f"Ingestion timed out after {JOB_TIMEOUT_SECONDS} seconds.")

        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        stdout = "".join(stdout_chunks)

        if proc.returncode != 0:
            detail = _scrub("".join(stderr_lines))[-2000:]
            raise RuntimeError(detail or "Ingestion runner exited non-zero with no output.")

        context = safe_snapshot(json.loads(stdout))

        result = IngestionContext.objects.create(
            user_id=job.user_id,
            project_name=context.get("_meta", {}).get("project", {}).get("project_name", ""),
            data=context,
            schema_fingerprint=freshness.compute_stored_fingerprint(context),
        )

        job.status = "succeeded"
        job.result = result
        job.stage = "complete"
        job.progress_pct = 100
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "result", "stage", "progress_pct", "finished_at"])

    except Exception as e:
        job.status = "failed"
        job.error = _scrub(str(e))[:4000]
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error", "finished_at"])
        raise
