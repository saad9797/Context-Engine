from urllib.parse import parse_qs, urlsplit

import pytest
from rest_framework.test import APIRequestFactory

from .views_google import GoogleLoginStartView


@pytest.fixture
def oauth_settings(settings):
    settings.GOOGLE_CLIENT_ID = "example.apps.googleusercontent.com"
    settings.GOOGLE_CLIENT_SECRET = "test-secret"
    settings.GITHUB_APP_BASE_URL = "http://localhost:8000"
    return settings


@pytest.mark.parametrize("base", ["", "   ", "http://localhost:8000/"])
def test_local_callback_uses_absolute_backend_url(oauth_settings, base):
    oauth_settings.BACKEND_BASE_URL = base
    response = GoogleLoginStartView.as_view()(APIRequestFactory().get("/"))
    assert response.status_code == 200
    params = parse_qs(urlsplit(response.data["login_url"]).query)
    assert params["redirect_uri"] == ["http://localhost:8000/api/auth/google/callback/"]
    assert params["response_type"] == ["code"]


@pytest.mark.parametrize("base", ["/relative", "http://app.example.com", "https://app.example.com?bad=1", "https://app.example.com#fragment", "https://app.example.com:bad"])
def test_invalid_callback_is_reported_before_google_redirect(oauth_settings, base):
    oauth_settings.BACKEND_BASE_URL = base
    response = GoogleLoginStartView.as_view()(APIRequestFactory().get("/"))
    assert response.status_code == 503
    assert "BACKEND_BASE_URL" in response.data["error"]


def test_production_callback(oauth_settings):
    oauth_settings.BACKEND_BASE_URL = "https://api.example.com/"
    response = GoogleLoginStartView.as_view()(APIRequestFactory().get("/"))
    params = parse_qs(urlsplit(response.data["login_url"]).query)
    assert params["redirect_uri"] == ["https://api.example.com/api/auth/google/callback/"]


def test_missing_secret_disables_signin(oauth_settings):
    oauth_settings.GOOGLE_CLIENT_SECRET = ""
    response = GoogleLoginStartView.as_view()(APIRequestFactory().get("/"))
    assert response.status_code == 503
    assert "login_url" not in response.data
