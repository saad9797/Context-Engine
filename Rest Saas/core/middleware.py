"""
Request-id correlation — added 2026-09-28 (production-readiness audit,
P1-5). Previously there was no way to correlate a log line back to the
request that caused it, which matters most exactly when you need it least
conveniently: debugging a production incident from logs alone, with no
request/response to inspect directly.
"""

import uuid
from contextvars import ContextVar
from django.utils.cache import patch_vary_headers

_request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class PrivateAPICacheMiddleware:
    """Auth tokens, private source, and account data must not be cached."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith('/api/'):
            response.setdefault('Cache-Control', 'no-store, private')
            patch_vary_headers(response, ['Authorization'])
        return response


def get_current_request_id() -> str:
    return _request_id_var.get()


class RequestIDMiddleware:
    """
    Reuses an inbound `X-Request-Id` header if a load balancer/proxy already
    set one (so a single request keeps one id across every hop), otherwise
    generates a fresh one. Always echoes it back on the response, and makes
    it available to logging via RequestIDLogFilter below.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.META.get("HTTP_X_REQUEST_ID") or uuid.uuid4().hex
        request.request_id = request_id
        token = _request_id_var.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            _request_id_var.reset(token)
        response["X-Request-Id"] = request_id
        return response


class RequestIDLogFilter:
    """Attached to logging handlers via LOGGING['filters'] so every log
    record gets a `request_id` attribute the formatter can reference —
    "-" for anything logged outside a request (startup, a management
    command, an RQ worker job not tied to an HTTP request)."""

    def filter(self, record):
        record.request_id = get_current_request_id()
        return True
