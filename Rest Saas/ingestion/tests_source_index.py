import json
from unittest.mock import patch

import pytest

from .context_benchmark import evaluate, scenarios
from .context_packs import build_packs, source_files, token_estimate
from .source_index import SourceIndex, _parse_js


def raw(files):
    return {'codebase': {'key_files_by_role': {'source': [{'path': p, 'content': c} for p, c in files.items()]}}}


def test_known_answer_contracts_in_generic_large_modules():
    report = evaluate(build_packs)
    assert report['all_contracts_present'], report
    for case in scenarios():
        output = build_packs(case['raw'], {k: case[k] for k in ('task', 'endpoints', 'access', 'rules', 'response_shape')})
        handoff = output['handoff']
        text = '\n'.join(u['content'] for section in ('models', 'code') for u in handoff[section])
        assert all(marker in text for marker in case['required'])
        assert all(marker not in text for marker in case['forbidden'])
        assert token_estimate(handoff) <= 4000
        assert handoff['status'] == 'review'
        assert not output['report']['dependency_gaps']


def test_exact_symbol_followup_in_large_file_preserves_export_and_imports():
    content = 'import {authorize} from "./auth";\nexport const unrelated = "' + 'x' * 7000 + '";\nexport function submitInvoice() { return authorize(); }'
    project = raw({'src/index.ts': content, 'src/auth.ts': 'export function authorize() { return true; }'})
    output = build_packs(project, {'task': 'Change a workflow', 'include_symbols': ['src/index.ts#submitInvoice'], 'max_tokens': 2000})
    code = output['handoff']['code']
    target = next(u for u in code if 'submitInvoice' in u.get('symbols', []))
    assert target['content'] == 'export function submitInvoice() { return authorize(); }'
    assert target['imports'] == ['import {authorize} from "./auth";']
    assert any('function authorize' in u['content'] for u in code)
    assert 'x' * 7000 not in json.dumps(output['handoff'])


def test_missing_local_import_cannot_look_complete():
    output = build_packs(raw({'billing/invoice.py': 'from .permissions import BillingStaff\ndef create_invoice():\n    return BillingStaff()'}), {'task': 'Create invoice'})
    assert output['handoff']['status'] == 'incomplete'
    assert output['report']['dependency_gaps'][0]['module'] == '.permissions'
    assert any('Unresolved local imports' in gap for gap in output['handoff']['context_gaps'])
    assert output['handoff']['follow_up'][0]['path'] == 'billing/invoice.py'


def test_oversized_dependency_is_explicit_and_units_never_cut():
    project = raw({'src/invoice.ts': 'import {validateInvoice} from "./validation";\nexport function createInvoice() { return validateInvoice(); }',
                   'src/validation.ts': 'export function validateInvoice() { return "' + 'q' * 12000 + '"; }'})
    output = build_packs(project, {'task': 'Create invoice', 'max_tokens': 2000})
    assert output['handoff']['status'] == 'incomplete'
    assert any(g['path'] == 'src/validation.ts' for g in output['report']['handoff_omitted'])
    assert token_estimate(output['handoff']) <= 2000
    assert all('validateInvoice() { return "' not in u['content'] for u in output['handoff']['code'])


def test_cycle_and_barrel_resolution_terminate():
    project = raw({'src/invoice.ts': 'import {authorize} from "./barrel";\nexport function createInvoice() { return authorize(); }',
                   'src/barrel.ts': 'export {authorize} from "./auth";',
                   'src/auth.ts': 'import {createInvoice} from "./invoice";\nexport function authorize() { return createInvoice; }'})
    output = build_packs(project, {'task': 'Create invoice'})
    assert len(output['handoff']['code']) == 3
    assert not output['report']['dependency_gaps']


def test_parser_failure_is_reported_and_never_executes_customer_code():
    _parse_js.cache_clear()
    project = raw({'src/invoice.ts': 'export function createInvoice() { throw Error("must never execute"); }'})
    with patch('ingestion.source_index.subprocess.run', side_effect=OSError('node missing')):
        output = build_packs(project, {'task': 'Create invoice'})
    assert output['handoff']['code'][0]['content'] == project['codebase']['key_files_by_role']['source'][0]['content']
    assert any('No dedicated static parser' in gap for gap in output['report']['missing'])
    _parse_js.cache_clear()


def test_python_relative_module_and_same_file_constant_dependencies():
    files = source_files(raw({'billing/views.py': 'from . import permissions\nDEFAULT_STATUS = "draft"\n' + '\n'.join(f'def unrelated_{i}():\n    return {i}' for i in range(100)) + '\ndef create_invoice():\n    return permissions.BillingStaff(DEFAULT_STATUS)',
        'billing/permissions.py': 'class BillingStaff:\n    pass'}))[0]
    index = SourceIndex(files)
    selected, _, _ = index.select({'task': 'Create invoice'})
    text = '\n'.join(index.units[u]['content'] for u in selected)
    assert 'DEFAULT_STATUS = "draft"' in text
    assert 'class BillingStaff' in text


def test_unknown_symbols_are_visible_and_unknown_tasks_do_not_dump_source():
    output = build_packs(raw({'src/invoice.ts': 'export function createInvoice() { return true; }'}), {'task': 'Quantum teleportation', 'include_symbols': ['MissingType']})
    assert not output['handoff']['code']
    assert any('MissingType' in gap for gap in output['handoff']['context_gaps'])
    assert output['handoff']['status'] == 'incomplete'


def test_monorepo_aliases_use_the_nearest_package_config():
    files = source_files(raw({
        'apps/a/tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
        'apps/b/tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
        'apps/a/src/invoice.ts': 'import {format} from "@/format"; export function invoice() { return format(); }',
        'apps/a/src/format.ts': 'export function format() { return "A"; }',
        'apps/b/src/format.ts': 'export function format() { return "B"; }',
    }))[0]
    index = SourceIndex(files)
    assert index.resolve('apps/a/src/invoice.ts', '@/format')[0] == 'apps/a/src/format.ts'


def test_namespace_barrels_do_not_pull_sibling_controllers():
    project = raw({'src/handlers/index.ts': 'export {default as createInvoice} from "./create"; export {default as deleteInvoice} from "./delete";',
        'src/handlers/create.ts': 'export default function createInvoice() { return true; }',
        'src/handlers/delete.ts': 'export default function deleteInvoice() { return false; }',
        'src/routes.ts': 'import * as handlers from "./handlers"; const router = Router();\nrouter.post("/invoices", handlers.createInvoice);\nrouter.delete("/invoices", handlers.deleteInvoice);\nexport default router;'})
    output = build_packs(project, {'task': 'Improve invoice creation', 'endpoints': 'POST /invoices'})
    source = '\n'.join(u['content'] for u in output['handoff']['code'])
    assert 'function createInvoice' in source
    assert 'function deleteInvoice' not in source
    assert 'router.post' in source
    assert 'router.delete' not in source


def test_request_budget_suggestion_restores_omitted_contracts():
    project = raw({'src/invoice.ts': 'import {validateInvoice} from "./validation"; export function createInvoice() { return validateInvoice(); }',
        'src/validation.ts': 'export function validateInvoice() { return "' + 'x' * 7000 + '"; }'})
    first = build_packs(project, {'task': 'Create invoice', 'max_tokens': 2000})
    assert first['handoff']['status'] == 'incomplete'
    suggested = first['report']['suggested_handoff_budget']
    second = build_packs(project, {'task': 'Create invoice', 'max_tokens': suggested})
    assert second['handoff']['status'] == 'review'
    assert not second['report']['handoff_omitted']
    assert token_estimate(second['handoff']) <= suggested


def test_sql_table_and_large_enum_are_atomic_under_one_copy_budget():
    project = {'database': {'tables': [{'name': 'invoices', 'columns': [{'name': 'status', 'type': 'USER-DEFINED', 'udt': 'InvoiceStatus'}]}],
                            'enums': [{'name': 'InvoiceStatus', 'values': ['LONG_VALUE_' + str(i) for i in range(600)]}]}}
    output = build_packs(project, {'task': 'Change invoices', 'max_tokens': 2000})
    assert output['handoff']['database'] == []
    assert output['handoff']['enums'] == []
    assert output['handoff']['status'] == 'incomplete'
    assert output['report']['handoff_omitted']


def test_duplicate_prisma_names_require_schema_disambiguation():
    project = raw({'apps/a/schema.prisma': 'model Invoice {\n id Int @id\n total Int\n}',
                   'apps/b/schema.prisma': 'model Invoice {\n uuid String @id\n amount Decimal\n}'})
    ambiguous = build_packs(project, {'task': 'Update invoice'})
    assert ambiguous['handoff']['status'] == 'incomplete'
    assert ambiguous['handoff']['models'] == []
    assert any('Ambiguous ORM names' in gap for gap in ambiguous['handoff']['context_gaps'])
    resolved = build_packs(project, {'task': 'Update invoice', 'include_paths': ['apps/a/schema.prisma']})
    assert resolved['handoff']['status'] == 'review'
    assert [m['path'] for m in resolved['handoff']['models']] == ['apps/a/schema.prisma']


def test_python_package_initializers_do_not_hide_submodule_dependencies():
    files = source_files(raw({'billing/__init__.py': '',
        'billing/views.py': 'from . import permissions\nfrom billing.contracts import Invoice\ndef create_invoice():\n    return permissions.BillingStaff(Invoice())',
        'billing/permissions.py': 'class BillingStaff:\n    pass',
        'billing/contracts/__init__.py': 'from .invoice import Invoice',
        'billing/contracts/invoice.py': 'class Invoice:\n    pass'}))[0]
    index = SourceIndex(files)
    selected, _, _ = index.select({'task': 'Create invoice'})
    view = next(uid for uid in selected if index.units[uid]['path'] == 'billing/views.py')
    paths = {index.units[dep]['path'] for dep in index.edges[view]}
    assert 'billing/permissions.py' in paths
    assert 'billing/contracts/invoice.py' in paths
    assert not index.unresolved[view]
