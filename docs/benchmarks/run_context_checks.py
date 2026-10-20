"""Offline context checks; reads fixtures, never executes downloaded app code.

--baseline-ref optionally compares trusted Contexa code at a Git revision.
This executes this project's selector implementation, never public app source.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(REPO / 'Rest Saas'))
from ingestion.context_benchmark import evaluate
from ingestion.context_packs import build_packs, token_estimate

CASES = [
    ('SeuRonao__realworld-express-prisma.json', [
        ('src/controllers/articlesController/articlesCreate.ts', 'export default async function articlesCreate('),
        ('src/middleware/articlesValidator/articlesCreateValidator.ts', 'const errors: ValidationError'),
        ('src/middleware/auth/authenticator.ts', 'export const authenticate = jwt('),
        ('src/utils/db/article/articleCreatePrisma.ts', 'const article = await prisma.article.create('),
        ('src/view/articleViewer.ts', 'export default function articleViewer('),
        ('src/view/profileViewer.ts', 'export default function profileViewer('),
        ('src/app.ts', 'app.use("/api/articles", articlesRouter)'),
        ('prisma/schema.prisma', 'model Article {'),
        ('prisma/schema.prisma', 'model User {'),
    ]),
    ('Sean-Miningah__realWorld-DjangoRestFramework.json', [
        ('articles/views.py', 'class ArticleView('),
        ('articles/views.py', 'permission_classes=[IsAuthenticated]'),
        ('articles/serializers.py', 'class ArticleSerializer('),
        ('articles/serializers.py', 'class AuthorSerializer('),
        ('articles/models.py', 'class Article('),
        ('accounts/models.py', 'class User(AbstractUser)'),
        ('articles/urls.py', "article_router.register('articles', views.ArticleView"),
        ('config/settings.py', "AUTH_USER_MODEL = 'accounts.User'"),
        ('config/settings.py', 'rest_framework_simplejwt.authentication.JWTAuthentication'),
    ]),
]


def included_source(output):
    packs = [output['handoff']] if 'handoff' in output else [output['base'], output['task']]
    return [unit for pack in packs for section in ('contracts', 'example', 'models', 'code') for unit in pack.get(section, [])]


def public_checks(builder):
    records = []
    for filename, required in CASES:
        raw = json.loads((ROOT / 'public_apps' / filename).read_text(encoding='utf-8'))
        for budget in (4000, 10000):
            # Equal total copied-input ceiling. The legacy implementation uses
            # two packs, so each receives half with a small envelope allowance.
            modern = builder is build_packs
            request = dict(task='Improve validation when creating articles', endpoints='POST /articles',
                access='Authenticated users', rules='Preserve authentication and serializer/validator conventions',
                response_shape='Existing article response', max_tokens=budget if modern else (budget - 100) // 2)
            started = time.perf_counter()
            output = builder(raw, request)
            elapsed = round((time.perf_counter() - started) * 1000)
            source = included_source(output)
            missing = [f'{path}: {marker}' for path, marker in required if not any(u['path'] == path and marker in u['content'] for u in source)]
            tokens = token_estimate(output['handoff']) if modern else token_estimate({'base': output['base'], 'task': output['task']})
            records.append(dict(repository=raw['_meta']['project']['project_name'],
                commit=raw['codebase']['repository']['commit_sha'], source_files=len(raw['codebase']['key_files_by_role']['source']),
                budget=budget, estimated_copy_tokens=tokens, within_budget=tokens <= budget,
                checked_contracts=len(required), missing=missing, checked_contract_recall=(len(required) - len(missing)) / len(required),
                status=output.get('handoff', {}).get('status', 'legacy_split'),
                omitted_count=len(output['report'].get('handoff_omitted', [])),
                source_bytes=sum(len(u['content'].encode()) for u in raw['codebase']['key_files_by_role']['source']),
                handoff_source_bytes=sum(len(u['content'].encode()) for u in source),
                elapsed_ms=elapsed, fixture_sha256=hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()))
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-ref', help='Trusted Contexa Git revision for a frozen legacy comparison')
    args = parser.parse_args()
    fixture_report = evaluate(build_packs)
    (ROOT / 'context_after.json').write_text(json.dumps(fixture_report, indent=2), encoding='utf-8')
    report = dict(format='contexa.public-contract-checks.v1',
        scope='Agent-authored contract checks on pinned public application source. Not complete-context ground truth, semantic precision, or generated-code compile/test results.',
        public_source_executed=False, comparison_budget='Same total copied JSON estimate; legacy splits budget between base and task.',
        current=public_checks(build_packs))
    if args.baseline_ref:
        revision = subprocess.check_output(['git', 'rev-parse', '--verify', args.baseline_ref + '^{commit}'], cwd=REPO, text=True).strip()
        source = subprocess.check_output(['git', 'show', revision + ':Rest Saas/ingestion/context_packs.py'], cwd=REPO).decode()
        module = types.ModuleType('ingestion._trusted_legacy_benchmark')
        module.__package__ = 'ingestion'
        exec(compile(source, 'trusted-contexa-selector-baseline', 'exec'), module.__dict__)
        report.update(baseline_revision=revision, baseline_selector_sha256=hashlib.sha256(source.encode()).hexdigest(),
                      baseline=public_checks(module.build_packs))
    (ROOT / 'public_contract_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'controlled_checks_pass': fixture_report['all_contracts_present'],
        'public': [{'repository': r['repository'], 'budget': r['budget'], 'recall': r['checked_contract_recall'],
                    'tokens': r['estimated_copy_tokens'], 'status': r['status']} for r in report['current']]}, indent=2))
    if not fixture_report['all_contracts_present'] or any(r['missing'] or not r['within_budget'] for r in report['current'] if r['budget'] == 10000):
        raise SystemExit('Context contract checks failed. Inspect reports before release.')


if __name__ == '__main__':
    main()
