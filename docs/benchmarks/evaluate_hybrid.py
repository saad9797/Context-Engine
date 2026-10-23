"""Reproducible retrieval comparison. Does not run apps or a coding model."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / 'Rest Saas'))
from ingestion.context_packs import build_packs, token_estimate
from ingestion.semantic import MODEL, REVISION
from run_context_checks import CASES as PUBLIC_CASES
from expanded_checks import CASES as EXPANDED_CASES


def cases():
    for filename, required in PUBLIC_CASES:
        yield {'fixture': filename, 'required': required, 'forbidden': [],
               'request': {'task': 'Improve validation when creating articles', 'endpoints': 'POST /articles',
                           'access': 'Authenticated users', 'rules': 'Preserve authentication and validator conventions',
                           'response_shape': 'Existing article response'}}
    yield from EXPANDED_CASES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'hybrid_report.json')
    parser.add_argument('--budgets', type=int, nargs='+', default=[4000, 10000])
    args = parser.parse_args()
    os.environ['CONTEXA_SEMANTIC'] = '1'
    records = []
    for case in cases():
        raw = json.loads((ROOT / 'public_apps' / case['fixture']).read_text(encoding='utf-8'))
        for budget in args.budgets:
            for mode in ('lexical', 'hybrid'):
                start = time.perf_counter()
                output = build_packs(raw, {**case['request'], 'max_tokens': budget}, use_semantic=mode == 'hybrid')
                units = output['handoff']['code'] + output['handoff']['models']
                missing = [f'{path}: {marker}' for path, marker in case['required']
                           if not any(u['path'] == path and marker in u['content'] for u in units)]
                noise = [f'{path}: {marker}' for path, marker in case.get('forbidden', [])
                         if any(u['path'] == path and marker in u['content'] for u in units)]
                record = {'fixture': case['fixture'], 'fixture_sha256': hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest(),
                          'mode': mode, 'budget': budget, 'elapsed_seconds': round(time.perf_counter() - start, 3),
                          'required_contracts': len(case['required']), 'missing': missing, 'forbidden_present': noise,
                          'estimated_tokens': token_estimate(output['handoff']), 'status': output['handoff']['status'],
                          'retrieval': output['report']['retrieval']}
                records.append(record)
                print(f"{case['fixture']} {mode} budget={budget}: {len(case['required'])-len(missing)}/{len(case['required'])} contracts, {len(noise)} forbidden, {record['elapsed_seconds']}s", flush=True)
                args.output.write_text(json.dumps({'created_at': datetime.now(timezone.utc).isoformat(), 'model': MODEL, 'revision': REVISION,
                    'scope': 'Agent-authored regression fixtures, not blind evaluation or generated-code success. No customer/public application code executed.',
                    'results': records}, indent=2), encoding='utf-8')
    if any(r['estimated_tokens'] > r['budget'] or r['mode'] == 'hybrid' and r['retrieval']['status'] not in ('ready', 'exact_scope') for r in records):
        raise SystemExit('Budget or model availability check failed; inspect report.')
    for lexical, hybrid in zip(records[::2], records[1::2]):
        if set(hybrid['missing']) - set(lexical['missing']) or set(hybrid['forbidden_present']) - set(lexical['forbidden_present']):
            raise SystemExit('Hybrid retrieval regressed a checked contract/noise constraint; inspect report.')


if __name__ == '__main__':
    main()
