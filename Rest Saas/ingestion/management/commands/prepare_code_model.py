from django.core.management.base import BaseCommand, CommandError
import hashlib
from pathlib import Path

from ingestion.semantic import MODEL, REVISION, WEIGHTS_SHA256, load_model


class Command(BaseCommand):
    help = 'Download the pinned CodeRankEmbed revision and verify local inference.'

    def handle(self, *args, **options):
        try:
            from huggingface_hub import snapshot_download
            folder = snapshot_download(MODEL, revision=REVISION,
                              ignore_patterns=['*.bin', '*.onnx', '*.h5', '*.msgpack'])
            with (Path(folder) / 'model.safetensors').open('rb') as weights:
                if hashlib.file_digest(weights, 'sha256').hexdigest() != WEIGHTS_SHA256:
                    raise ValueError('Pinned model weights failed SHA256 verification')
            model = load_model()
            vector = model.encode(['Represent this query for searching relevant code: validate a request'],
                                  normalize_embeddings=True, show_progress_bar=False)
            if vector.shape != (1, 768):
                raise ValueError('Unexpected embedding dimensions')
        except Exception as exc:
            raise CommandError(f'Model preparation failed: {exc}') from exc
        self.stdout.write(self.style.SUCCESS(f'Local retrieval ready: {MODEL}@{REVISION}'))
