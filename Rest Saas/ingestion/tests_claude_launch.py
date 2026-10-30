from datetime import timedelta
from urllib.parse import urlsplit, parse_qs

import pytest
from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ClaudeLaunch, IngestionContext

pytestmark = pytest.mark.django_db


@pytest.fixture
def launch_setup(settings):
    settings.BACKEND_BASE_URL = 'https://api.example.com'
    settings.FIELD_ENCRYPTION_KEY = Fernet.generate_key().decode()
    user = User.objects.create_user(username='claude-owner')
    snapshot = IngestionContext.objects.create(user=user, data={'codebase': {'repository': {'full_name': 'acme/project'}}})
    client = APIClient()
    client.force_authenticate(user)
    return client, snapshot


def create_launch(client, snapshot, handoff=None):
    return client.post(f'/api/ingestion/{snapshot.id}/claude-launch/', {'handoff': handoff or {'request': {'task': 'Add interviews'}, 'code': [{'content': 'x' * 150000}]}}, format='json')


def prompt_path(response):
    url = parse_qs(urlsplit(response.data['url']).query)['prompt_url'][0]
    parsed = urlsplit(url)
    return parsed.path + '?' + parsed.query


def test_long_prompt_roundtrip_is_private_encrypted_and_not_in_launch_url(launch_setup):
    client, snapshot = launch_setup
    response = create_launch(client, snapshot)
    assert response.status_code == 201
    assert len(response.data['url']) < 1000
    assert parse_qs(urlsplit(response.data['url']).query)['repositories'] == ['acme/project']
    saved = ClaudeLaunch.objects.get()
    assert 'Add interviews' not in saved.encrypted_prompt
    public = APIClient().get(prompt_path(response), HTTP_ORIGIN='https://claude.ai', HTTP_ACCEPT='text/plain')
    assert public.status_code == 200
    assert 'x' * 150000 in public.content.decode()
    assert 'Add interviews' in public.content.decode()
    assert public['Content-Type'].startswith('text/plain')
    assert public['Access-Control-Allow-Origin'] == 'https://claude.ai'
    assert 'no-store' in public['Cache-Control']
    assert response['Cache-Control'] == 'no-store'


def test_cannot_create_or_revoke_another_owners_launch(launch_setup):
    client, snapshot = launch_setup
    response = create_launch(client, snapshot)
    client.force_authenticate(User.objects.create_user(username='other'))
    assert create_launch(client, snapshot).status_code == 404
    assert client.delete(f'/api/ingestion/{snapshot.id}/claude-launch/{response.data["id"]}/').status_code == 404
    assert APIClient().post(f'/api/ingestion/{snapshot.id}/claude-launch/', {}, format='json').status_code == 401


def test_bad_or_missing_capability_cannot_read_prompt(launch_setup):
    client, snapshot = launch_setup
    response = create_launch(client, snapshot)
    path = prompt_path(response)
    assert APIClient().get(path.split('?')[0]).status_code == 404
    assert APIClient().get(path + 'tampered').status_code == 404


def test_expired_revoked_and_deleted_snapshots_stop_serving_prompts(launch_setup):
    client, snapshot = launch_setup
    first = create_launch(client, snapshot)
    ClaudeLaunch.objects.filter(pk=first.data['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert APIClient().get(prompt_path(first)).status_code == 404
    second = create_launch(client, snapshot)
    assert client.delete(f'/api/ingestion/{snapshot.id}/claude-launch/{second.data["id"]}/').status_code == 204
    assert APIClient().get(prompt_path(second)).status_code == 404
    third = create_launch(client, snapshot)
    snapshot.delete()
    assert APIClient().get(prompt_path(third)).status_code == 404


@pytest.mark.parametrize('handoff', [[], {}, {'request': {'task': ''}}, {'request': {'task': 123}}, {'request': {'task': 'a'}, 'code': 'x' * 1048576}])
def test_rejects_empty_invalid_or_oversize_handoffs(launch_setup, handoff):
    client, snapshot = launch_setup
    assert client.post(f'/api/ingestion/{snapshot.id}/claude-launch/', {'handoff': handoff}, format='json').status_code == 400
    assert not ClaudeLaunch.objects.exists()


def test_local_backend_gives_actionable_error_instead_of_broken_link(launch_setup, settings):
    client, snapshot = launch_setup
    settings.BACKEND_BASE_URL = 'http://localhost:8000'
    response = create_launch(client, snapshot)
    assert response.status_code == 409
    assert 'public HTTPS' in response.data['error']


def test_claude_cors_access_does_not_extend_to_private_endpoints(launch_setup):
    client, snapshot = launch_setup
    response = create_launch(client, snapshot)
    path = prompt_path(response)
    assert APIClient().get(path, HTTP_ORIGIN='https://unrelated.example')['Access-Control-Allow-Origin'] == 'https://claude.ai'
    private = client.get('/api/ingestion/', HTTP_ORIGIN='https://claude.ai')
    assert 'Access-Control-Allow-Origin' not in private
