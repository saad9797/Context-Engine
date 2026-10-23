"""Local, revision-pinned code retrieval. Never downloads during a customer request.

Customer vectors are cached with their snapshot, not in global process state.
Standalone callers have a bounded volatile cache. Source is never sent to
Hugging Face. Each persistent context worker owns one model.
"""
from collections import OrderedDict
from functools import lru_cache
import hashlib
import os
import threading
import time
from rq.timeouts import JobTimeoutException

MODEL = 'nomic-ai/CodeRankEmbed'
REVISION = '3c4b60807d71f79b43f3c4363786d9493691f8b1'
WEIGHTS_SHA256 = '827529bcd58aef0d9082e66eeff7e7d53a02f62bd005f841a26b3d3e2fb17ebe'
CACHE_POLICY = REVISION + ':window480-stride400-f32'
PREFIX = 'Represent this query for searching relevant code: '
_lock = threading.Lock()
_vectors = OrderedDict()
MAX_CACHE = 8192


@lru_cache(maxsize=1)
def load_model():
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL, revision=REVISION, trust_remote_code=True,
                                local_files_only=True, device=os.getenv('CONTEXA_EMBED_DEVICE', 'cpu'))
    # Small overlapping windows bound CPU attention memory. The original model
    # supports longer inputs, but server memory must not scale quadratically
    # with a customer's largest class or generated declaration.
    model.max_seq_length = 512
    return model


def semantic_rank(units, query, progress=None, cache=None):
    """Return ranked unit IDs plus honest availability/coverage diagnostics."""
    report = {'mode': 'lexical', 'model': MODEL, 'revision': REVISION, 'status': 'disabled'}
    if os.getenv('CONTEXA_SEMANTIC', '1') == '0' or not query.strip() or not units:
        return [], report
    # Avoid allowing concurrent requests to multiply inference memory usage.
    if not _lock.acquire(timeout=2):
        report['status'] = 'busy'
        return [], report
    try:
        if progress:
            progress({'stage': 'Loading project search'})
        try:
            model = load_model()
        except Exception as exc:
            if isinstance(exc, JobTimeoutException):
                raise
            report['status'] = 'unavailable'
            return [], report
        import numpy as np
        windows, owners = [], []
        # Every unit participates. Long units are searched through overlapping
        # tokenizer windows rather than silently truncating the source tail.
        for uid, unit in units.items():
            text = unit['path'] + '\n' + ' '.join(unit['symbols']) + '\n' + unit['content']
            ids = model.tokenizer.encode(text, add_special_tokens=False)
            for start in range(0, max(1, len(ids)), 400):
                windows.append(model.tokenizer.decode(ids[start:start + 480]))
                owners.append(uid)
                if start + 480 >= len(ids):
                    break
        if len(windows) > 12000:
            report['status'] = 'capacity_exceeded'
            return [], report
        keys = [hashlib.sha256((CACHE_POLICY + text).encode()).hexdigest() for text in windows]
        # Customer jobs use the snapshot's private database cache. The bounded
        # volatile cache is only for standalone callers without a snapshot.
        volatile = _vectors if cache is None else {}
        restored = {}
        if cache:
            try:
                restored = cache.load(keys)
                report['persistent_cache'] = 'ready'
            except Exception as exc:
                if isinstance(exc, JobTimeoutException):
                    raise
                report['persistent_cache'] = 'unavailable'
        missing = list(dict.fromkeys(k for k in keys if k not in volatile and k not in restored))
        if progress:
            progress({'stage': 'Preparing source search', 'completed': len(keys) - len(missing), 'total': len(keys)})
        lookup = dict(zip(keys, windows))
        # Keep request-local references even when the bounded cache evicts.
        vectors = {k: np.asarray(v, dtype=np.float32) for k, v in restored.items()}
        vectors.update({k: volatile[k] for k in keys if k in volatile})
        checkpoint = time.monotonic()
        for start in range(0, len(missing), 2):
            batch = missing[start:start + 2]
            encoded = model.encode([lookup[k] for k in batch], normalize_embeddings=True,
                                   batch_size=2, show_progress_bar=False)
            if not np.isfinite(encoded).all():
                raise ValueError('Non-finite embedding output')
            for key, vector in zip(batch, encoded):
                vectors[key] = vector
                if cache is None:
                    _vectors[key] = vector
                    while len(_vectors) > MAX_CACHE:
                        _vectors.popitem(last=False)
            if cache and time.monotonic() - checkpoint > 60:
                try:
                    cache.save(keys, vectors)
                except Exception as exc:
                    if isinstance(exc, JobTimeoutException):
                        raise
                    report['persistent_cache'] = 'write_failed'
                checkpoint = time.monotonic()
            if progress and (start % 16 == 0 or start + 2 >= len(missing)):
                progress({'stage': 'Preparing source search', 'completed': len(keys) - len(missing) + min(start + 2, len(missing)), 'total': len(keys)})
        if progress:
            progress({'stage': 'Finding relevant source'})
        if cache and missing:
            try:
                cache.save(keys, vectors)
            except Exception as exc:
                if isinstance(exc, JobTimeoutException):
                    raise
                report['persistent_cache'] = 'write_failed'
        query_ids = model.tokenizer.encode(query, add_special_tokens=False)
        queries = [PREFIX + model.tokenizer.decode(query_ids[start:start + 450])
                   for start in range(0, len(query_ids), 400)]
        q = model.encode(queries, normalize_embeddings=True, batch_size=2, show_progress_bar=False)
        if not np.isfinite(q).all():
            raise ValueError('Non-finite query output')
        scores = {}
        for uid, key in zip(owners, keys):
            scores[uid] = max(scores.get(uid, -1), float(np.max(q @ vectors[key])))
        ranked = sorted(scores, key=lambda uid: (-scores[uid], uid))
        report.update(mode='hybrid', status='ready', indexed_units=len(scores), windows=len(windows),
                      cached_windows=len(keys) - len(missing))
        # Similarity is a ranking signal, never a calibrated confidence score.
        return ranked[:30], report
    except JobTimeoutException:
        raise
    except Exception:
        report['status'] = 'failed'
        return [], report
    finally:
        _lock.release()


def fuse(lexical, semantic, limit=5):
    scores = {}
    for ranking in (lexical, semantic):
        for rank, uid in enumerate(ranking):
            scores[uid] = scores.get(uid, 0) + 1 / (60 + rank + 1)
    return sorted(scores, key=lambda uid: (-scores[uid], uid))[:limit]
