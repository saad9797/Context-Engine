"""
GitHub App integration — replaces raw personal access tokens.

Two flows live here:

1. Manifest flow (one-time, operator-only): the operator running this
   deployment creates the GitHub App itself via GitHub's "app manifest" flow
   instead of hand-filling GitHub's form. `build_manifest()` produces the
   JSON GitHub expects; after the operator approves it on github.com, GitHub
   redirects back with a temporary `code` that `convert_manifest_code()`
   exchanges for the App's real credentials (id, private key, client
   secret, webhook secret) — those get pasted into env vars once, and are
   never stored in the database.

2. Per-tenant install flow: each user installs the already-created App on
   whichever repos they choose. We never see or store a token for this —
   only the `installation_id` GitHub hands back. Every ingestion run mints a
   fresh, short-lived (~1hr) installation access token scoped to exactly
   those repos via `mint_installation_token()`, right before handing it to
   the Node runner. Nothing GitHub-related is ever persisted encrypted or
   otherwise, because there's no long-lived secret to persist.
"""

import time

import jwt
import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

GITHUB_API = "https://api.github.com"


class GitHubAppError(RuntimeError):
    pass


def _request(method: str, url: str, **kwargs) -> requests.Response:
    """
    Every function below calls this instead of `requests.*` directly. A bad
    HTTP status was already turned into GitHubAppError at each call site,
    but a failure *before* any response — DNS, connection refused/reset, TLS,
    timeout — raises requests.exceptions.RequestException, which callers
    only ever caught as `except github_app.GitHubAppError`. That gap is what
    turned a transient network hiccup during "Continue with GitHub" into an
    unhandled 500 instead of the clean 502 the callback view already knows
    how to return. Centralized here so every call site is covered, not just
    the ones someone remembers to wrap.
    """
    try:
        return requests.request(method, url, timeout=kwargs.pop("timeout", 15), **kwargs)
    except requests.exceptions.RequestException as e:
        raise GitHubAppError(f"Could not reach GitHub ({method} {url}): {e}") from e


def _require_app_configured():
    if not (settings.GITHUB_APP_ID and settings.GITHUB_APP_PRIVATE_KEY):
        raise ImproperlyConfigured(
            "GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not set. Complete the "
            "one-time setup at GET /api/integrations/github/manifest/ first."
        )


def build_app_jwt() -> str:
    """Short-lived (10 min) JWT authenticating as the GitHub App itself."""
    _require_app_configured()
    now = int(time.time())
    payload = {
        "iat": now - 60,  # allow for clock drift
        "exp": now + 10 * 60,
        "iss": settings.GITHUB_APP_ID,
    }
    return jwt.encode(payload, settings.GITHUB_APP_PRIVATE_KEY, algorithm="RS256")


def _app_headers():
    return {
        "Authorization": f"Bearer {build_app_jwt()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def mint_installation_token(installation_id: int) -> dict:
    """
    Exchange the App's identity for a short-lived token scoped to one
    installation. Returns {"token": ..., "expires_at": ...}. Never persisted
    — callers pass the token straight to the Node runner for a single job.
    """
    resp = _request(
        "POST",
        f"{GITHUB_API}/app/installations/{installation_id}/access_tokens",
        headers=_app_headers(),
    )
    if resp.status_code != 201:
        raise GitHubAppError(
            f"Failed to mint installation token for installation {installation_id}: "
            f"{resp.status_code} {resp.text[:300]}"
        )
    return resp.json()


def get_installation(installation_id: int) -> dict:
    """Fetch installation metadata (account login/type) as the App itself."""
    resp = _request("GET", f"{GITHUB_API}/app/installations/{installation_id}", headers=_app_headers())
    if resp.status_code != 200:
        raise GitHubAppError(
            f"Failed to fetch installation {installation_id}: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()


def delete_installation(installation_id: int) -> None:
    """
    Fully revoke the App's access to this installation on GitHub's side (not
    just our own DB record) — this is the "revocable instantly" property a
    PAT never had.
    """
    resp = _request("DELETE", f"{GITHUB_API}/app/installations/{installation_id}", headers=_app_headers())
    if resp.status_code not in (204, 404):
        raise GitHubAppError(
            f"Failed to revoke installation {installation_id}: {resp.status_code} {resp.text[:300]}"
        )


def list_installation_repos(installation_id: int) -> list:
    """Repos the installation actually has access to, for populating the UI."""
    token = mint_installation_token(installation_id)["token"]
    resp = _request(
        "GET",
        f"{GITHUB_API}/installation/repositories",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
    )
    if resp.status_code != 200:
        raise GitHubAppError(
            f"Failed to list repos for installation {installation_id}: "
            f"{resp.status_code} {resp.text[:300]}"
        )
    return resp.json().get("repositories", [])


# ─── Manifest flow (operator setup) ─────────────────────────────────────────

def build_manifest(app_name: str, base_url: str, state: str) -> dict:
    """
    The JSON payload GitHub's app-manifest flow expects. POSTing this (via an
    auto-submitting HTML form, per GitHub's docs) to
    https://github.com/settings/apps/new?state=<state> lets the operator
    create the App with one click-through instead of filling out GitHub's
    form by hand.
    """
    return {
        "name": app_name,
        "url": base_url,
        "hook_attributes": {"url": f"{base_url}/api/integrations/github/webhook/"},
        "redirect_url": f"{base_url}/api/integrations/github/manifest/callback/?state={state}",
        "callback_urls": [f"{base_url}/api/integrations/github/callback/"],
        "setup_url": f"{base_url}/api/integrations/github/callback/",
        "public": False,
        "default_permissions": {
            "contents": "read",
            "metadata": "read",
            "pull_requests": "read",
        },
        "default_events": ["installation", "installation_repositories"],
    }


def exchange_oauth_code(code: str) -> dict:
    """
    User-to-server OAuth exchange — every GitHub App can act like an OAuth
    App for identifying *who's* using it, via the same web flow and the
    App's own client_id/secret (captured during manifest conversion). This
    is the "Sign in with GitHub" half; installing the App for repo access is
    a separate step (list_user_installations / the install-url flow).
    """
    resp = _request(
        "POST",
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.GITHUB_APP_CLIENT_ID,
            "client_secret": settings.GITHUB_APP_CLIENT_SECRET,
            "code": code,
        },
    )
    # GitHub returns plain-text/HTML (not JSON) for some failure modes here
    # (a bad Accept header being ignored, an outage page, etc.) — resp.json()
    # would raise a raw, uncaught ValueError in that case instead of the
    # clean GitHubAppError callers already know how to handle.
    try:
        data = resp.json()
    except ValueError:
        raise GitHubAppError(f"OAuth exchange returned a non-JSON response: {resp.status_code} {resp.text[:300]}")
    if "access_token" not in data:
        raise GitHubAppError(f"OAuth exchange failed: {data}")
    return data


def get_github_user(user_access_token: str) -> dict:
    """The identity of whoever just completed the OAuth flow."""
    resp = _request(
        "GET",
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {user_access_token}", "Accept": "application/vnd.github+json"},
    )
    if resp.status_code != 200:
        raise GitHubAppError(f"Failed to fetch GitHub user: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def list_user_installations(user_access_token: str) -> list:
    """Which installations of this App the logged-in GitHub user can see."""
    resp = _request(
        "GET",
        "https://api.github.com/user/installations",
        headers={"Authorization": f"Bearer {user_access_token}", "Accept": "application/vnd.github+json"},
    )
    if resp.status_code != 200:
        raise GitHubAppError(f"Failed to list user installations: {resp.status_code} {resp.text[:300]}")
    return resp.json().get("installations", [])


def convert_manifest_code(code: str) -> dict:
    """
    Exchange the temporary `code` GitHub's redirect included for the App's
    real credentials. Returns the raw GitHub response — the caller is
    responsible for handing these to the operator to paste into env vars;
    they are intentionally never written to the database.
    """
    resp = _request(
        "POST",
        f"{GITHUB_API}/app-manifests/{code}/conversions",
        headers={"Accept": "application/vnd.github+json"},
    )
    if resp.status_code != 201:
        raise GitHubAppError(
            f"Manifest conversion failed: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()
