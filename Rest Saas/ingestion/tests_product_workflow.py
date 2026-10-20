import json

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from .context_packs import build_packs, token_estimate
from .models import IngestionContext, SavedHandoff
from .project_metadata import validation_commands
from .limits import reserve_job
from .models import IngestionJob
from .privacy import redact_text


def project(files):
    return {'codebase': {'key_files_by_role': {'source': [{'path': path, 'content': content} for path, content in files.items()]}}}


def test_jsx_components_and_next_ancestor_layouts_are_dependencies():
    raw = project({'web/src/app/invoices/page.tsx': 'import InvoiceForm from "../../components/InvoiceForm";\nexport default function InvoicePage() { return <InvoiceForm/>; }',
                   'web/src/components/InvoiceForm.tsx': 'export default function InvoiceForm() { return <input name="invoice"/>; }',
                   'web/src/app/layout.tsx': 'import {Session} from "../components/Session";\nexport default function Layout({children}) { return <Session>{children}</Session>; }',
                   'web/src/components/Session.tsx': 'export function Session({children}) { return <main>{children}</main>; }',
                   'web/src/middleware.ts': 'export function middleware(req) { return req; }',
                   'admin/app/layout.tsx': 'export default function UnrelatedAdmin() { return null; }'})
    output = build_packs(raw, {'task': 'Change invoice form', 'include_paths': ['web/src/app/invoices/page.tsx'], 'max_tokens': 8000})
    paths = {u['path'] for u in output['handoff']['code']}
    assert {'web/src/components/InvoiceForm.tsx', 'web/src/app/layout.tsx', 'web/src/components/Session.tsx', 'web/src/middleware.ts'} <= paths
    assert 'admin/app/layout.tsx' not in paths


def test_fastapi_mount_and_global_dependency_are_preserved():
    raw = project({'app/api/routes/invoices.py': 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.post("/invoices")\ndef create_invoice():\n    return {}',
                   'app/main.py': 'from fastapi import FastAPI, Depends\nfrom app.api.routes.invoices import router\nfrom app.security import authenticate\napp = FastAPI(dependencies=[Depends(authenticate)])\napp.include_router(router, prefix="/v1")',
                   'app/security.py': 'def authenticate():\n    return True'})
    output = build_packs(raw, {'task': 'Create invoice', 'max_tokens': 8000})
    text = json.dumps(output['handoff'])
    assert 'authenticate' in text and 'prefix=' in text and 'app/security.py' in text


def test_validation_commands_are_declared_scoped_bounded_and_not_run():
    raw = project({'package.json': json.dumps({'packageManager': 'pnpm@10.0', 'scripts': {'build': 'turbo build'}}),
                   'apps/web/package.json': json.dumps({'scripts': {'test': 'vitest', 'typecheck': 'tsc --noEmit'}}),
                   'apps/admin/package.json': json.dumps({'scripts': {'test': 'admin-test'}})})
    checks = validation_commands(raw, ['apps/web/src/page.tsx'])
    assert [c['command'] for c in checks['commands']] == ['pnpm run build', 'pnpm run typecheck', 'pnpm run test']
    assert not any(c['working_directory'] == 'apps/admin' for c in checks['commands'])
    assert checks['execution'].startswith('Not run')


def test_missing_explicit_contract_and_unparsed_source_cannot_look_complete():
    raw = project({'invoice.ts': 'export function createInvoice() { return 1; }'})
    assert build_packs(raw, {'task': 'Create invoice', 'include_paths': ['missing.ts']})['handoff']['status'] == 'incomplete'
    raw = project({'invoice.py': 'def create_invoice(:\n    pass'})
    result = build_packs(raw, {'task': 'Create invoice'})
    assert result['handoff']['status'] == 'incomplete'
    assert any('could not be parsed' in gap for gap in result['handoff']['context_gaps'])


def test_imported_runtime_dependencies_are_not_limited_to_framework_presets():
    raw = project({'invoice.ts': 'import Big from "big.js"; export const invoice = new Big(1);',
                   'package.json': '{"dependencies":{"big.js":"7.0.0","unrelated":"2.0.0"}}'})
    stack = build_packs(raw, {'task': 'Invoice'})['handoff']['stack']
    assert stack['runtime_dependencies']['big.js'] == '7.0.0'
    assert 'unrelated' not in stack['runtime_dependencies']


def test_quoted_credential_properties_are_redacted_without_changing_identifiers():
    source = '''const config = {"password": "private-password", 'api_key': 'private-api-key'}; const name = req.user.password;'''
    clean = redact_text(source)
    assert 'private-password' not in clean and 'private-api-key' not in clean
    assert 'req.user.password' in clean


@pytest.fixture
def api(settings):
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    from django.core.cache import cache
    cache.clear()
    client = APIClient()
    user = User.objects.create_user(username='workflow-owner')
    client.force_authenticate(user)
    return client, user


@pytest.mark.django_db
def test_import_authentication_and_total_byte_limit(api):
    client, _ = api
    files = [{'path': f'{i}.ts', 'content': 'x' * 125001} for i in range(16)]
    response = client.post('/api/ingestion/import/', {'project_name': 'Too large', 'files': files}, format='json')
    assert response.status_code == 400
    assert not IngestionContext.objects.exists()
    assert APIClient().post('/api/ingestion/import/', {}, format='json').status_code in (401, 403)


@pytest.mark.django_db
def test_build_reservations_bound_concurrency_and_import_capacity(api):
    client, user = api
    reserve_job(user, {})
    reserve_job(user, {})
    with pytest.raises(ValueError, match='already active'):
        reserve_job(user, {})
    IngestionContext.objects.bulk_create([IngestionContext(user=user, data={}) for _ in range(98)])
    with pytest.raises(ValueError, match='Snapshot limit reached'):
        reserve_job(user, {})
    response = client.post('/api/ingestion/import/', {'project_name': 'Over limit', 'files': [{'path': 'a.py', 'content': 'pass'}]}, format='json')
    assert response.status_code == 409
    assert IngestionContext.objects.count() == 98


@pytest.mark.django_db
def test_saved_handoff_limit_never_evicts_private_history(api):
    client, user = api
    snapshot = IngestionContext.objects.create(user=user, data=project({'invoice.ts': 'export const invoice = 1;'}))
    SavedHandoff.objects.bulk_create([SavedHandoff(context=snapshot, title='Saved', request_data={}, output={}, digest=f'{i:064d}') for i in range(30)])
    response = client.post(f'/api/ingestion/{snapshot.id}/handoffs/', {'task': 'Change invoice'}, format='json')
    assert response.status_code == 409
    assert SavedHandoff.objects.count() == 30


@pytest.mark.django_db
def test_folder_import_redacts_before_storage_and_generates_context_without_worker(api):
    client, user = api
    result = client.post('/api/ingestion/import/', {'project_name': 'Local billing', 'files': [
        {'path': 'src/invoice.ts', 'content': 'export function createInvoice() { const password = "private-value"; return 1; }'},
        {'path': 'package.json', 'content': '{"scripts":{"test":"vitest run"},"dependencies":{"express":"5"}}'}]}, format='json')
    assert result.status_code == 201, result.data
    snapshot = IngestionContext.objects.get(pk=result.data['id'], user=user)
    assert 'private-value' not in json.dumps(snapshot.data)
    assert result.data['redacted_paths'] == ['src/invoice.ts']
    response = client.post(f'/api/ingestion/{snapshot.id}/context-pack/', {'task': 'Create invoice'}, format='json')
    assert response.status_code == 200
    assert response.data['handoff']['source']['kind'] == 'folder'
    assert response.data['handoff']['source']['content_sha256']
    assert response.data['handoff']['validation']['commands'][0]['command'] == 'npm run test'
    assert token_estimate(response.data['handoff']) <= 4000
    library = client.get('/api/ingestion/').data
    assert len(library) == 1
    assert library[0]['summary']['repository'] == 'Local billing'
    assert library[0]['sources']['codebase'] is True
    assert 'key_files_by_role' not in json.dumps(library, default=str)


@pytest.mark.django_db
@pytest.mark.parametrize('files', [
    [{'path': '../escape.ts', 'content': 'x'}], [{'path': '.env', 'content': 'SECRET=x'}],
    [{'path': 'node_modules/lib/a.js', 'content': 'x'}], [{'path': 'a.ts', 'content': 'x' * 128001}],
    [{'path': 'a.ts', 'content': '\x00'}], [{'path': 'a.ts', 'content': 'x'}, {'path': 'A.ts', 'content': 'x'}],
    [{'path': 'package.json', 'content': '{}'}], [{'path': 'a.ts', 'content': 'é' * 65000}],
])
def test_import_rejects_unsafe_oversized_duplicate_or_binary_files(api, files):
    client, _ = api
    response = client.post('/api/ingestion/import/', {'project_name': 'Invalid', 'files': files}, format='json')
    assert response.status_code == 400
    assert not IngestionContext.objects.exists()


@pytest.mark.django_db
def test_saved_handoff_is_private_deduplicated_immutable_and_deletable(api):
    client, owner = api
    snapshot = IngestionContext.objects.create(user=owner, data=project({'invoice.ts': 'export function createInvoice() { return 1; }'}))
    root = f'/api/ingestion/{snapshot.id}/handoffs/'
    saved = client.post(root, {'task': 'Create invoice'}, format='json')
    assert saved.status_code == 201, saved.data
    assert saved['Cache-Control'] == 'no-store'
    repeat = client.post(root, {'task': 'Create invoice'}, format='json')
    assert repeat.data['id'] == saved.data['id']
    assert SavedHandoff.objects.count() == 1
    item = root + saved.data['id'] + '/'
    outcome = client.patch(item, {'outcome': 'needed_context', 'feedback': 'Missing InvoiceStatus enum'}, format='json')
    assert outcome.status_code == 200
    assert client.get(item).data['output'] == saved.data['output']
    assert client.patch(item, {'outcome': 'certified'}, format='json').status_code == 400
    client.force_authenticate(User.objects.create_user(username='different-owner'))
    assert client.get(root).status_code == 404
    assert client.get(item).status_code == 404
    assert client.patch(item, {'outcome': 'worked'}, format='json').status_code == 404
    assert client.delete(item).status_code == 404
    assert client.delete(f'/api/ingestion/{snapshot.id}/').status_code == 404
    client.force_authenticate(owner)
    assert client.delete(f'/api/ingestion/{snapshot.id}/').status_code == 204
    assert not SavedHandoff.objects.exists()
