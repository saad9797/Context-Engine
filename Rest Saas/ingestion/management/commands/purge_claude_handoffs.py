from django.core.management.base import BaseCommand
from django.utils import timezone
from ingestion.models import ClaudeLaunch


class Command(BaseCommand):
    help = 'Delete encrypted Claude handoff prompts whose links have expired.'

    def handle(self, *args, **options):
        count, _ = ClaudeLaunch.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(f'Deleted {count} expired Claude handoffs.')
