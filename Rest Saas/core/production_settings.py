"""Explicit production profile; fails startup instead of using local defaults."""
from urllib.parse import urlsplit
import re

from .settings import *  # noqa: F403


def public_https(name, fallback=''):
    value = os.getenv(name, '').strip() or fallback
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.hostname in ('localhost', '127.0.0.1'):
        raise ImproperlyConfigured(f'{name} must be your public HTTPS URL in production.')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ImproperlyConfigured(f'{name} must not contain credentials, query or fragment.')
    return value.rstrip('/')


if not DATABASE_URL or DATABASES['default']['ENGINE'] != 'django.db.backends.postgresql':
    raise ImproperlyConfigured('Production requires PostgreSQL through DATABASE_URL; SQLite is development-only.')
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith('replace-'):
    raise ImproperlyConfigured('Use a freshly generated DJANGO_SECRET_KEY of at least 50 characters.')

# Render supplies this before the first deploy: no manually guessed domain
# or wildcard hosts are needed. Explicit custom-domain settings still win.
render_host = os.getenv('RENDER_EXTERNAL_HOSTNAME', '').strip().lower() if os.getenv('RENDER') == 'true' else ''
if render_host:
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com', render_host):
        raise ImproperlyConfigured('RENDER_EXTERNAL_HOSTNAME must be a valid onrender.com hostname.')
    ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, render_host]))
if '*' in ALLOWED_HOSTS or not any(h and h not in ('localhost', '127.0.0.1') for h in ALLOWED_HOSTS):
    raise ImproperlyConfigured('Set explicit production ALLOWED_HOSTS; wildcard/local-only hosts are not accepted.')

BACKEND_BASE_URL = public_https('BACKEND_BASE_URL', 'https://' + render_host if render_host else '')
# Until the frontend exists, keep redirects on this backend's own origin.
# Set FRONTEND_URL to the real website before enabling social login.
FRONTEND_URL = public_https('FRONTEND_URL', BACKEND_BASE_URL if render_host else '')
if render_host and not os.getenv('CORS_ALLOWED_ORIGINS', '').strip():
    CORS_ALLOWED_ORIGINS = [FRONTEND_URL]
if any(urlsplit(origin).scheme != 'https' for origin in CORS_ALLOWED_ORIGINS):
    raise ImproperlyConfigured('Set CORS_ALLOWED_ORIGINS to your HTTPS frontend origin(s).')
GITHUB_APP_BASE_URL = BACKEND_BASE_URL
DEBUG = False
SECURE_SSL_REDIRECT = True
SECURE_REDIRECT_EXEMPT = [r'^healthz/?$', r'^readyz/?$']
# Enable only behind a proxy that removes incoming X-Forwarded-Proto and sets
# its own value. The deployment guide calls this requirement out explicitly.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
MIDDLEWARE = [*MIDDLEWARE, 'django.middleware.clickjacking.XFrameOptionsMiddleware']
X_FRAME_OPTIONS = 'DENY'
