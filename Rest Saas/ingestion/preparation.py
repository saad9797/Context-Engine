"""Context jobs keep local model inference out of HTTP request timeouts."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import threading

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from rq.timeouts import JobTimeoutException

from .context_packs import build_packs
from .models import ContextPreparation
from .vector_store import VectorStore

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='context-preparation')
_slots = threading.BoundedSemaphore(3)


def run_preparation(preparation_id):
    close_old_connections()
    try:
        job = ContextPreparation.objects.select_related('context').filter(pk=preparation_id).first()
        if not job or job.status != 'pending':
            return
        if not ContextPreparation.objects.filter(pk=job.pk, status='pending').update(status='running', updated_at=timezone.now()):
            return
        snapshot = job.context
        def progress(value):
            ContextPreparation.objects.filter(pk=job.pk, status='running').update(
                output={'_progress': value}, updated_at=timezone.now())
        output = build_packs(snapshot.data, job.request_data, snapshot.id, snapshot.created_at.isoformat(), progress=progress,
                             use_semantic=job.request_data.get('retrieval_mode', 'fast') == 'semantic',
                             embedding_cache=VectorStore(snapshot.id))
        ContextPreparation.objects.filter(pk=job.pk, status='running').update(
            status='succeeded', output=output, updated_at=timezone.now())
    except Exception as exc:
        # Never expose source, model internals or credentials through exceptions.
        message = ('Source indexing timed out. Retry to resume cached progress where available, or select a smaller project folder.'
                   if isinstance(exc, JobTimeoutException) else str(exc) if isinstance(exc, ValueError)
                   else 'Context preparation failed. Retry or use a narrower task.')
        ContextPreparation.objects.filter(pk=preparation_id).update(
            status='failed', error=message[:300], updated_at=timezone.now())
    finally:
        close_old_connections()


def dispatch_preparation(job):
    if settings.INGESTION_EXECUTION_MODE == 'worker':
        import django_rq
        from rq import Worker
        queue = django_rq.get_queue('context')
        if not Worker.all(queue=queue):
            raise ValueError('The context worker is offline or starting. Please retry shortly.')
        queue.enqueue(run_preparation, str(job.id), job_timeout=900, result_ttl=0, failure_ttl=3600)
    else:
        if not _slots.acquire(blocking=False):
            raise ValueError('Context preparation is busy. Please retry shortly.')
        def execute():
            try:
                run_preparation(str(job.id))
            finally:
                _slots.release()
        try:
            _executor.submit(execute)
        except Exception:
            _slots.release()
            raise


def expire_preparations(queryset):
    queryset.filter(status='pending', created_at__lt=timezone.now() - timedelta(minutes=15)).update(
        status='failed', error='Preparation timed out. Check the worker service and retry.', updated_at=timezone.now())
    queryset.filter(status='running', updated_at__lt=timezone.now() - timedelta(minutes=15)).update(
        status='failed', error='Preparation timed out. Check the worker service and retry.', updated_at=timezone.now())
    queryset.filter(created_at__lt=timezone.now() - timedelta(days=1)).delete()
