"""Explicit production profile; fails startup instead of using local defaults."""
from urllib.parse import urlsplit

from .settings import *  # noqa: F403


def public_https(name):
    value = os.getenv(name, '')
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
if '*' in ALLOWED_HOSTS or not any(h and h not in ('localhost', '127.0.0.1') for h in ALLOWED_HOSTS):
    raise ImproperlyConfigured('Set explicit production ALLOWED_HOSTS; wildcard/local-only hosts are not accepted.')

FRONTEND_URL = public_https('FRONTEND_URL')
BACKEND_BASE_URL = public_https('BACKEND_BASE_URL')
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
