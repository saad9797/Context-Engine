"""Bounded binary float storage. No pickle and no source text in the cache."""
from array import array
import sys
import zlib

from .models import SourceVectorCache
from .semantic import CACHE_POLICY

DIMENSION = 768
MAX_WINDOWS = 12000
MAX_BYTES = MAX_WINDOWS * DIMENSION * 4


class VectorStore:
    def __init__(self, snapshot_id):
        self.snapshot_id = snapshot_id

    def load(self, requested):
        saved = SourceVectorCache.objects.filter(context_id=self.snapshot_id, policy=CACHE_POLICY).first()
        if not saved or not isinstance(saved.keys, list) or len(saved.keys) > MAX_WINDOWS:
            return {}
        try:
            decoder = zlib.decompressobj()
            raw = decoder.decompress(bytes(saved.vectors), MAX_BYTES + 1)
            if len(raw) > MAX_BYTES or not decoder.eof or len(raw) != len(saved.keys) * DIMENSION * 4:
                return {}
            values = array('f')
            values.frombytes(raw)
            if sys.byteorder != 'little':
                values.byteswap()
            wanted = set(requested)
            return {key: values[i * DIMENSION:(i + 1) * DIMENSION] for i, key in enumerate(saved.keys) if key in wanted}
        except (ValueError, zlib.error):
            return {}

    def save(self, keys, vectors):
        keys = list(dict.fromkeys(key for key in keys if key in vectors))[:MAX_WINDOWS]
        packed = array('f')
        for key in keys:
            vector = vectors[key]
            if len(vector) != DIMENSION:
                raise ValueError('Unexpected embedding dimension')
            packed.extend(vector)
        if sys.byteorder != 'little':
            packed.byteswap()
        SourceVectorCache.objects.update_or_create(context_id=self.snapshot_id,
            defaults={'policy': CACHE_POLICY, 'keys': keys, 'vectors': zlib.compress(packed.tobytes(), level=1)})
