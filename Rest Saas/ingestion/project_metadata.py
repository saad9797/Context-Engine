"""Read declared project metadata; never run a project's scripts or imports."""
import json
import posixpath
import re

from .privacy import redact_text

MANIFEST = re.compile(r'(?:^|/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Gemfile|composer\.json|Cargo\.toml|[^/]+\.csproj|pom\.xml)$', re.I)


def manifests(raw):
    found = {}
    codebase = raw.get('codebase') or {}
    for group in (codebase.get('key_files_by_role') or {}).values():
        for item in group:
            if MANIFEST.search(item.get('path', '')) and isinstance(item.get('content'), str):
                found[item['path']] = item['content']
    stack = codebase.get('stack') or {}
    if 'package.json' not in found and isinstance(stack.get('package_json'), dict):
        found['package.json'] = json.dumps(stack['package_json'])
    for key, path in [('requirements_txt', 'requirements.txt'), ('pyproject_toml', 'pyproject.toml'), ('go_mod', 'go.mod'), ('gemfile', 'Gemfile')]:
        if path not in found and isinstance(stack.get(key), str) and stack[key]:
            found[path] = stack[key]
    return found


def validation_commands(raw, selected_paths=()):
    """Only declared npm scripts. No invented tools or shell execution."""
    commands = []
    files = manifests(raw)
    # In monorepos retain the closest manifest and the workspace root.
    eligible = {'package.json'}
    for path in selected_paths:
        parents = [p for p in files if p.endswith('package.json') and (not posixpath.dirname(p) or path.startswith(posixpath.dirname(p) + '/'))]
        if parents:
            eligible.add(max(parents, key=len))
    for path in sorted(eligible, key=lambda p: (p.count('/'), p)):
        try:
            package = json.loads(files.get(path, '{}'))
        except (ValueError, TypeError):
            continue
        if not isinstance(package, dict):
            continue
        scripts = package.get('scripts')
        if not isinstance(scripts, dict):
            continue
        manager_name = package.get('packageManager')
        if not manager_name:
            for ancestor in sorted((p for p in files if p.endswith('package.json') and p != path and (not posixpath.dirname(p) or path.startswith(posixpath.dirname(p) + '/'))), key=len, reverse=True):
                try:
                    manager_name = json.loads(files[ancestor]).get('packageManager')
                except (ValueError, TypeError, AttributeError):
                    continue
                if manager_name:
                    break
        manager = str(manager_name or 'npm').split('@')[0]
        if manager not in {'npm', 'pnpm', 'yarn', 'bun'}:
            manager = 'npm'
        for name in ('typecheck', 'type-check', 'check', 'lint', 'test', 'build'):
            script = scripts.get(name)
            if not isinstance(script, str) or len(script) > 500 or redact_text(script) != script:
                continue
            commands.append({'command': f'{manager} run {name}', 'working_directory': posixpath.dirname(path) or '.', 'declared_in': path, 'script': script})
    return {'commands': commands[:12], 'execution': 'Not run. Review project scripts before executing; test scripts may require services or watch mode.',
            'missing': [] if commands else ['No validation scripts captured. Ask the developer for the build, typecheck and test commands.']}
