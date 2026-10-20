"""Bounded static source index. Customer code is never imported or executed."""
import ast
from collections import Counter, defaultdict, deque
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import posixpath
import re
import subprocess

PARSER = Path(__file__).parent / 'ingestion-engine/src/source-units.js'
JS = re.compile(r'\.[cm]?[jt]sx?$')
WORDS = re.compile(r'[A-Za-z][A-Za-z0-9]*')
GENERIC = set('the a an to for of and or in on with add create build update delete get api endpoint controller route model service implement please new existing using from this that task use change fix support function const export import return async await class def self req res request response'.split())


def words(value):
    value = re.sub(r'([a-z])([A-Z])', r'\1 \2', value)
    return [w.removesuffix('s') for w in WORDS.findall(value.lower()) if len(w) > 2 and w not in GENERIC]


def python_units(path, content):
    try:
        tree = ast.parse(content)
    except (SyntaxError, RecursionError, ValueError):
        # A newer Python grammar can still have ordinary import statements.
        # Keep complete source and conservatively trace those imports, while
        # explicitly reporting that semantic parsing was unavailable.
        imports = []
        for line in content.splitlines():
            if not re.match(r'^(?:from\s+|import\s+)', line):
                continue
            try:
                statement = ast.parse(line).body[0]
            except (SyntaxError, ValueError):
                continue
            if isinstance(statement, ast.ImportFrom):
                imports.append(dict(module='.' * statement.level + (statement.module or ''), bindings=[dict(local=a.asname or a.name, imported=a.name) for a in statement.names], content=line, side_effect=False))
            elif isinstance(statement, ast.Import):
                for alias in statement.names:
                    imports.append(dict(module=alias.name, bindings=[dict(local=alias.asname or alias.name.split('.')[0], imported='*')], content=line, side_effect=False))
        symbols = re.findall(r'^(?:class\s+|(?:async\s+)?def\s+)(\w+)|^(\w+)\s*(?::[^=\n]+)?=', content, re.M)
        unit = dict(start_line=1, end_line=max(1, len(content.splitlines())), content=content, symbols=sorted({s for pair in symbols for s in pair if s}), refs=sorted(set(WORDS.findall(content))), whole_file=True)
        return dict(path=path, imports=imports, units=[unit], parse_error='Python syntax could not be parsed; complete-file and conservative import fallback used. Review dependencies.')
    lines, imports, units = content.splitlines(keepends=True), [], []
    for node in tree.body:
        text = ''.join(lines[node.lineno - 1:node.end_lineno])
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom):
                imports.append(dict(module='.' * node.level + (node.module or ''),
                    bindings=[dict(local=a.asname or a.name, imported=a.name) for a in node.names], content=text, side_effect=False))
            else:
                for alias in node.names:
                    imports.append(dict(module=alias.name, bindings=[dict(local=alias.asname or alias.name.split('.')[0], imported='*')], content=text, side_effect=False))
            continue
        start = min([node.lineno] + [d.lineno for d in getattr(node, 'decorator_list', [])])
        symbols = [node.name] if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else []
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            symbols = [n.id for target in targets for n in ast.walk(target) if isinstance(n, ast.Name)]
        refs = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
        # Module attribute uses help follow `import permissions; permissions.BillingStaff`.
        refs.update(n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute))
        members = defaultdict(list)
        for n in ast.walk(node):
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name):
                members[n.value.id].append(n.attr)
        units.append(dict(start_line=start, end_line=node.end_lineno,
            content=''.join(lines[start - 1:node.end_lineno]), symbols=symbols, refs=sorted(refs), members=dict(members)))
    return dict(path=path, imports=imports, units=units)


@lru_cache(maxsize=3)
def _parse_js(payload):
    try:
        process = subprocess.run(['node', '--max-old-space-size=256', str(PARSER)], input=payload, capture_output=True,
            encoding='utf-8', timeout=15, check=True)
        if len(process.stdout.encode()) > 8 * 1024 * 1024:
            raise ValueError('Index response limit')
        return json.loads(process.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


class SourceIndex:
    def __init__(self, files):
        self.files, self.units, self.by_path, self.by_symbol = files, {}, defaultdict(list), defaultdict(list)
        self.local_symbols = defaultdict(lambda: defaultdict(set))
        self.modules, self.warnings, self.edges, self.unresolved = {}, {}, defaultdict(set), defaultdict(set)
        self.aliases = []
        for path, file in files.items():
            if re.search(r'(^|/)tsconfig[^/]*\.json$', path):
                try:
                    # JSONC comments are accepted; do not strip // inside strings.
                    text = re.sub(r'("(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*)', lambda m: m[0] if m[0].startswith('"') else '', file['content'])
                    config = json.loads(re.sub(r',\s*([}\]])', r'\1', text)).get('compilerOptions', {})
                    root = posixpath.normpath(posixpath.join(posixpath.dirname(path), config.get('baseUrl', '.')))
                    for alias, targets in config.get('paths', {}).items():
                        if isinstance(targets, list):
                            self.aliases.append((alias, [posixpath.normpath(posixpath.join(root, t)) for t in targets if isinstance(t, str)], posixpath.dirname(path)))
                except (ValueError, TypeError, AttributeError):
                    self.warnings[path] = 'tsconfig aliases could not be parsed; pin unresolved files.'
        js = [{'path': p, 'content': f['content']} for p, f in files.items() if JS.search(p)]
        parsed = {p['path']: p for p in _parse_js(json.dumps(js, ensure_ascii=False))} if js else {}
        for path, file in files.items():
            if path.endswith(('.prisma', '.json')):
                continue
            data = python_units(path, file['content']) if path.endswith('.py') else parsed.get(path)
            if data is None:
                data = dict(path=path, imports=[], units=[], parse_error='No dedicated static parser; whole-file fallback used.')
            self.modules[path] = data
            if data.get('parse_error'):
                self.warnings[path] = data['parse_error']
            definitions = data['units']
            if len(definitions) > 1500:
                self.warnings[path] = 'Module exceeds the 1500-declaration index limit; whole-file fallback used.'
                definitions = [dict(start_line=1, end_line=max(1, len(file['content'].splitlines())),
                    content=file['content'], symbols=sorted({s for u in definitions for s in u['symbols']}),
                    refs=sorted({r for u in definitions for r in u['refs']}), whole_file=True)]
            # Small files stay byte-for-byte complete. Large files keep complete
            # top-level declarations/statements, preserving decorators and classes.
            route_statements = sum(bool(re.search(r'\.(?:get|post|put|delete|patch|use|include_router)\s*\(', u['content'])) for u in definitions)
            if len(file['content'].encode()) <= 2400 and route_statements < 2 and not path.endswith('settings.py') or not definitions:
                definitions = [dict(start_line=1, end_line=max(1, len(file['content'].splitlines())),
                    content=file['content'], symbols=sorted({s for u in definitions for s in u['symbols']}),
                    refs=sorted({r for u in definitions for r in u['refs']}),
                    members={local: sorted({member for u in definitions for member in u.get('members', {}).get(local, [])}) for local in {key for u in definitions for key in u.get('members', {})}}, whole_file=True)]
            for u in definitions:
                uid = f'{path}#{u["start_line"]}:{u["end_line"]}'
                unit = dict(u, path=path, id=uid, sha=file.get('sha'), redacted=file.get('redacted', False))
                if not u.get('whole_file'):
                    unit['imports'] = list(dict.fromkeys(i['content'] for i in data['imports']
                        if i.get('side_effect') or any(b['local'] in u['refs'] for b in i['bindings'])))
                self.units[uid] = unit
                self.by_path[path].append(uid)
                for symbol in u['symbols']:
                    self.by_symbol[symbol].append(uid)
                    self.local_symbols[path][symbol].add(uid)
        for uid, unit in self.units.items():
            path, refs = unit['path'], set(unit['refs'])
            for name in refs:
                self.edges[uid].update(self.local_symbols[path].get(name, ()))
            self.edges[uid].discard(uid)
            for imp in self.modules[path]['imports']:
                wanted = [b for b in imp['bindings'] if b['local'] in refs]
                if imp.get('reexport'):
                    # A barrel is reference data; consumers follow only the
                    # particular export they use rather than every sibling.
                    continue
                if not wanted and not imp.get('side_effect'):
                    continue
                target, local = self.resolve(path, imp['module'])
                if not target and path.endswith('.py') and imp['module'].endswith('.'):
                    for binding in wanted:
                        child, _ = self.resolve(path, imp['module'] + binding['imported'])
                        if child:
                            self.edges[uid].update(self.by_path[child])
                    if self.edges[uid] and wanted:
                        continue
                if not target:
                    if local:
                        self.unresolved[uid].add(imp['module'])
                    continue
                targets = self.by_path[target]
                if imp.get('side_effect') or imp.get('reexport'):
                    self.edges[uid].update(targets)
                for binding in wanted:
                    symbol = binding['imported']
                    if path.endswith('.py') and target.endswith('/__init__.py'):
                        child_module = imp['module'] + ('' if imp['module'].endswith('.') else '.') + symbol
                        child, _ = self.resolve(path, child_module)
                        if child:
                            attributes = unit.get('members', {}).get(binding['local'], [])
                            child_units = set()
                            for attribute in attributes:
                                child_units.update(self.exported_units(child, attribute))
                            self.edges[uid].update(child_units or self.by_path[child])
                            continue
                    requested = unit.get('members', {}).get(binding['local'], []) if symbol == '*' else [symbol]
                    matches = set()
                    for exported in requested:
                        matches.update(self.exported_units(target, exported))
                    if not requested and symbol == '*':
                        matches.update(targets)
                    if not matches and len(targets) == 1 and not self.modules[target]['units']:
                        matches.update(targets)
                    if matches:
                        self.edges[uid].update(matches)
                    else:
                        self.unresolved[uid].add(f'{imp["module"]}#{symbol}')

    def exported_units(self, path, symbol, seen=None):
        seen = set() if seen is None else seen
        if (path, symbol) in seen:
            return set()
        seen.add((path, symbol))
        matches = {uid for uid in self.by_path[path] if symbol in self.units[uid]['symbols']}
        for imp in self.modules[path]['imports']:
            if not imp.get('reexport') and not path.endswith('/__init__.py'):
                continue
            exports = [b['imported'] for b in imp['bindings'] if b['local'] == symbol]
            if not imp['bindings'] or any(b['local'] == '*' and b['imported'] == '*' for b in imp['bindings']):
                exports = [symbol]
            for exported in exports:
                target, _ = self.resolve(path, imp['module'])
                if target:
                    resolved = self.exported_units(target, exported, seen)
                    if resolved:
                        matches.update(resolved)
                        matches.update(self.by_path[path])
        return matches

    def resolve(self, path, module):
        candidates, local = [], module.startswith(('.', '@/', '~/', 'src/'))
        if path.endswith('.py'):
            level = len(module) - len(module.lstrip('.'))
            prefix = posixpath.dirname(path) if level else ''
            for _ in range(max(0, level - 1)):
                prefix = posixpath.dirname(prefix)
            stem = posixpath.join(prefix, module.lstrip('.').replace('.', '/'))
            candidates = [stem + '.py', stem + '/__init__.py']
            matches = [p for p in self.files if p.endswith(('/' + stem + '.py', '/' + stem + '/__init__.py'))]
            if not level and matches:
                # Resolve absolute imports inside a nested backend/package,
                # choosing its closest captured project root in a monorepo.
                distances = {p: len(posixpath.commonpath([path, p])) for p in matches}
                best = max(distances.values())
                nearest = [p for p in matches if distances[p] == best]
                if len(nearest) == 1:
                    candidates = nearest + candidates
            package = module.split('.')[0] + '/'
            local = bool(level) or bool(matches) or any(p.startswith(package) or '/' + package in p for p in self.files)
        else:
            stems = []
            if module.startswith('.'):
                stems.append(posixpath.normpath(posixpath.join(posixpath.dirname(path), module)))
            for alias, targets, directory in sorted(self.aliases, key=lambda item: -len(item[2])):
                if directory and not path.startswith(directory + '/'):
                    continue
                pattern = '^' + re.escape(alias).replace(r'\*', '(.*)') + '$'
                match = re.match(pattern, module)
                if match:
                    local = True
                    stems.extend(t.replace('*', match[1] if match.lastindex else '') for t in targets)
                    break
            if not stems and module.startswith(('@/', '~/', 'src/')):
                suffix = re.sub(r'^[@~]/', '', module)
                matches = [p.rsplit('.', 1)[0] for p in self.files if p.rsplit('.', 1)[0].endswith('/' + suffix)]
                if len(matches) == 1:
                    stems.extend(matches)
            for stem in stems:
                for base in (stem, re.sub(r'\.[cm]?js$', '', stem)):
                    candidates.extend(base + ext for ext in ('', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js'))
        matches = list(dict.fromkeys(c for c in candidates if c in self.by_path))
        return (matches[0] if matches else None), local

    def select(self, task, pinned=(), symbols=()):
        query = words(' '.join(task.values()))
        primary = set(words(task.get('task', '') + ' ' + task.get('endpoints', '')))
        intent_text = task.get('task', '').lower()
        actions = set()
        for action, pattern in (('create', r'\bcreat(?:e|ing|ion)\b'), ('update', r'\b(?:updat\w*|edit\w*)\b'),
                                ('delete', r'\b(?:delet\w*|remov\w*)\b'), ('list', r'\b(?:list\w*|paginat\w*)\b'),
                                ('login', r'\blog\s?in\b'), ('register', r'\bregister\w*\b')):
            if re.search(pattern, intent_text):
                actions.add(action)
        methods = set(re.findall(r'\b(POST|PUT|PATCH|DELETE)\s+/', task.get('endpoints', '').upper()))
        if len(methods) == 1 and not actions.intersection({'login', 'register'}):
            actions = {{'POST': 'create', 'PUT': 'update', 'PATCH': 'update', 'DELETE': 'delete'}[next(iter(methods))]}
        documents = {uid: Counter(words(' '.join(u['symbols']) + ' ' + u['content'])) for uid, u in self.units.items()}
        frequency = Counter(w for doc in documents.values() for w in doc)
        avg = sum(sum(d.values()) for d in documents.values()) / max(1, len(documents))
        ranking = []
        for uid, doc in documents.items():
            u, score = self.units[uid], 0.0
            symbols_hit = primary.intersection(words(' '.join(u['symbols'])))
            path_hit = primary.intersection(words(u['path']))
            for word in set(query):
                count = doc[word]
                if count:
                    idf = math.log(1 + (len(documents) - frequency[word] + .5) / (frequency[word] + .5))
                    score += idf * count * 2.2 / (count + 1.2 * (.25 + .75 * sum(doc.values()) / max(1, avg)))
            score += len(symbols_hit) * 15 + len(path_hit) * 4
            if primary and (symbols_hit or primary.intersection(doc) or path_hit and u.get('whole_file')):
                strong = bool(symbols_hit or primary.intersection(words(' '.join(u['refs']))) or path_hit and u.get('whole_file'))
                identifier_tokens = set(WORDS.findall(re.sub(r'([a-z])([A-Z])', r'\1 \2', ' '.join(u['symbols'])).lower()))
                action_match = bool(actions.intersection(identifier_tokens))
                ranking.append((score + 12 * action_match, uid, strong, action_match))
        if any(row[2] for row in ranking):
            ranking = [row for row in ranking if row[2]]
        if any(row[3] for row in ranking):
            ranking = [row for row in ranking if row[3]]
        ranking.sort(key=lambda pair: (-pair[0], pair[1]))
        # An exact compound identifier in the request is a stronger scope
        # signal than its generic constituent words (FormInput vs every form).
        explicit_ids = {uid for uid, unit in self.units.items() if any(
            len(symbol) >= 6 and re.search(r'[a-z][A-Z]|_', symbol) and
            re.search(r'(?<![\w])' + re.escape(symbol) + r'(?![\w])', task.get('task', ''), re.I)
            for symbol in unit['symbols'])}
        if explicit_ids:
            ranking = [row for row in ranking if row[1] in explicit_ids]
        seeds, reasons = [], {}
        for path in pinned:
            for uid in self.by_path[path]:
                seeds.append(uid)
                reasons[uid] = 'explicitly requested file'
        for symbol in symbols:
            path, sep, name = symbol.partition('#')
            matches = self.by_symbol.get(name if sep else path, [])
            for uid in matches:
                if not sep or self.units[uid]['path'] == path:
                    seeds.append(uid)
                    reasons[uid] = 'explicitly requested symbol'
        # Limit entry points, not dependency closure. Avoid 350 unrelated
        # declarations winning merely because they share a matched filename.
        for _, uid, _, _ in ranking:
            if len([v for v in seeds if reasons[v] == 'task symbol or weighted lexical match']) >= 5:
                break
            if uid not in seeds:
                seeds.append(uid)
                reasons[uid] = 'task symbol or weighted lexical match'
        django_task = any(self.units[uid]['path'].endswith('.py') and any(imp['module'].startswith(('django', 'rest_framework')) for imp in self.modules[self.units[uid]['path']]['imports']) for uid in seeds)
        if django_task:
            for uid, unit in self.units.items():
                if unit['path'].endswith('settings.py') and set(unit['symbols']).intersection({'REST_FRAMEWORK', 'AUTH_USER_MODEL'}):
                    if uid not in seeds:
                        seeds.append(uid)
                        reasons[uid] = 'Django authentication and user-model configuration'
        # Next App Router loads ancestor layouts/templates by convention, not
        # by page imports. Scope these to the selected app root in monorepos.
        for selected in list(seeds):
            path = self.units[selected]['path']
            match = re.search(r'(^|/)(app)/(.*)/(?:page|route)\.[cm]?[jt]sx?$|(^|/)(app)/(?:page|route)\.[cm]?[jt]sx?$', path)
            if not match:
                continue
            app_root = path[:match.start()] + match.group(0).split('app/')[0] + 'app'
            parent = posixpath.dirname(path)
            implicit = []
            while parent == app_root or parent.startswith(app_root + '/'):
                implicit.extend(p for p in self.by_path if posixpath.dirname(p) == parent and re.search(r'/(?:layout|template)\.[cm]?[jt]sx?$', p))
                if parent == app_root:
                    break
                parent = posixpath.dirname(parent)
            project_root = posixpath.dirname(app_root)
            middleware_roots = {project_root}
            if posixpath.basename(project_root) == 'src':
                middleware_roots.add(posixpath.dirname(project_root))
            implicit.extend(p for p in self.by_path if posixpath.dirname(p) in middleware_roots and re.search(r'(?:^|/)(?:middleware|proxy)\.[cm]?[jt]s$', p))
            for dependency in sorted(set(implicit)):
                for uid in self.by_path[dependency]:
                    if uid not in seeds:
                        seeds.append(uid)
                        reasons[uid] = 'Next.js convention: ancestor layout/template or request middleware (review matcher)'
        # Trace callers back through route mounting without treating the shared
        # `router` variable as evidence that every sibling endpoint is relevant.
        seed_set, entry_paths = set(seeds), set()
        implementation_paths = {self.units[uid]['path'] for uid in seeds}
        for _ in range(4):
            added = []
            for uid, unit in self.units.items():
                if uid in seed_set or not re.search(r'route|urls\.py$|(?:^|/)(?:app|main|server|index)\.(?:[jt]s|py)$', unit['path'], re.I):
                    continue
                parent_mount = any(self.units[dep]['path'] != unit['path'] and self.units[dep]['path'] in entry_paths and ('default' in self.units[dep]['symbols'] or re.search(r'\.include_router\(', unit['content'])) for dep in self.edges[uid])
                framework_mount = bool(re.search(r'\.include_router\(', unit['content'])) and any(self.units[dep]['path'] in implementation_paths for dep in self.edges[uid])
                if self.edges[uid].intersection(seed_set) or parent_mount or framework_mount:
                    added.append(uid)
            if not added:
                break
            for uid in added:
                seeds.append(uid)
                seed_set.add(uid)
                entry_paths.add(self.units[uid]['path'])
                reasons[uid] = 'route or entry point referencing selected implementation'
        # Preserve global middleware around the selected mount: JSON parsing,
        # authentication and error handlers need not import the handler itself.
        for uid, unit in self.units.items():
            if unit['path'] in entry_paths and uid not in seeds and re.search(r'\b(?:app|router)\.use\(\s*[^\s\'"`]|\b(?:FastAPI|APIRouter)\(', unit['content']):
                seeds.append(uid)
                reasons[uid] = 'global middleware surrounding selected route mount'
        queue, selected = deque(seeds), []
        while queue and len(selected) < 180:
            uid = queue.popleft()
            if uid in selected:
                continue
            selected.append(uid)
            for dep in sorted(self.edges[uid]):
                if dep not in reasons:
                    reasons[dep] = f'required local dependency of {self.units[uid]["path"]}'
                queue.append(dep)
        return selected, reasons, list(dict.fromkeys(queue))

    def export(self, uid):
        unit = self.units[uid]
        result = {k: unit[k] for k in ('path', 'start_line', 'end_line', 'symbols', 'content', 'imports') if k in unit}
        result['scope'] = 'file' if unit.get('whole_file') else 'source_unit'
        if unit.get('redacted'):
            result['redacted'] = True
        return result
