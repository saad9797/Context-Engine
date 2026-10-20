"""Collect licensed, before-change source with explicit patch-derived weak labels.

No downloaded code is executed. No credentials or private repositories are used.
The resulting labels measure changed-unit retrieval, not complete task context.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
REPOS = ('pallets/flask', 'fastapi/fastapi', 'django/django',
         'encode/django-rest-framework', 'sqlalchemy/sqlalchemy', 'pydantic/pydantic',
         'expressjs/express', 'sequelize/sequelize', 'Automattic/mongoose', 'vuejs/core')
HEADERS = {'User-Agent': 'Contexa-public-context-research', 'Accept': 'application/vnd.github+json'}
CACHE = ROOT / 'public_cache'


def fetch(url, json_data=False):
    if not url.startswith(('https://api.github.com/', 'https://raw.githubusercontent.com/')):
        raise ValueError('Only fixed public GitHub hosts are supported')
    CACHE.mkdir(exist_ok=True)
    target = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if target.exists():
        raw = target.read_bytes()
    else:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as response:
                    raw = response.read(2_000_001)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503) or attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        if len(raw) > 2_000_000:
            raise ValueError('Public source response too large')
        target.write_bytes(raw)
    text = raw.decode('utf-8')
    return json.loads(text) if json_data else text


def units(source, path):
    """Return complete small files or complete Python AST definitions, never slices."""
    if len(source) <= 700:
        return [(1, len(source.splitlines()), source)]
    if not path.endswith('.py'):
        parser = ROOT.parents[1] / 'Rest Saas Frontend/node_modules/@babel/parser'
        if not parser.exists():
            return []
        script = """const fs=require('fs'),parser=require(process.argv[1]);
const s=fs.readFileSync(0,'utf8');
const t=parser.parse(s,{sourceType:'unambiguous',plugins:['typescript','jsx'],errorRecovery:false});
const out=[];
function walk(n){if(!n||typeof n!=='object')return;
if(['FunctionDeclaration','ClassDeclaration','VariableDeclaration','TSInterfaceDeclaration','TSTypeAliasDeclaration'].includes(n.type)&&n.end-n.start<=700)
out.push([n.loc.start.line,n.loc.end.line,s.slice(n.start,n.end)]);
for(const [k,v] of Object.entries(n)){if(['loc','tokens','comments'].includes(k))continue;
if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}
walk(t.program);process.stdout.write(JSON.stringify(out));"""
        try:
            result = subprocess.run(['node', '-e', script, str(parser)], input=source,
                                    encoding='utf-8', capture_output=True, timeout=15, check=True)
            return json.loads(result.stdout)
        except (subprocess.SubprocessError, OSError, ValueError):
            return []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    lines = source.splitlines(keepends=True)
    result = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            content = ''.join(lines[start - 1:node.end_lineno])
            if len(content) <= 700:
                result.append((start, node.end_lineno, content))
    return result


def changed_lines(patch):
    # Include insertion anchors: adding a statement may not remove an old line.
    result, old = set(), 0
    for line in patch.splitlines():
        if line.startswith('@@'):
            match = re.match(r'@@ -(\d+)', line)
            if match:
                old = int(match[1])
        elif line.startswith('-'):
            result.add(old)
            old += 1
        elif line.startswith('+'):
            result.add(max(1, old - 1))
        elif line.startswith(' '):
            old += 1
    return result


def collect():
    from notebook_helpers import validate_rows
    output = ROOT / 'public_data'
    output.mkdir(exist_ok=True)
    all_rows, manifest = [], {'label_policy': 'weak_patch_overlap_v1', 'repositories': [], 'skipped': []}
    for repo in REPOS:
        print('Collecting', repo, flush=True)
        try:
            pulls = fetch(f'https://api.github.com/repos/{repo}/pulls?state=closed&per_page=40', True)
            eligible = [p for p in pulls if p.get('merged_at') and not p['user']['login'].endswith('[bot]')
                        and not re.search(r'\b(bump|deps|dependency|docs|chore|ci)\b', p['title'], re.I)]
            count = 0
            for pull in eligible[:4]:
                base = pull['base']['sha']
                license_text, license_path = '', ''
                for name in ('LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE.rst'):
                    try:
                        license_text = fetch(f'https://raw.githubusercontent.com/{repo}/{base}/{name}')
                        license_path = name
                        break
                    except urllib.error.HTTPError as error:
                        if error.code != 404:
                            raise
                if not any(term in license_text.lower() for term in
                           ('permission is hereby granted', 'apache license', 'redistribution and use in source and binary forms')):
                    manifest['skipped'].append({'repo': repo, 'reason': 'Unrecognized permissive root license'})
                    break
                license_file = repo.replace('/', '__') + '__' + base + '.txt'
                (output / license_file).write_text(license_text, encoding='utf-8')
                files = fetch(pull['url'] + '/files?per_page=100', True)
                candidates = []
                for item in files[:20]:
                    path = item['filename']
                    if not path.endswith(('.py', '.js', '.ts', '.tsx', '.jsx')) or item['status'] == 'added':
                        continue
                    if re.search(r'(^|/)(tests?|fixtures|migrations|vendor|dist)(/|\.)', path):
                        continue
                    source = fetch(f'https://raw.githubusercontent.com/{repo}/{base}/{path}')
                    spdx = re.search(r'SPDX-License-Identifier:\s*([^\n*]+)', source)
                    if spdx and spdx.group(1).strip() not in ('MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'):
                        manifest['skipped'].append({'repo': repo, 'path': path, 'reason': 'Unsupported file SPDX license'})
                        continue
                    changed = changed_lines(item.get('patch', ''))
                    for start, end, content in units(source, path):
                        label = 2 if any(start <= n <= end for n in changed) else 0
                        candidates.append(dict(path=path, content=content, label=label,
                            candidate_id=f'{path}:{start}:{end}', source_start=start, source_end=end))
                # Unchanged units are weak negatives, not verified irrelevant context.
                positives = [c for c in candidates if c['label'] == 2][:6]
                negatives = [c for c in candidates if c['label'] == 0][:10]
                if not positives or not negatives or len(positives + negatives) < 4:
                    manifest['skipped'].append({'repo': repo, 'task': pull['number'],
                        'reason': 'Insufficient complete small changed/unchanged units; no truncation or invented labels'})
                    continue
                task = re.sub(r'https?://\S+|#\d+', '', pull['title']).strip()[:240]
                group = [dict(c, repo_id=repo, task_id=str(pull['number']), task=task,
                    role='source', label_source='weak_patch_overlap_v1', labels_verified=False,
                    source_commit=base, source_url=f'https://github.com/{repo}/blob/{base}/{c["path"]}',
                    task_url=pull['html_url'], license_file=license_file) for c in positives + negatives]
                # Apply the same leak scanner used by training, without weakening its checks.
                try:
                    validate_rows(group + [dict(r, repo_id='validation-placeholder-' + str(i))
                                           for i in range(2) for r in group])
                except ValueError as error:
                    manifest['skipped'].append({'repo': repo, 'task': pull['number'], 'reason': str(error)})
                    continue
                all_rows.extend(group)
                manifest['repositories'].append({'repo': repo, 'task': pull['number'], 'base_commit': base,
                    'license_file': license_file, 'license_path': license_path, 'candidates': len(group)})
                count += 1
                if count == 2:
                    break
        except (urllib.error.URLError, ValueError) as error:
            manifest['skipped'].append({'repo': repo, 'reason': str(error)})
        (output / 'candidates.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in all_rows), encoding='utf-8')
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    validate_rows(all_rows)
    print(f'Collected {len(all_rows)} candidates from {len(set(r["repo_id"] for r in all_rows))} repositories')


if __name__ == '__main__':
    collect()
