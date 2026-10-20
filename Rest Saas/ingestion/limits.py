"""Per-owner storage/work reservations, shared by every snapshot entry point."""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from datetime import timedelta

from .models import IngestionContext, IngestionJob

SNAPSHOT_LIMIT = 100
ACTIVE_JOB_LIMIT = 2


def expire_inline_jobs(user):
    # A web restart cannot run exception handlers. Recover abandoned reservations.
    IngestionJob.objects.filter(
        user=user, rq_job_id="inline", status="running",
        started_at__lt=timezone.now() - timedelta(seconds=120),
    ).update(status="failed", finished_at=timezone.now(),
             error="Backend build was interrupted or exceeded its time limit. Retry with fewer sources, import a local folder, or use worker mode.")


def snapshot_usage(user):
    expire_inline_jobs(user)
    return IngestionContext.objects.filter(user=user).count() + IngestionJob.objects.filter(user=user, status__in=['pending', 'running']).count()


def reserve_job(user, refs):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        if snapshot_usage(user) >= SNAPSHOT_LIMIT:
            raise ValueError('Snapshot limit reached (100 including active builds). Delete an unused snapshot before starting another.')
        if IngestionJob.objects.filter(user=user, status__in=['pending', 'running']).count() >= ACTIVE_JOB_LIMIT:
            raise ValueError('Two snapshot builds are already active. Wait for one to finish before starting another.')
        return IngestionJob.objects.create(user=user, connection_refs=refs)
