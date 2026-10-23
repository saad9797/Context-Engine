from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from ingestion.models import ContextPreparation


class Command(BaseCommand):
    help = 'Delete context preparations older than 24 hours; retain saved handoffs.'

    def handle(self, *args, **options):
        count, _ = ContextPreparation.objects.filter(created_at__lt=timezone.now() - timedelta(days=1)).delete()
        self.stdout.write(f'Deleted {count} expired preparation records.')
