"""Check actual tokenizer lengths without installing Torch or running source code.

Install tokenizers==0.22.2 into public_cache/tokenizer_runtime using pip --target
--no-deps. This isolated optional check does not modify the backend environment.
"""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'public_cache/tokenizer_runtime'))
from tokenizers import Tokenizer
from notebook_helpers import dataset_hash, passage_text, query_text, validate_rows


def main():
    revision = '233902d25c440f23af6f7d6e94d2946bac0bee0a'
    target = ROOT / 'public_cache/model_tokenizer.json'
    if not target.exists():
        url = f'https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2/resolve/{revision}/tokenizer.json'
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(5_000_001)
        if len(data) > 5_000_000:
            raise ValueError('Tokenizer download too large')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    tokenizer = Tokenizer.from_file(str(target))
    tokenizer.no_truncation()
    rows = validate_rows([json.loads(line) for line in (ROOT / 'public_data/candidates.jsonl').read_text().splitlines()])
    sizes = [len(tokenizer.encode(query_text(row), passage_text(row)).ids) for row in rows]
    queries = [len(tokenizer.encode(query_text(row)).ids) for row in rows]
    report = dict(dataset_sha256=dataset_hash(rows), tokenizer_revision=revision,
        tokenizer_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        candidates=len(rows), max_pair_tokens=max(sizes), max_query_tokens=max(queries),
        pairs_over_384=sum(size > 384 for size in sizes), queries_over_128=sum(size > 128 for size in queries))
    (ROOT / 'public_data/tokenizer_preflight.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    if report['pairs_over_384'] or report['queries_over_128']:
        raise ValueError('Complete units do not fit: do not silently truncate training input.')


if __name__ == '__main__':
    main()
