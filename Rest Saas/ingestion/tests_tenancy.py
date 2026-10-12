"""
Adversarial tenancy/IDOR tests — P0-5 from the 2026-09-28 production-
readiness audit.

The whole product's trust model rests on one claim: "your data is yours."
Every view in this app implements that via `.filter(user=request.user)`
plus a 404 (never 403) on anything not owned, so a UUID can't be used to
probe for the existence of someone else's data. That pattern was verified
by code inspection across every view — this file is the first time it's
verified mechanically, by actually having a second user try to reach the
first user's data through every relevant endpoint.

Deliberately constructs fixtures directly via the ORM rather than running
real ingestion jobs (which need live Postgres/Mongo/GitHub/Redis) — the
question under test is authorization, not the ingestion engine itself.
"""

from django.contrib.auth.models import User
from rest_framework.test import APIClient

import pytest

from .models import AuditLogEntry, DataSourceConnection, GitHubAppInstallation, IngestionContext, IngestionJob


@pytest.fixture
def user_a():
    return User.objects.create_user(username="tenant_a", password="correct-horse-battery-1")


@pytest.fixture
def user_b():
    return User.objects.create_user(username="tenant_b", password="correct-horse-battery-2")


@pytest.fixture
def client_a(user_a):
    client = APIClient()
    client.force_authenticate(user=user_a)
    return client


@pytest.fixture
def client_b(user_b):
    client = APIClient()
    client.force_authenticate(user=user_b)
    return client


@pytest.fixture
def as_connection(user_a):
    conn = DataSourceConnection(user=user_a, name="a-prod-db", kind="postgres")
    conn.set_config({"postgres_url": "postgresql://user:pass@host:5432/db"})
    conn.save()
    return conn


@pytest.fixture
def as_context(user_a):
    return IngestionContext.objects.create(
        user=user_a,
        project_name="Tenant A's Secret Project",
        data={"_meta": {"project": {"project_name": "Tenant A's Secret Project"}}, "claude_context": {"database": None}},
    )


@pytest.fixture
def as_job(user_a, as_context):
    return IngestionJob.objects.create(user=user_a, status="succeeded", result=as_context)


@pytest.fixture
def as_installation(user_a):
    return GitHubAppInstallation.objects.create(user=user_a, installation_id=999999, account_login="tenant-a-org")


@pytest.mark.django_db
class TestConnectionTenancy:
    def test_user_b_cannot_list_user_a_connections(self, client_a, client_b, as_connection):
        assert len(client_a.get("/api/connections/").data) == 1
        assert client_b.get("/api/connections/").data == []

    def test_user_b_cannot_delete_user_a_connection(self, client_b, as_connection):
        res = client_b.delete(f"/api/connections/{as_connection.id}/")
        assert res.status_code == 404
        assert DataSourceConnection.objects.filter(id=as_connection.id).exists()

    def test_user_a_can_delete_own_connection(self, client_a, as_connection):
        res = client_a.delete(f"/api/connections/{as_connection.id}/")
        assert res.status_code == 204
        assert not DataSourceConnection.objects.filter(id=as_connection.id).exists()


@pytest.mark.django_db
class TestIngestionContextTenancy:
    def test_user_b_cannot_read_user_a_context(self, client_b, as_context):
        res = client_b.get(f"/api/ingestion/{as_context.id}/")
        assert res.status_code == 404

    def test_user_b_cannot_read_user_a_claude_context(self, client_b, as_context):
        res = client_b.get(f"/api/ingestion/{as_context.id}/claude-context/")
        assert res.status_code == 404

    def test_user_b_cannot_read_user_a_freshness(self, client_b, as_context):
        res = client_b.get(f"/api/ingestion/{as_context.id}/freshness/")
        assert res.status_code == 404

    def test_user_b_cannot_read_user_a_diff(self, client_b, as_context):
        res = client_b.get(f"/api/ingestion/{as_context.id}/diff/")
        assert res.status_code == 404

    def test_user_b_list_never_includes_user_a_context(self, client_a, client_b, as_context):
        ids_a = {row["id"] for row in client_a.get("/api/ingestion/").data}
        ids_b = {row["id"] for row in client_b.get("/api/ingestion/").data}
        assert str(as_context.id) in ids_a
        assert str(as_context.id) not in ids_b

    def test_user_a_can_read_own_context(self, client_a, as_context):
        res = client_a.get(f"/api/ingestion/{as_context.id}/")
        assert res.status_code == 200


@pytest.mark.django_db
class TestIngestionJobTenancy:
    def test_user_b_cannot_read_user_a_job_status(self, client_b, as_job):
        res = client_b.get(f"/api/ingestion/jobs/{as_job.id}/")
        assert res.status_code == 404

    def test_user_a_can_read_own_job_status(self, client_a, as_job):
        res = client_a.get(f"/api/ingestion/jobs/{as_job.id}/")
        assert res.status_code == 200

    def test_user_b_cannot_create_job_against_user_a_connection(self, client_b, as_connection):
        # IDOR via a foreign id embedded in a POST body, not just the URL —
        # the create view is expected to verify ownership of every
        # connection id it's handed, not just trust that the id exists.
        res = client_b.post(
            "/api/ingestion/run/",
            {"postgres_connection_id": str(as_connection.id)},
            format="json",
        )
        assert res.status_code == 404
        assert not IngestionJob.objects.filter(connection_refs__postgres_connection_id=str(as_connection.id)).exists()

    def test_user_b_cannot_create_job_against_user_a_github_installation(self, client_b, as_installation):
        res = client_b.post(
            "/api/ingestion/run/",
            {
                "github_installation_id": as_installation.installation_id,
                "github_owner": "tenant-a-org",
                "github_repo": "secret-repo",
            },
            format="json",
        )
        assert res.status_code == 404


@pytest.mark.django_db
class TestAuditLogTenancy:
    def test_user_b_never_sees_user_a_audit_entries(self, client_a, client_b, user_a, user_b):
        AuditLogEntry.objects.create(user=user_a, action="connection.create", target_type="DataSourceConnection", target_id="x")
        AuditLogEntry.objects.create(user=user_b, action="connection.create", target_type="DataSourceConnection", target_id="y")

        actions_a = [e["action"] for e in client_a.get("/api/audit-log/").data]
        actions_b = [e["action"] for e in client_b.get("/api/audit-log/").data]

        assert len(actions_a) == 1
        assert len(actions_b) == 1


@pytest.mark.django_db
class TestGitHubInstallationTenancy:
    def test_user_b_cannot_list_user_a_installations_as_own(self, client_a, client_b, as_installation):
        assert len(client_a.get("/api/integrations/github/installations/").data) == 1
        assert client_b.get("/api/integrations/github/installations/").data == []

    def test_user_b_cannot_revoke_user_a_installation(self, client_b, as_installation):
        res = client_b.delete(f"/api/integrations/github/installations/{as_installation.id}/")
        assert res.status_code == 404
        assert GitHubAppInstallation.objects.filter(id=as_installation.id).exists()


@pytest.mark.django_db
class TestUnauthenticatedAccess:
    """Every endpoint above should also simply refuse an anonymous caller —
    the global DEFAULT_PERMISSION_CLASSES=[IsAuthenticated] is what every
    other test in this file relies on implicitly; this makes that
    assumption explicit and would fail loudly if it were ever loosened."""

    def test_anonymous_cannot_list_connections(self, as_connection):
        res = APIClient().get("/api/connections/")
        assert res.status_code == 401

    def test_anonymous_cannot_read_context(self, as_context):
        res = APIClient().get(f"/api/ingestion/{as_context.id}/")
        assert res.status_code == 401
