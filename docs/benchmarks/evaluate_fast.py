"""Measure fast retrieval only; no network, model inference or application execution."""
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import time
from unittest.mock import patch

from evaluate_hybrid import cases, build_packs, token_estimate

ROOT = Path(__file__).resolve().parent
records = []
for case in cases():
    raw = json.loads((ROOT / 'public_apps' / case['fixture']).read_text(encoding='utf-8'))
    for budget in (4000, 10000):
        timings = []
        with patch('ingestion.source_index.semantic_rank', side_effect=AssertionError('Fast retrieval invoked a model')):
            for _ in range(3):
                start = time.perf_counter()
                output = build_packs(raw, {**case['request'], 'retrieval_mode': 'fast', 'max_tokens': budget}, use_semantic=False)
                timings.append(round(time.perf_counter() - start, 4))
        units = output['handoff']['code'] + output['handoff']['models']
        missing = [f'{path}: {marker}' for path, marker in case['required']
                   if not any(u['path'] == path and marker in u['content'] for u in units)]
        noise = [f'{path}: {marker}' for path, marker in case.get('forbidden', [])
                 if any(u['path'] == path and marker in u['content'] for u in units)]
        record = {'fixture': case['fixture'], 'budget': budget, 'seconds': timings,
                  'median_seconds': statistics.median(timings), 'required_contracts': len(case['required']),
                  'missing': missing, 'forbidden_present': noise, 'estimated_tokens': token_estimate(output['handoff']),
                  'status': output['handoff']['status']}
        records.append(record)
        print(f"{case['fixture']} {budget}: {record['median_seconds']}s, {len(case['required'])-len(missing)}/{len(case['required'])} markers", flush=True)
        assert record['estimated_tokens'] <= budget and not noise
        if budget == 10000:
            assert not missing
(ROOT / 'fast_report.json').write_text(json.dumps({
    'created_at': datetime.now(timezone.utc).isoformat(),
    'scope': 'Local retrieval from already-captured source, three calls per case. Excludes upload, ingestion, queueing, HTTP, production load and coding-model success. Regression fixtures informed implementation, not blind evaluation.',
    'results': records,
}, indent=2), encoding='utf-8')
