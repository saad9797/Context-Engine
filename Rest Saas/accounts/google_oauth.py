"""
Google OAuth2 — "Continue with Google" login.

Mirrors the login half of ingestion/github_app.py's OAuth flow
(exchange_oauth_code/get_github_user): a standard authorization-code
exchange done with plain HTTP calls via `requests`, no google-auth SDK
dependency. There's no equivalent of a GitHub "installation" here — Google
isn't a data source this app reads from, only an identity provider.
"""

from urllib.parse import urlencode

import requests
from django.conf import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


class GoogleOAuthError(RuntimeError):
    pass


def _request(method: str, url: str, **kwargs) -> requests.Response:
    """See ingestion/github_app.py's identical helper — same gap, same fix:
    a connection-level failure (DNS/refused/timeout/TLS) here raised
    requests.exceptions.RequestException, which callers only ever caught as
    `except GoogleOAuthError`, turning a network hiccup into a raw 500."""
    try:
        return requests.request(method, url, timeout=kwargs.pop("timeout", 15), **kwargs)
    except requests.exceptions.RequestException as e:
        raise GoogleOAuthError(f"Could not reach Google ({method} {url}): {e}") from e


def build_authorize_url(redirect_uri: str, state: str) -> str:
    params = urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    })
    return f"{GOOGLE_AUTH_URL}?{params}"


def exchange_code(code: str, redirect_uri: str) -> dict:
    resp = _request(
        "POST",
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
    )
    try:
        data = resp.json()
    except ValueError:
        raise GoogleOAuthError(f"OAuth exchange returned a non-JSON response: {resp.status_code} {resp.text[:300]}")
    if "access_token" not in data:
        raise GoogleOAuthError(f"OAuth exchange failed: {data}")
    return data


def get_userinfo(access_token: str) -> dict:
    """The identity of whoever just completed the OAuth flow — includes
    `sub` (stable account id), `email`, `email_verified`, `name`, `picture`."""
    resp = _request("GET", GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if resp.status_code != 200:
        raise GoogleOAuthError(f"Failed to fetch Google user: {resp.status_code} {resp.text[:300]}")
    return resp.json()
