"""
GET /healthz — liveness: this process is up and serving requests. No
                dependency checks — a load balancer/orchestrator uses this
                to decide whether to restart the process, so it must not
                fail just because Redis had a blip.
GET /readyz  — readiness: this process is up AND its dependencies (database,
                Redis) are reachable. A load balancer uses this to decide
                whether to route traffic here; an orchestrator uses it to
                decide whether to consider a fresh instance ready.

Both are unauthenticated (a monitoring system can't hold a user's token)
and unthrottled (health checks are legitimately called far more often than
any per-user rate limit would allow, by design).
"""

from django.db import connections
from django.db.utils import OperationalError
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

try:
    import redis as redis_lib
except ImportError:  # pragma: no cover - redis is a hard requirement, but fail soft here
    redis_lib = None

from django.conf import settings


class LivenessView(APIView):
    authentication_classes = []
    renderer_classes = [JSONRenderer]
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(APIView):
    authentication_classes = []
    renderer_classes = [JSONRenderer]
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        checks = {"database": self._check_database(), "redis": self._check_redis()}
        healthy = all(c["ok"] for c in checks.values())
        return Response({"status": "ok" if healthy else "unavailable", "checks": checks}, status=200 if healthy else 503)

    def _check_database(self):
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT 1")
            return {"ok": True}
        except OperationalError:
            return {"ok": False, "error": "database_unavailable"}

    def _check_redis(self):
        if redis_lib is None:
            return {"ok": False, "error": "redis package not installed"}
        try:
            client = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
            client.ping()
            return {"ok": True}
        except Exception:  # Connection details must never reach this public endpoint.
            return {"ok": False, "error": "redis_unavailable"}
