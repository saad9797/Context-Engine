"""Per-owner storage/work reservations, shared by every snapshot entry point."""
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import IngestionContext, IngestionJob

SNAPSHOT_LIMIT = 100
ACTIVE_JOB_LIMIT = 2


def snapshot_usage(user):
    return IngestionContext.objects.filter(user=user).count() + IngestionJob.objects.filter(user=user, status__in=['pending', 'running']).count()


def reserve_job(user, refs):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        if snapshot_usage(user) >= SNAPSHOT_LIMIT:
            raise ValueError('Snapshot limit reached (100 including active builds). Delete an unused snapshot before starting another.')
        if IngestionJob.objects.filter(user=user, status__in=['pending', 'running']).count() >= ACTIVE_JOB_LIMIT:
            raise ValueError('Two snapshot builds are already active. Wait for one to finish before starting another.')
        return IngestionJob.objects.create(user=user, connection_refs=refs)
