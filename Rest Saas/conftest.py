import pytest


@pytest.fixture(autouse=True)
def deterministic_unit_retrieval(monkeypatch):
    """Unit suites never download/load a model; explicit model checks opt in."""
    monkeypatch.setenv('CONTEXA_SEMANTIC', '0')
