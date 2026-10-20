"""Fetch pinned, licensed public source for READ-ONLY retrieval evaluation.

Never extracts an archive onto disk or executes downloaded source/tests.
Snapshots exclude secret files, tests, migrations, records and dependencies.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / 'Rest Saas'))
from ingestion.context_packs import CODE, NOISE
from ingestion.privacy import SECRET_FILE, redact_text

REPOS = ['SeuRonao/realworld-express-prisma', 'Sean-Miningah/realWorld-DjangoRestFramework',
         'fastapi/full-stack-fastapi-template',
         'jimleestone/next-real-world']


def download(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'Contexa-public-context-evaluation'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Public fixture download exceeds limit')
    return data


def main():
    destination = ROOT / 'public_apps'
    destination.mkdir(exist_ok=True)
    for repo in REPOS:
        slug = repo.replace('/', '__')
        target = destination / (slug + '.json')
        if target.exists():
            print('Using pinned fixture', repo)
            continue
        info = json.loads(download(f'https://api.github.com/repos/{repo}/commits?per_page=1', 200_000))
        commit = info[0]['sha']
        archive_bytes = download(f'https://codeload.github.com/{repo}/tar.gz/{commit}', 5_000_000)
        sources, licenses, size = [], [], 0
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
            for member in archive:
                if not member.isfile() or member.size > 128_000:
                    continue
                path = member.name.partition('/')[2]
                if not path or SECRET_FILE.search(path) or NOISE.search(path) or re.search(r'(^|/)(node_modules|vendor|dist|staticfiles|static|e2e|\.git)/|(?:^|/)(?:tests?|test_\w+)\.py$', path):
                    continue
                if not CODE.search(path) and not re.search(r'(^|/)(package\.json|requirements\.txt|pyproject\.toml)$', path) and path not in ('LICENSE', 'LICENSE.md', 'LICENSE.txt'):
                    continue
                text = archive.extractfile(member).read().decode('utf-8')
                if path.startswith('LICENSE'):
                    licenses.append((path, text))
                elif CODE.search(path) or re.search(r'(^|/)(package\.json|requirements\.txt|pyproject\.toml)$', path):
                    size += len(text.encode())
                    if size > 2_000_000 or len(sources) >= 220:
                        raise ValueError('Public app exceeds capture limits; fixture must disclose a subset')
                    sources.append({'path': path, 'content': redact_text(text), 'sha': hashlib.sha256(text.encode()).hexdigest()})
        if not any('permission is hereby granted' in text.lower() for _, text in licenses):
            raise ValueError(f'Expected MIT license for {repo}; review before retaining source')
        for path, text in licenses:
            (destination / (slug + '__' + path)).write_text(text, encoding='utf-8')
        package = next((json.loads(s['content']) for s in sources if s['path'] == 'package.json'), {})
        requirements = next((s['content'] for s in sources if s['path'] == 'requirements.txt'), '')
        raw = {'_meta': {'project': {'project_name': repo}}, 'codebase': {
            'repository': {'commit_sha': commit, 'url': f'https://github.com/{repo}'},
            'stack': {'package_json': package, 'requirements_txt': requirements},
            'key_files_by_role': {'source': sources}}}
        target.write_text(json.dumps(raw, indent=2), encoding='utf-8')
        print(repo, commit, len(sources), 'source files', flush=True)


if __name__ == '__main__':
    main()
