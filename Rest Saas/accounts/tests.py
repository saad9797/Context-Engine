"""
Functional tests for registration/login, plus the P0-2 fix from the
2026-09-28 production-readiness audit: login/register previously had
`throttle_classes = []`, meaning unlimited password-guessing and unlimited
account-creation were both possible. These tests exist specifically to
prove that gap is closed and to catch a silent regression if the throttle
scope is ever removed again.
"""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APIClient

import pytest

# Every test in this file hits /api/auth/login/ or /api/auth/register/,
# both throttled (ScopedRateThrottle, counted via Django's cache
# framework). The project's real CACHES points at Redis, which is
# process-external, persistent state — a bug found the hard way while
# writing these tests: only the dedicated throttle tests originally
# overrode the cache, so repeated full-suite runs against the same real
# Redis instance eventually pushed the register/login scopes' hit counts
# past the configured rate, and *unrelated* tests (validation checks, not
# throttle checks) started failing with 429 instead of the 400 they were
# actually testing for — flaky, order/history-dependent, and not what any
# of those tests were about. Autouse + locmem here makes every test in
# this file isolated from Redis and from every other test run entirely.
THROTTLE_TEST_CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@pytest.fixture(autouse=True)
def isolated_throttle_cache(settings):
    settings.CACHES = THROTTLE_TEST_CACHES
    # LocMemCache instances sharing the default (unnamed) LOCATION share
    # one process-global dict by design (so Django's own settings-changed
    # handling doesn't lose cache state) — meaning throttle hit counts
    # would otherwise still accumulate across every test in this file
    # within one pytest run, not just across separate runs against Redis.
    # Explicit clear makes each test's throttle state start from zero.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.mark.django_db
class TestRegister:
    def test_register_creates_user_and_returns_token(self, api_client):
        res = api_client.post(
            "/api/auth/register/",
            {"username": "newuser1", "email": "newuser1@example.com", "password": "correct-horse-battery-1"},
            format="json",
        )
        assert res.status_code == 201
        assert "token" in res.data
        assert res.data["user"]["username"] == "newuser1"
        assert User.objects.filter(username="newuser1").exists()

    def test_register_rejects_short_password(self, api_client):
        # AUTH_PASSWORD_VALIDATORS enforces MinimumLengthValidator(8) —
        # this is the thing that would silently do nothing if someone
        # removed AUTH_PASSWORD_VALIDATORS from settings.py.
        res = api_client.post(
            "/api/auth/register/",
            {"username": "shortpw", "password": "abc"},
            format="json",
        )
        assert res.status_code == 400
        assert not User.objects.filter(username="shortpw").exists()

    def test_register_rejects_duplicate_email(self, api_client):
        User.objects.create_user(username="existing", email="dupe@example.com", password="correct-horse-battery-1")
        res = api_client.post(
            "/api/auth/register/",
            {"username": "different", "email": "dupe@example.com", "password": "correct-horse-battery-1"},
            format="json",
        )
        assert res.status_code == 400


@pytest.mark.django_db
class TestLogin:
    def test_login_with_correct_credentials_returns_token(self, api_client):
        User.objects.create_user(username="alice", password="correct-horse-battery-1")
        res = api_client.post("/api/auth/login/", {"username": "alice", "password": "correct-horse-battery-1"}, format="json")
        assert res.status_code == 200
        assert "token" in res.data

    def test_login_with_wrong_password_is_rejected(self, api_client):
        User.objects.create_user(username="alice", password="correct-horse-battery-1")
        res = api_client.post("/api/auth/login/", {"username": "alice", "password": "wrong-password"}, format="json")
        assert res.status_code == 400
        assert "token" not in res.data

    def test_login_with_disabled_account_is_rejected(self, api_client):
        user = User.objects.create_user(username="disabled", password="correct-horse-battery-1")
        user.is_active = False
        user.save()
        res = api_client.post("/api/auth/login/", {"username": "disabled", "password": "correct-horse-battery-1"}, format="json")
        assert res.status_code == 400


@pytest.mark.django_db
class TestAuthRateLimiting:
    """P0-2 regression guard — see accounts/views.py for the throttle_scope
    that was missing before this audit."""

    def test_login_is_throttled_past_configured_rate(self, api_client):
        User.objects.create_user(username="bruteforce_target", password="correct-horse-battery-1")
        # settings.py: DEFAULT_THROTTLE_RATES["auth_login"] = "10/min"
        responses = [
            api_client.post("/api/auth/login/", {"username": "bruteforce_target", "password": "wrong"}, format="json")
            for _ in range(11)
        ]
        statuses = [r.status_code for r in responses]
        assert 429 in statuses, f"Expected a 429 among 11 rapid login attempts, got: {statuses}"
        # Every attempt before the throttle kicked in should have been a
        # normal 400 (wrong password), not silently swallowed.
        assert statuses[0] == 400

    def test_register_is_throttled_past_configured_rate(self, api_client):
        # settings.py: DEFAULT_THROTTLE_RATES["auth_register"] = "10/hour"
        responses = [
            api_client.post(
                "/api/auth/register/",
                {"username": f"spam_user_{i}", "password": "correct-horse-battery-1"},
                format="json",
            )
            for i in range(11)
        ]
        statuses = [r.status_code for r in responses]
        assert 429 in statuses, f"Expected a 429 among 11 rapid registrations, got: {statuses}"
