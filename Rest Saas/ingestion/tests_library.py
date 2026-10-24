import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from .models import IngestionContext


@pytest.mark.django_db
def test_library_pages_search_and_tenant_isolation():
    owner = User.objects.create_user(username="library-owner")
    other = User.objects.create_user(username="library-other")
    client = APIClient()
    client.force_authenticate(owner)
    for i in range(15):
        IngestionContext.objects.create(user=owner, project_name=f"Project {i}", data={
            "codebase": {"repository": {"full_name": f"team/repo-{i}"}},
            "private_source": "large source must never appear",
        })
    IngestionContext.objects.create(user=other, project_name="Secret", data={})
    first = client.get("/api/ingestion/?page_size=12").data
    assert first["count"] == 15
    assert len(first["results"]) == 12
    assert first["next"]
    second = client.get("/api/ingestion/?page_size=12&page=2").data
    assert len(second["results"]) == 3
    assert second["next"] is None
    assert not ({r["id"] for r in first["results"]} & {r["id"] for r in second["results"]})
    assert "private_source" not in str(first)
    assert client.get("/api/ingestion/?page_size=12&q=Secret").data["count"] == 0
    found = client.get("/api/ingestion/?page_size=12&q=team/repo-14").data
    assert found["count"] == 1
    assert found["results"][0]["project_name"] == "Project 14"
    assert len(client.get("/api/ingestion/").data) == 15
