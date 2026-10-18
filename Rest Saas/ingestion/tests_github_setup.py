from unittest.mock import patch

from rest_framework.test import APIRequestFactory

from .github_app import build_manifest
from .views_github import GitHubInstallCallbackView


def test_manifest_returns_users_after_repository_updates():
    manifest = build_manifest("Contexa", "https://api.example.com", "state")
    assert manifest["setup_on_update"] is True
    assert manifest["setup_url"] == "https://api.example.com/api/integrations/github/callback/"


def test_update_without_state_returns_to_existing_session_only(settings):
    settings.FRONTEND_URL = "http://localhost:5173/"
    with patch("ingestion.views_github.github_app.get_installation") as lookup, patch("ingestion.views_github._redirect_to_frontend_with_token") as issue_token:
        response = GitHubInstallCallbackView.as_view()(APIRequestFactory().get("/", {
            "setup_action": "update", "installation_id": "123",
        }))
    assert response.status_code == 302
    assert response.url == "http://localhost:5173/connections"
    lookup.assert_not_called()
    issue_token.assert_not_called()


def test_new_install_still_requires_valid_state():
    response = GitHubInstallCallbackView.as_view()(APIRequestFactory().get("/", {
        "setup_action": "install", "installation_id": "123",
    }))
    assert response.status_code == 400


def test_update_with_tampered_state_is_rejected():
    response = GitHubInstallCallbackView.as_view()(APIRequestFactory().get("/", {
        "setup_action": "update", "installation_id": "123", "state": "invalid",
    }))
    assert response.status_code == 400
