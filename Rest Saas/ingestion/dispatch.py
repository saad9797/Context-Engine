"""Shared execution policy for new snapshots and rebuilds."""
import django_rq
from django.conf import settings
from django.utils import timezone
from .tasks import run_ingestion_job


class BackendBusy(Exception):
    pass


def dispatch_job(job):
    if settings.INGESTION_EXECUTION_MODE == "worker":
        try:
            queued = django_rq.get_queue("ingestion").enqueue(run_ingestion_job, str(job.id))
            job.rq_job_id = queued.id
            job.save(update_fields=["rq_job_id"])
            return
        except Exception:
            message = "Could not queue the snapshot. Check the queue connection and worker service."
    else:
        # Redis is already required for application throttling. The shared lock
        # prevents concurrent Node processes exhausting a small web instance.
        lock = None
        acquired = False
        try:
            lock = django_rq.get_connection("ingestion").lock("contexa:inline-ingestion", timeout=120, blocking_timeout=0)
            acquired = lock.acquire(blocking=False)
            if not acquired:
                raise BackendBusy("The backend is building another snapshot. Try again in a minute.")
            job.rq_job_id = "inline"
            job.save(update_fields=["rq_job_id"])
            run_ingestion_job(str(job.id), timeout_seconds=45, memory_mb=128)
            job.refresh_from_db()
            return
        except BackendBusy as exc:
            message = str(exc)
        except Exception:
            # The runner persists a scrubbed error. Never expose connection details.
            job.refresh_from_db()
            message = job.error if job.status == "failed" else "Backend processing was interrupted. Try again or import a local folder."
        finally:
            if acquired:
                try:
                    lock.release()
                except Exception:
                    pass  # Lock expiry must not hide a saved result or original error.
    job.status = "failed"
    job.error = message
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error", "finished_at"])
    raise ValueError(message)
