"""
GitHub App integration endpoints.

Endpoints
---------
GET    /api/integrations/github/manifest/           — operator-only (is_staff),
                                                        returns the manifest JSON
                                                        for one-time App creation;
                                                        caller submits it to GitHub
GET    /api/integrations/github/manifest/callback/   — GitHub redirects the
                                                        operator's browser here
                                                        after App creation
GET    /api/integrations/github/install-url/         — per-user install link
                                                        (for an already-logged-in
                                                        user adding another install)
GET    /api/integrations/github/callback/            — GitHub redirects the
                                                        user's browser here
                                                        after installing
GET    /api/integrations/github/login-url/           — "Continue with GitHub":
                                                        the combined login+install
                                                        entry point
GET    /api/integrations/github/login-callback/      — GitHub redirects here
                                                        after OAuth; creates/logs
                                                        into an account and hands
                                                        off to install if needed
POST   /api/integrations/github/webhook/             — installation lifecycle
                                                        events
GET    /api/integrations/github/installations/       — list the caller's
                                                        installations
DELETE /api/integrations/github/installations/<pk>/  — revoke one
"""

import hashlib
import hmac
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.models import User
from django.core import signing
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import github_app
from .audit import log_action
from .models import GitHubAppInstallation, GitHubIdentity
from .serializers import GitHubAppInstallationSerializer

MANIFEST_STATE_SALT = "github-manifest-setup"
INSTALL_STATE_SALT = "github-install"
LOGIN_STATE_SALT = "github-login"


def _redirect_to_frontend_with_token(user):
    token, _ = Token.objects.get_or_create(user=user)
    return redirect(f"{settings.FRONTEND_URL.rstrip('/')}/#token={token.key}")


class GitHubManifestView(APIView):
    """
    Creating a GitHub App is meant to be a one-time, per-deployment action —
    ideally gated to an operator/admin (`IsAdminUser`), not something every
    tenant should be able to trigger once there are real multiple tenants.
    Relaxed to IsAuthenticated for now since this is still single-operator
    local development; swap back to IsAdminUser (and grant yourself
    `is_staff` — see README) before opening registration to other people.

    Returns JSON rather than the auto-submitting HTML page an earlier
    version of this returned — that required navigating the browser here
    directly, which can't carry an Authorization header, so this endpoint
    was unreachable behind TokenAuthentication no matter what. The caller
    (the Connections page) fetches this with its normal auth header, then
    builds and submits the GitHub form client-side.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def get(self, request):
        state = signing.dumps({}, salt=MANIFEST_STATE_SALT)
        app_name = request.query_params.get("name", "Contexa Ingestion")
        manifest = github_app.build_manifest(app_name, settings.GITHUB_APP_BASE_URL, state)
        return Response({
            "manifest": manifest,
            "state": state,
            "github_url": f"https://github.com/settings/apps/new?state={state}",
        })


class GitHubManifestCallbackView(APIView):
    """
    GitHub redirects here with `?state=...&code=...` after the operator
    approves the manifest. The exchanged credentials are shown once for the
    operator to copy into env vars — never written to the database.
    """

    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        state = request.query_params.get("state", "")
        code = request.query_params.get("code")
        try:
            signing.loads(state, salt=MANIFEST_STATE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse("Invalid or expired setup link.", status=400)
        if not code:
            return HttpResponse("Missing code from GitHub.", status=400)

        try:
            data = github_app.convert_manifest_code(code)
        except github_app.GitHubAppError as e:
            return HttpResponse(f"GitHub App creation failed: {e}", status=502)

        html = f"""<!doctype html>
<html><body>
<h2>GitHub App created: {data.get('name')}</h2>
<p>Copy these into your .env and restart the server. They are shown once and not saved anywhere by this app.</p>
<pre>
GITHUB_APP_ID={data.get('id')}
GITHUB_APP_SLUG={data.get('slug')}
GITHUB_APP_CLIENT_ID={data.get('client_id')}
GITHUB_APP_CLIENT_SECRET={data.get('client_secret')}
GITHUB_APP_WEBHOOK_SECRET={data.get('webhook_secret')}
GITHUB_APP_PRIVATE_KEY={(data.get('pem') or '').strip()}
</pre>
</body></html>"""
        return HttpResponse(html)


class GitHubInstallURLView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def get(self, request):
        if not settings.GITHUB_APP_SLUG:
            return Response(
                {"error": "GitHub App is not configured yet. An operator must complete setup first."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        state = signing.dumps({"user_id": request.user.id}, salt=INSTALL_STATE_SALT)
        return Response(
            {
                "install_url": (
                    f"https://github.com/apps/{settings.GITHUB_APP_SLUG}/installations/new"
                    f"?state={state}"
                )
            }
        )


class GitHubInstallCallbackView(APIView):
    """
    GitHub redirects here after install, for both entry points: a logged-in
    user adding another installation from the Connections page, and the
    "Continue with GitHub" flow falling through here when the account it
    just created/found has no installations yet. Either way, ends by
    redirecting back into the SPA with a valid auth token, rather than
    leaving the user stranded on a static "close this tab" page.
    """

    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        state = request.query_params.get("state", "")
        installation_id = request.query_params.get("installation_id")
        setup_action = request.query_params.get("setup_action")

        try:
            payload = signing.loads(state, salt=INSTALL_STATE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse("Invalid or expired install link.", status=400)

        user = get_object_or_404(User, id=payload["user_id"])

        # GitHub sends setup_action="install" for a brand-new installation and
        # "update" when the user changed repo access on an existing one from
        # GitHub's own installation-settings page (fires only if "Redirect on
        # update" is enabled on the App) — both should upsert our record.
        # Revisiting the install picker for an account already installed with
        # no changes made is a GitHub no-op: it shows their own manage page
        # and never hits this callback at all, so there's nothing to handle.
        if setup_action in ("install", "update") and installation_id:
            try:
                info = github_app.get_installation(int(installation_id))
            except github_app.GitHubAppError as e:
                return HttpResponse(f"Could not verify installation: {e}", status=502)

            # Defense in depth against ever silently moving an installation
            # to a different account than the one that actually owns it
            # (the bug this guarded against: a login-identity mixup handing
            # someone else's already-installed repo access to a fresh
            # account). Only ever assign an owner when there isn't one yet.
            existing = GitHubAppInstallation.objects.filter(installation_id=int(installation_id)).first()
            owner = existing.user if existing else user
            installation, _ = GitHubAppInstallation.objects.update_or_create(
                installation_id=int(installation_id),
                defaults={
                    "user": owner,
                    "account_login": info.get("account", {}).get("login", ""),
                    "account_type": info.get("account", {}).get("type", ""),
                },
            )
            log_action(user, "github.install", installation, request=request)

        return _redirect_to_frontend_with_token(user)


class GitHubLoginStartView(APIView):
    """
    GET /api/integrations/github/login-url/ — "Continue with GitHub".

    Standard OAuth user-authorization flow — every GitHub App can act like
    an OAuth App for identifying who's using it, via the App's own
    client_id, independent of any installation. No special manifest flag
    needed.
    """

    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        if not settings.GITHUB_APP_CLIENT_ID:
            return Response(
                {"error": "GitHub App is not configured yet. An operator must complete setup first."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        state = signing.dumps({}, salt=LOGIN_STATE_SALT)
        params = urlencode({
            "client_id": settings.GITHUB_APP_CLIENT_ID,
            "redirect_uri": f"{settings.GITHUB_APP_BASE_URL}/api/integrations/github/login-callback/",
            "state": state,
        })
        return Response({"login_url": f"https://github.com/login/oauth/authorize?{params}"})


class GitHubLoginCallbackView(APIView):
    """
    GET /api/integrations/github/login-callback/?code=...&state=...

    Exchanges the code for the caller's GitHub identity, finds or creates a
    Django account keyed by their GitHub user id, and issues our own auth
    token. If that GitHub identity has no App installation yet (new user,
    or logging in from a machine that hasn't installed it), falls straight
    into the install picker instead of dropping them on an empty dashboard —
    one click gets both an account and repo access, same as Vercel's
    onboarding.
    """

    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        state = request.query_params.get("state", "")
        code = request.query_params.get("code")
        try:
            signing.loads(state, salt=LOGIN_STATE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse("Invalid or expired login link.", status=400)
        if not code:
            return HttpResponse("Missing code from GitHub.", status=400)

        try:
            token_data = github_app.exchange_oauth_code(code)
            gh_user = github_app.get_github_user(token_data["access_token"])
        except github_app.GitHubAppError as e:
            return HttpResponse(f"GitHub login failed: {e}", status=502)

        github_id = gh_user["id"]
        login = gh_user.get("login") or f"gh{github_id}"

        try:
            installations = github_app.list_user_installations(token_data["access_token"])
        except github_app.GitHubAppError:
            installations = []

        identity = GitHubIdentity.objects.filter(github_id=github_id).select_related("user").first()
        if identity:
            user = identity.user
        else:
            # No GitHubIdentity yet doesn't mean no account: the plain
            # "Connect GitHub" install-only flow (username/password login,
            # then install from the Connections page) never creates one.
            # Without this check, a first-time "Continue with GitHub" for
            # someone who already registered and installed the App the
            # other way would spin up a second, disconnected account that
            # can't see any of their existing installs/connections/history —
            # reuse whichever account already owns one of this GitHub
            # user's installations instead, matching what actually happened
            # on GitHub's side rather than guessing from the username.
            existing_owner = (
                GitHubAppInstallation.objects.filter(installation_id__in=[i["id"] for i in installations])
                .select_related("user")
                .first()
            )
            if existing_owner:
                user = existing_owner.user
            else:
                candidate = login
                suffix = 1
                while User.objects.filter(username=candidate).exists():
                    suffix += 1
                    candidate = f"{login}{suffix}"
                user = User.objects.create_user(username=candidate, email=gh_user.get("email") or "")
                log_action(user, "auth.github_signup", user, request=request)
            GitHubIdentity.objects.create(user=user, github_id=github_id, github_login=login)

        log_action(user, "auth.github_login", user, request=request)

        for inst in installations:
            # Same ownership guard as GitHubInstallCallbackView — never move
            # an installation off whichever account already owns it.
            existing = GitHubAppInstallation.objects.filter(installation_id=inst["id"]).first()
            owner = existing.user if existing else user
            GitHubAppInstallation.objects.update_or_create(
                installation_id=inst["id"],
                defaults={
                    "user": owner,
                    "account_login": inst.get("account", {}).get("login", ""),
                    "account_type": inst.get("account", {}).get("type", ""),
                },
            )

        if installations:
            return _redirect_to_frontend_with_token(user)

        # No repos connected yet — send them straight to the install picker;
        # GitHubInstallCallbackView above hands them back to the frontend
        # (with a token) once that's done.
        install_state = signing.dumps({"user_id": user.id}, salt=INSTALL_STATE_SALT)
        return redirect(
            f"https://github.com/apps/{settings.GITHUB_APP_SLUG}/installations/new?state={install_state}"
        )


class GitHubWebhookView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = []
    authentication_classes = []

    def post(self, request):
        signature = request.META.get("HTTP_X_HUB_SIGNATURE_256", "")
        secret = settings.GITHUB_APP_WEBHOOK_SECRET
        if secret:
            expected = "sha256=" + hmac.new(
                secret.encode(), request.body, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(expected, signature):
                return Response({"error": "invalid signature"}, status=status.HTTP_401_UNAUTHORIZED)

        event = request.META.get("HTTP_X_GITHUB_EVENT", "")
        payload = request.data

        if event == "installation" and payload.get("action") == "deleted":
            GitHubAppInstallation.objects.filter(
                installation_id=payload.get("installation", {}).get("id")
            ).delete()

        return Response({"ok": True})


class GitHubInstallationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        installations = GitHubAppInstallation.objects.filter(user=request.user)
        return Response(GitHubAppInstallationSerializer(installations, many=True).data)


class GitHubInstallationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        installation = GitHubAppInstallation.objects.filter(user=request.user, id=pk).first()
        if installation is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            github_app.delete_installation(installation.installation_id)
        except github_app.GitHubAppError:
            pass  # best-effort — still remove our own record either way
        log_action(request.user, "github.uninstall", installation, request=request)
        installation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
