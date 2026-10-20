import importlib.util
from pathlib import Path
import sys
from types import ModuleType
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.db.utils import OperationalError
import pytest
from rest_framework.test import APIClient


def load_production_profile(monkeypatch, database='django.db.backends.postgresql', hosts=None):
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
