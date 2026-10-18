from django.core.management.base import BaseCommand

from ingestion.models import IngestionContext
from ingestion.privacy import safe_snapshot


class Command(BaseCommand):
    help = "Remove retained database records and known credential literals from saved snapshots. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        changed = 0
        for snapshot in IngestionContext.objects.only("id", "data").iterator(chunk_size=20):
            cleaned = safe_snapshot(snapshot.data)
            if cleaned != snapshot.data:
                changed += 1
                if options["apply"]:
                    IngestionContext.objects.filter(pk=snapshot.pk).update(data=cleaned)
        self.stdout.write(f"{'Sanitized' if options['apply'] else 'Would sanitize'} {changed} snapshot(s).")
