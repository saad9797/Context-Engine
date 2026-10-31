import pytest


@pytest.fixture(autouse=True)
def isolated_unit_cache(settings, request):
    """A unit run must never clear or consume a developer/production Redis cache."""
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                                   'LOCATION': request.node.nodeid}}


@pytest.fixture(autouse=True)
def deterministic_unit_retrieval(monkeypatch):
    """Unit suites never download/load a model; explicit model checks opt in."""
    monkeypatch.setenv('CONTEXA_SEMANTIC', '0')
