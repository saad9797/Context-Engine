"""
Endpoints
---------
GET /api/auth/google/login-url/  — "Continue with Google": returns the
                                    consent-screen URL to redirect the
                                    browser to
GET /api/auth/google/callback/   — Google redirects here with ?code=&state=
                                    after the user approves; exchanges the
                                    code, finds/creates a Django account, and
                                    hands the browser back to the SPA with an
                                    auth token (same pattern as GitHub's
                                    login-callback — see
                                    ingestion/views_github.py)
"""

from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.models import User
from django.core import signing
from django.http import HttpResponse
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ingestion.audit import log_action
from ingestion.models import GoogleIdentity

from . import google_oauth

STATE_SALT = "google-login"


def _redirect_uri():
    base = (settings.BACKEND_BASE_URL or "").strip() or settings.GITHUB_APP_BASE_URL.strip()
    try:
        parsed = urlsplit(base)
        valid = (
            parsed.scheme in {"http", "https"} and parsed.hostname
            and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment
            and (parsed.scheme == "https" or parsed.hostname in {"localhost", "127.0.0.1", "::1"})
        )
        parsed.port  # Reject malformed ports before sending the browser to Google.
    except ValueError:
        valid = False
    if not valid:
        raise google_oauth.GoogleOAuthError(
            "Google sign-in requires BACKEND_BASE_URL to be an absolute HTTPS URL "
            "(HTTP is allowed for localhost development). Register that URL followed by "
            "/api/auth/google/callback/ in your Google Web application OAuth client."
        )
    return f"{base.rstrip('/')}/api/auth/google/callback/"


def _redirect_to_frontend_with_token(user):
    token, _ = Token.objects.get_or_create(user=user)
    return redirect(f"{settings.FRONTEND_URL.rstrip('/')}/#token={token.key}")


class GoogleLoginStartView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
            return Response(
                {"error": "Google sign-in is not configured yet. An operator must set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            callback = _redirect_uri()
        except google_oauth.GoogleOAuthError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        state = signing.dumps({}, salt=STATE_SALT)
        return Response({"login_url": google_oauth.build_authorize_url(callback, state)})


class GoogleLoginCallbackView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        state = request.query_params.get("state", "")
        code = request.query_params.get("code")
        try:
            signing.loads(state, salt=STATE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse("Invalid or expired login link.", status=400)
        if not code:
            error = request.query_params.get("error", "missing code")
            return HttpResponse(f"Google sign-in failed: {error}", status=400)

        try:
            token_data = google_oauth.exchange_code(code, _redirect_uri())
            profile = google_oauth.get_userinfo(token_data["access_token"])
        except google_oauth.GoogleOAuthError as e:
            return HttpResponse(f"Google sign-in failed: {e}", status=502)

        google_id = profile.get("sub")
        email = profile.get("email", "")
        if not google_id:
            return HttpResponse("Google did not return an account id.", status=502)
        if email and not profile.get("email_verified", True):
            return HttpResponse("Your Google account's email isn't verified yet — verify it with Google first.", status=400)

        identity = GoogleIdentity.objects.filter(google_id=google_id).select_related("user").first()
        if identity:
            user = identity.user
        else:
            # An existing account (password or GitHub signup) with this same
            # verified email is the same person — attach this Google
            # identity to it instead of creating a disconnected duplicate
            # that can't see their existing connections/history. Mirrors
            # the ownership-reuse guard in GitHubLoginCallbackView.
            user = User.objects.filter(email__iexact=email).first() if email else None
            if not user:
                base = (email.split("@")[0] if email else f"google{google_id}") or f"google{google_id}"
                candidate = base
                suffix = 1
                while User.objects.filter(username=candidate).exists():
                    suffix += 1
                    candidate = f"{base}{suffix}"
                user = User.objects.create_user(username=candidate, email=email)
                log_action(user, "auth.google_signup", user, request=request)
            GoogleIdentity.objects.create(user=user, google_id=google_id, email=email)

        log_action(user, "auth.google_login", user, request=request)
        return _redirect_to_frontend_with_token(user)
