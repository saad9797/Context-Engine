"""Additional pinned real-project regression tasks. Never executes app code."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / 'Rest Saas'))
from ingestion.context_packs import build_packs, token_estimate

CASES = [
    {'fixture': 'fastapi__full-stack-fastapi-template.json',
     'request': {'task': 'Improve validation when creating items', 'endpoints': 'POST /items/', 'access': 'Authenticated users, owner assignment unchanged', 'rules': 'Preserve SQLModel validation and session dependency', 'response_shape': 'Existing ItemPublic response'},
     'required': [('backend/app/api/routes/items.py', 'def create_item('), ('backend/app/models.py', 'class ItemCreate('),
                  ('backend/app/models.py', 'class ItemPublic('), ('backend/app/models.py', 'class ItemBase('),
                  ('backend/app/api/deps.py', 'def get_current_user('), ('backend/app/api/deps.py', 'SessionDep ='),
                  ('backend/app/api/main.py', 'api_router.include_router(items.router)'), ('backend/app/main.py', 'app.include_router(api_router'),
                  ('backend/app/core/db.py', 'engine ='), ('backend/app/core/security.py', 'ALGORITHM =')],
     'forbidden': [('backend/app/api/routes/users.py', 'def create_user(')]},
    {'fixture': 'jimleestone__next-real-world.json',
     'request': {'task': 'Improve accessibility in FormInput validation errors', 'access': 'Preserve existing form access', 'rules': 'Preserve react-hook-form callbacks and existing input styles', 'response_shape': 'Existing FormInput props and JSX'},
     'required': [('components/forms/FormInput.tsx', 'function FormInput<'), ('components/forms/FormErrorMessage.tsx', 'function FormErrorMessage('),
                  ('components/forms/control-input.tsx', 'function ControlInput('), ('components/forms/Input.tsx', 'joinInputStyles'),
                  ('lib/hooks/use-form-callback.ts', 'function useFormCallback<'), ('lib/utils/styles-builder.ts', 'joinStylesFromArray')],
     'forbidden': [('components/article/CommentForm.tsx', 'function CommentForm('), ('generated/graphql.ts', 'useCreateCommentMutation')]},
]


def main():
    results = []
    for case in CASES:
        raw = json.loads((ROOT / 'public_apps' / case['fixture']).read_text(encoding='utf-8'))
        for budget in (4000, 10000, 16000):
            output = build_packs(raw, {**case['request'], 'max_tokens': budget})
            units = output['handoff']['code'] + output['handoff']['models']
            missing = [f'{path}: {marker}' for path, marker in case['required'] if not any(u['path'] == path and marker in u['content'] for u in units)]
            noise = [f'{path}: {marker}' for path, marker in case['forbidden'] if any(u['path'] == path and marker in u['content'] for u in units)]
            results.append({'repository': raw['_meta']['project']['project_name'], 'commit': raw['codebase']['repository']['commit_sha'],
                            'fixture_sha256': hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest(),
                            'budget': budget, 'estimated_copy_tokens': token_estimate(output['handoff']), 'checked_contracts': len(case['required']),
                            'missing': missing, 'forbidden_present': noise, 'status': output['handoff']['status'],
                            'context_gaps': output['handoff']['context_gaps'], 'selected_units': len(units)})
    report = {'scope': 'Agent-authored regression checks informed implementation. Not blind evaluation, generated-code success or complete-context ground truth.',
              'public_source_executed': False, 'results': results}
    (ROOT / 'expanded_contract_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))
    if any(r['estimated_copy_tokens'] > r['budget'] or r['forbidden_present'] or r['budget'] >= 10000 and r['missing'] for r in results):
        raise SystemExit('Expanded regression contracts failed; inspect report.')


if __name__ == '__main__':
    main()
