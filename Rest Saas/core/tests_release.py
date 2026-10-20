import importlib.util
from pathlib import Path
import sys
from types import ModuleType
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.db.utils import OperationalError
import pytest
from rest_framework.test import APIClient


def load_production_profile(monkeypatch, database='django.db.backends.postgresql', hosts=None, render_bootstrap=False):
    stub = ModuleType('core.settings')
    import os
    stub.os = os
    stub.ImproperlyConfigured = ImproperlyConfigured
    stub.DATABASE_URL = 'postgresql://test.invalid/db'
    stub.DATABASES = {'default': {'ENGINE': database}}
    stub.SECRET_KEY = 'test-only-' + 'x' * 60
    stub.ALLOWED_HOSTS = hosts or ['api.example.invalid', '127.0.0.1']
    stub.CORS_ALLOWED_ORIGINS = ['https://app.example.invalid']
    stub.MIDDLEWARE = ['django.middleware.security.SecurityMiddleware']
    monkeypatch.setitem(sys.modules, 'core.settings', stub)
    monkeypatch.setenv('FRONTEND_URL', 'https://app.example.invalid')
    monkeypatch.setenv('BACKEND_BASE_URL', 'https://api.example.invalid')
    if render_bootstrap:
        monkeypatch.setenv('RENDER', 'true')
        monkeypatch.setenv('RENDER_EXTERNAL_HOSTNAME', 'contexa-first-deploy.onrender.com')
        for key in ('BACKEND_BASE_URL', 'FRONTEND_URL', 'CORS_ALLOWED_ORIGINS'):
            monkeypatch.delenv(key, raising=False)
    spec = importlib.util.spec_from_file_location('core._profile_test', Path(__file__).with_name('production_settings.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_production_profile_enables_transport_and_rejects_dev_database(monkeypatch):
    profile = load_production_profile(monkeypatch)
    assert profile.SECURE_SSL_REDIRECT
    assert profile.SECURE_HSTS_SECONDS == 31536000
    assert profile.SESSION_COOKIE_SECURE and profile.CSRF_COOKIE_SECURE
    assert profile.X_FRAME_OPTIONS == 'DENY'
    with pytest.raises(ImproperlyConfigured, match='PostgreSQL'):
        load_production_profile(monkeypatch, database='django.db.backends.sqlite3')


def test_production_profile_rejects_wildcard_hosts(monkeypatch):
    with pytest.raises(ImproperlyConfigured, match='ALLOWED_HOSTS'):
        load_production_profile(monkeypatch, hosts=['*'])


def test_render_first_deploy_needs_no_public_url_placeholders(monkeypatch):
    profile = load_production_profile(monkeypatch, hosts=['localhost', '127.0.0.1'], render_bootstrap=True)
    assert profile.ALLOWED_HOSTS == ['localhost', '127.0.0.1', 'contexa-first-deploy.onrender.com']
    assert profile.BACKEND_BASE_URL == 'https://contexa-first-deploy.onrender.com'
    assert profile.FRONTEND_URL == profile.BACKEND_BASE_URL
    assert profile.GITHUB_APP_BASE_URL == profile.BACKEND_BASE_URL
    assert profile.CORS_ALLOWED_ORIGINS == [profile.BACKEND_BASE_URL]
    assert '*' not in profile.ALLOWED_HOSTS


def test_render_custom_frontend_overrides_bootstrap_default(monkeypatch):
    monkeypatch.setenv('RENDER', 'true')
    monkeypatch.setenv('RENDER_EXTERNAL_HOSTNAME', 'contexa-first-deploy.onrender.com')
    profile = load_production_profile(monkeypatch)
    assert profile.FRONTEND_URL == 'https://app.example.invalid'
    assert profile.BACKEND_BASE_URL == 'https://api.example.invalid'
    assert 'contexa-first-deploy.onrender.com' in profile.ALLOWED_HOSTS


def test_public_readiness_never_returns_connection_details():
    secret = 'driver failed with password=do-not-disclose'
    with patch('core.health.connections') as connections, patch('core.health.redis_lib') as redis:
        connections.__getitem__.return_value.cursor.side_effect = OperationalError(secret)
        redis.from_url.return_value.ping.side_effect = RuntimeError(secret)
        response = APIClient().get('/readyz')
    assert response.status_code == 503
    assert secret not in str(response.data)
    assert response.data['checks']['database']['error'] == 'database_unavailable'
    assert response.data['checks']['redis']['error'] == 'redis_unavailable'


def test_browser_health_request_returns_json_without_templates_or_authentication():
    browser_accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    response = APIClient().get('/healthz', HTTP_ACCEPT=browser_accept, HTTP_AUTHORIZATION='Token invalid')
    assert response.status_code == 200
    assert response['Content-Type'].startswith('application/json')
    assert response.json() == {'status': 'ok'}


def test_browser_readiness_returns_json_with_dependency_results():
    with patch('core.health.connections') as connections, patch('core.health.redis_lib') as redis:
        redis.from_url.return_value.ping.return_value = True
        response = APIClient().get('/readyz', HTTP_ACCEPT='text/html,*/*;q=0.8')
    assert response.status_code == 200
    assert response['Content-Type'].startswith('application/json')
    assert response.json()['checks'] == {'database': {'ok': True}, 'redis': {'ok': True}}


def test_html_only_api_request_is_not_a_template_server_error():
    response = APIClient().get('/healthz', HTTP_ACCEPT='text/html')
    assert response.status_code == 406
    assert response['Content-Type'].startswith('application/json')
