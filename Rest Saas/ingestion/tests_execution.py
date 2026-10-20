from datetime import timedelta
from unittest.mock import MagicMock, patch
import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from .dispatch import dispatch_job
from .limits import expire_inline_jobs
from .models import IngestionJob
from .tasks import run_ingestion_job


@pytest.fixture
def job(db):
    return IngestionJob.objects.create(user=User.objects.create_user(username="execution-owner"), connection_refs={})


def test_worker_mode_enqueues_without_running_in_web(job, settings):
    settings.INGESTION_EXECUTION_MODE = "worker"
    with patch("ingestion.dispatch.django_rq.get_queue") as queue, patch("ingestion.dispatch.run_ingestion_job") as runner:
        queue.return_value.enqueue.return_value.id = "rq-123"
        dispatch_job(job)
        queue.return_value.enqueue.assert_called_once()
        runner.assert_not_called()
    job.refresh_from_db()
    assert job.rq_job_id == "rq-123"


def test_inline_mode_runs_with_limits_without_enqueue(job, settings):
    settings.INGESTION_EXECUTION_MODE = "inline"
    with patch("ingestion.dispatch.django_rq.get_connection") as redis, patch("ingestion.dispatch.django_rq.get_queue") as queue, patch("ingestion.dispatch.run_ingestion_job") as runner:
        redis.return_value.lock.return_value.acquire.return_value = True
        dispatch_job(job)
        runner.assert_called_once_with(str(job.id), timeout_seconds=45, memory_mb=128)
        queue.assert_not_called()
        redis.return_value.lock.return_value.release.assert_called_once()
    assert job.rq_job_id == "inline"


def test_busy_backend_fails_fast_without_running_or_releasing_foreign_lock(job, settings):
    settings.INGESTION_EXECUTION_MODE = "inline"
    with patch("ingestion.dispatch.django_rq.get_connection") as redis, patch("ingestion.dispatch.run_ingestion_job") as runner:
        redis.return_value.lock.return_value.acquire.return_value = False
        with pytest.raises(ValueError, match="another snapshot"):
            dispatch_job(job)
        runner.assert_not_called()
        redis.return_value.lock.return_value.release.assert_not_called()
    job.refresh_from_db()
    assert job.status == "failed" and job.finished_at


def test_abandoned_inline_recovery_does_not_touch_workers_or_other_users(job):
    old = timezone.now() - timedelta(minutes=3)
    IngestionJob.objects.filter(pk=job.pk).update(status="running", rq_job_id="inline", started_at=old)
    worker = IngestionJob.objects.create(user=job.user, status="running", rq_job_id="rq-1", started_at=old)
    other = IngestionJob.objects.create(user=User.objects.create_user(username="other"), status="running", rq_job_id="inline", started_at=old)
    expire_inline_jobs(job.user)
    job.refresh_from_db(); worker.refresh_from_db(); other.refresh_from_db()
    assert job.status == "failed"
    assert worker.status == other.status == "running"


def test_duplicate_completed_job_never_starts_node(job):
    IngestionJob.objects.filter(pk=job.pk).update(status="succeeded")
    with patch("ingestion.tasks.subprocess.Popen") as process:
        run_ingestion_job(str(job.id))
        process.assert_not_called()


def test_inline_failure_releases_capacity_and_hides_unhandled_credentials(job, settings):
    settings.INGESTION_EXECUTION_MODE = "inline"
    with patch("ingestion.dispatch.django_rq.get_connection") as redis, patch("ingestion.dispatch.run_ingestion_job", side_effect=RuntimeError("secret-password")):
        redis.return_value.lock.return_value.acquire.return_value = True
        with pytest.raises(ValueError) as error:
            dispatch_job(job)
        assert "secret-password" not in str(error.value)
        redis.return_value.lock.return_value.release.assert_called_once()
    job.refresh_from_db()
    assert job.status == "failed"


def test_inline_timeout_kills_runner_and_records_failure(job):
    import io
    import subprocess
    process = MagicMock()
    process.stdin = io.StringIO()
    process.stdout = io.StringIO("")
    process.stderr = io.StringIO("")
    process.wait.side_effect = [subprocess.TimeoutExpired("node", 45), 0]
    process.poll.return_value = 0
    with patch("ingestion.tasks._build_runner_config", return_value={}), patch("ingestion.tasks._validate_ssrf"), patch("ingestion.tasks.subprocess.Popen", return_value=process):
        with pytest.raises(TimeoutError, match="45 seconds"):
            run_ingestion_job(str(job.id), timeout_seconds=45, memory_mb=128)
    process.kill.assert_called_once()
    job.refresh_from_db()
    assert job.status == "failed" and job.finished_at
    assert "worker mode" in job.error
