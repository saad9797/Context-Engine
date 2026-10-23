import json
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from .context_packs import build_packs, token_estimate
from .models import ContextPreparation, IngestionContext, SourceVectorCache
from .vector_store import VectorStore
from .preparation import run_preparation, dispatch_preparation
from .semantic import fuse, semantic_rank
from rq.timeouts import JobTimeoutException


def source(files):
    return {'codebase': {'key_files_by_role': {'source': [
        {'path': path, 'content': content} for path, content in files.items()]}}}


def test_hybrid_fusion_rewards_agreement_without_overriding_pins():
    assert fuse(['exact', 'both'], ['both', 'semantic'])[0] == 'both'
    raw = source({'invoice.py': 'def create_invoice():\n    return 1',
                  'access.py': 'def tenant_scope():\n    return 2'})
    with patch('ingestion.source_index.semantic_rank', return_value=(['access.py#1:2'], {'mode': 'hybrid', 'status': 'ready'})):
        result = build_packs(raw, {'task': 'Create invoice', 'include_paths': ['invoice.py']})
    assert {'invoice.py', 'access.py'} <= {u['path'] for u in result['handoff']['code']}
    assert result['report']['retrieval']['status'] == 'ready'


def test_semantic_suggestions_do_not_displace_lexical_dependency_contracts():
    raw = source({'invoice.py': 'from security import tenant_scope\ndef create_invoice():\n    return tenant_scope()',
                  'security.py': 'def tenant_scope():\n    return 2',
                  'unrelated.py': 'def other_behavior():\n    return 3'})
    baseline = build_packs(raw, {'task': 'Create invoice'}, use_semantic=False)
    with patch('ingestion.source_index.semantic_rank', return_value=(['unrelated.py#1:2'], {'mode': 'hybrid', 'status': 'ready'})):
        hybrid = build_packs(raw, {'task': 'Create invoice'})
    assert {u['path'] for u in baseline['handoff']['code']} <= {u['path'] for u in hybrid['handoff']['code']}


def test_source_parser_handles_more_than_the_previous_220_file_limit():
    raw = source({f'part_{i}.ts': f'export function unique{i}() {{ return {i}; }}' for i in range(240)})
    result = build_packs(raw, {'task': 'Change unique239', 'include_paths': ['part_239.ts'], 'max_tokens': 3000}, use_semantic=False)
    assert result['report']['source_files_available'] == 240
    assert any(u['path'] == 'part_239.ts' for u in result['handoff']['code'])
    assert not any('No dedicated static parser' in text for text in result['report']['missing'])


def test_follow_up_finds_paths_and_symbols_preserves_original_task_and_budget():
    raw = source({'invoice.py': 'def create_invoice():\n    return 1',
                  'security.py': 'def tenant_scope():\n    return 2'})
    result = build_packs(raw, {'task': 'Create invoice', 'acceptance': 'Other tenants cannot read invoices',
                              'follow_up': 'Please show tenant_scope and security.py:2. Missing unknown.py',
                              'max_tokens': 3000})
    assert result['handoff']['request']['task'] == 'Create invoice'
    assert 'Other tenants' in result['handoff']['request']['acceptance']
    assert 'security.py' in {u['path'] for u in result['handoff']['code']}
    assert result['handoff']['status'] == 'incomplete'
    assert 'unknown.py' in result['report']['requested_paths']
    assert token_estimate(result['handoff']) <= 3000


def test_partial_capture_is_explicit_even_when_selected_contracts_fit():
    raw = source({'invoice.py': 'def create_invoice():\n    return 1'})
    raw['codebase'].update(key_files_truncated=True, capture={'complete_files': 1, 'candidate_files': 100})
    result = build_packs(raw, {'task': 'Create invoice'})
    assert result['handoff']['status'] == 'incomplete'
    assert result['report']['coverage']['candidate_files'] == 100
    assert any('capture is partial' in gap for gap in result['handoff']['context_gaps'])


def test_relevant_tests_are_preserved_without_running_them():
    raw = source({'billing/invoice.py': 'def calculate_invoice():\n    return 1',
                  'billing/tests/test_invoice.py': 'from billing.invoice import calculate_invoice\ndef test_total():\n    assert calculate_invoice() == 1'})
    result = build_packs(raw, {'task': 'Change invoice calculation'})
    assert 'billing/tests/test_invoice.py' in {u['path'] for u in result['handoff']['code']}


def test_missing_local_model_is_explicit_and_keeps_lexical_search(monkeypatch):
    monkeypatch.setenv('CONTEXA_SEMANTIC', '1')
    with patch('ingestion.semantic.load_model', side_effect=OSError('not provisioned')):
        ranked, report = semantic_rank({'x': {'path': 'x.py', 'symbols': [], 'content': 'pass'}}, 'Invoice')
    assert not ranked and report['status'] == 'unavailable' and report['mode'] == 'lexical'


def test_offline_worker_fails_fast_instead_of_stranding_a_preparation(settings):
    settings.INGESTION_EXECUTION_MODE = 'worker'
    with patch('django_rq.get_queue') as queue, patch('rq.Worker.all', return_value=[]):
        with pytest.raises(ValueError, match='offline or starting'):
            dispatch_preparation(type('Job', (), {'id': 'not-queued'})())
        queue.return_value.enqueue.assert_not_called()


def test_model_timeout_propagates_to_job_lifecycle(monkeypatch):
    monkeypatch.setenv('CONTEXA_SEMANTIC', '1')
    with patch('ingestion.semantic.load_model', side_effect=JobTimeoutException('expired')):
        with pytest.raises(JobTimeoutException):
            semantic_rank({'unit': {'path': 'x.py', 'symbols': [], 'content': 'pass'}}, 'Invoice')


@pytest.fixture
def api(settings, monkeypatch):
    monkeypatch.setenv('CONTEXA_SEMANTIC', '0')
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    from django.core.cache import cache
    cache.clear()
    owner = User.objects.create_user(username='preparation-owner')
    client = APIClient()
    client.force_authenticate(owner)
    snapshot = IngestionContext.objects.create(user=owner, data=source({'invoice.py': 'def create_invoice():\n    return 1'}))
    return client, owner, snapshot


@pytest.mark.django_db(transaction=True)
def test_async_preparation_polling_and_exact_saved_export(api):
    client, _, snapshot = api
    root = f'/api/ingestion/{snapshot.id}/prepare/'
    with patch('ingestion.views_context_packs.dispatch_preparation', side_effect=run_preparation_for_test):
        response = client.post(root, {'task': 'Create invoice', 'follow_up': 'Show invoice.py'}, format='json')
    assert response.status_code == 202
    preparation_id = response.data['preparation_id']
    response = client.get(root + preparation_id + '/')
    assert response.status_code == 200 and response.data['status'] == 'succeeded'
    assert response['Cache-Control'] == 'no-store'
    job = ContextPreparation.objects.get(pk=preparation_id)
    saved = client.post(f'/api/ingestion/{snapshot.id}/handoffs/',
                        {**job.request_data, 'preparation_id': preparation_id}, format='json')
    assert saved.status_code == 201
    assert saved.data['output'] == response.data['output']
    stale = client.post(f'/api/ingestion/{snapshot.id}/handoffs/',
                        {**job.request_data, 'task': 'Changed', 'preparation_id': preparation_id}, format='json')
    assert stale.status_code == 409


def run_preparation_for_test(job):
    run_preparation(str(job.id))


@pytest.mark.django_db(transaction=True)
def test_default_preparation_never_invokes_model_but_semantic_is_explicit(api, monkeypatch):
    client, _, snapshot = api
    monkeypatch.setenv('CONTEXA_SEMANTIC', '1')
    root = f'/api/ingestion/{snapshot.id}/prepare/'
    with patch('ingestion.views_context_packs.dispatch_preparation', side_effect=run_preparation_for_test), \
            patch('ingestion.source_index.semantic_rank', return_value=([], {'mode': 'lexical', 'status': 'unavailable'})) as semantic:
        response = client.post(root, {'task': 'Create invoice'}, format='json')
        job = ContextPreparation.objects.get(pk=response.data['preparation_id'])
        assert job.status == 'succeeded'
        assert job.output['report']['retrieval']['status'] == 'fast'
        assert any(u['path'] == 'invoice.py' for u in job.output['handoff']['code'])
        semantic.assert_not_called()
        response = client.post(root, {'task': 'Create invoice', 'retrieval_mode': 'semantic'}, format='json')
        job = ContextPreparation.objects.get(pk=response.data['preparation_id'])
        assert job.status == 'succeeded'
        semantic.assert_called_once()
    assert client.post(root, {'retrieval_mode': 'invalid'}, format='json').status_code == 400


@pytest.mark.django_db
def test_preparation_tenant_isolation_quota_expiry_and_snapshot_deletion(api):
    client, owner, snapshot = api
    other = User.objects.create_user(username='preparation-other')
    foreign = IngestionContext.objects.create(user=other, data={})
    foreign_job = ContextPreparation.objects.create(context=foreign)
    assert client.post(f'/api/ingestion/{foreign.id}/prepare/', {}, format='json').status_code == 404
    assert client.get(f'/api/ingestion/{foreign.id}/prepare/{foreign_job.id}/').status_code == 404
    jobs = [ContextPreparation.objects.create(context=snapshot) for _ in range(2)]
    assert client.post(f'/api/ingestion/{snapshot.id}/prepare/', {}, format='json').status_code == 409
    ContextPreparation.objects.filter(pk=jobs[0].pk).update(created_at=timezone.now() - timedelta(minutes=16))
    response = client.get(f'/api/ingestion/{snapshot.id}/prepare/{jobs[0].pk}/')
    assert response.data['status'] == 'failed'
    assert 'timed out' in response.data['error']
    ContextPreparation.objects.filter(pk=jobs[1].pk).update(status='running', created_at=timezone.now() - timedelta(minutes=20), updated_at=timezone.now())
    assert client.get(f'/api/ingestion/{snapshot.id}/prepare/{jobs[1].pk}/').data['status'] == 'running'
    snapshot.delete()
    assert not ContextPreparation.objects.filter(pk__in=[job.pk for job in jobs]).exists()


@pytest.mark.django_db
def test_persistent_vector_cache_roundtrip_scope_policy_and_corruption(api):
    client, owner, snapshot = api
    store = VectorStore(snapshot.id)
    vector = [0.0] * 768
    vector[0] = 1.0
    store.save(['hash-one', 'hash-two'], {'hash-one': vector})
    assert list(store.load(['hash-one'])['hash-one']) == vector
    assert not store.load(['hash-two'])
    foreign = IngestionContext.objects.create(user=owner, data={})
    assert not VectorStore(foreign.id).load(['hash-one'])
    SourceVectorCache.objects.filter(context=snapshot).update(policy='old-model')
    assert not store.load(['hash-one'])
    store.save(['hash-one'], {'hash-one': vector})
    SourceVectorCache.objects.filter(context=snapshot).update(vectors=b'broken')
    assert not store.load(['hash-one'])
    snapshot.delete()
    assert not SourceVectorCache.objects.filter(context_id=snapshot.id).exists()
