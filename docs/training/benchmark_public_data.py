"""Reproducible CPU baseline for the public weak-label pilot; no model required."""
import collections
import json
from pathlib import Path

from notebook_helpers import dataset_hash, evaluate, keyword_scores, split_repositories, validate_rows

ROOT = Path(__file__).resolve().parent / 'public_data'


def main():
    rows = validate_rows([json.loads(line) for line in (ROOT / 'candidates.jsonl').read_text().splitlines()])
    splits = split_repositories(rows)
    report = dict(dataset_sha256=dataset_hash(rows), production_recommended=False,
        evidence='Public PR title plus BEFORE source; patch overlap is weak supervision. No downloaded code executed.',
        limitations=['Unchanged units may be necessary dependencies, so label 0 is uncertain.',
            'Patch overlap does not identify every required context unit.',
            'Small framework-library pilot; no application/database coverage claim.',
            'Pretrained model corpus overlap is unknown.',
            'This keyword baseline is not the full production Contexa selector.',
            'No generated-code compilation or trained-model comparison has run locally.'],
        metric_interpretation='essential_recall_at_budget = observed changed-unit recall; irrelevant_token_fraction = unchanged-unit token fraction.',
        repositories=dict(collections.Counter(r['repo_id'] for r in rows)), splits={})
    for name, subset in splits.items():
        report['splits'][name] = dict(repositories=sorted({r['repo_id'] for r in subset}),
            tasks=len({(r['repo_id'], r['task_id']) for r in subset}), candidates=len(subset),
            keyword_baselines={str(budget): evaluate(subset, keyword_scores, budget) for budget in (300, 600)})
    (ROOT / 'baseline_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'candidates': len(rows), 'repositories': len(report['repositories']),
                      'splits': {k: v['tasks'] for k, v in report['splits'].items()}}, indent=2))


if __name__ == '__main__':
    main()
