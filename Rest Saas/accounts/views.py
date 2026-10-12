"""
Endpoints
---------
POST /api/auth/register/  — create an account, returns an auth token
POST /api/auth/login/     — exchange username/password for an auth token
POST /api/auth/logout/    — invalidate the caller's current token
GET  /api/auth/me/        — current user's profile
"""

from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import LoginSerializer, RegisterSerializer, UserSerializer


class RegisterView(APIView):
    permission_classes = [AllowAny]
    # Unauthenticated + unlimited account creation is a real spam/abuse
    # vector (bulk fake accounts, automated signups) — ScopedRateThrottle
    # keys by IP here since there's no user yet. Rate is in
    # DEFAULT_THROTTLE_RATES["auth_register"].
    throttle_scope = "auth_register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    # Unauthenticated + unlimited is a straightforward password-brute-force
    # vector — the previous `throttle_classes = []` here was a real gap
    # (found in a 2026-09-28 production-readiness audit), not a deliberate
    # choice; every failed OR successful attempt still counts against the
    # scope since ScopedRateThrottle only sees "a request happened," which
    # is the correct conservative behavior for a login endpoint.
    throttle_scope = "auth_login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def get(self, request):
        return Response(UserSerializer(request.user).data)
