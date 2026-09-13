import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

# DEBUG = os.getenv("DEBUG", "False") == "True"
DEBUG = False

ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# django-cors-headers — lets a browser on a different origin/port (the
# frontend dev server) call this API at all. Without this, the browser's
# preflight OPTIONS request never gets a CORS header back and every request
# is blocked client-side before Authorization is even checked. Defaults
# cover Vite (5173) and CRA (3000); override via CORS_ALLOWED_ORIGINS in .env.
CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
).split(",")


INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "django_rq",
    "accounts",
    "ingestion",
]


MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "core.urls"

# Postgres via DATABASE_URL (e.g. postgres://user:pass@host:5432/dbname) in
# any real deployment — SQLite is a dev-only fallback for when DATABASE_URL
# isn't set, since it can't safely handle concurrent writes from multiple
# gunicorn/RQ worker processes.
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    DATABASES = {"default": dj_database_url.parse(DATABASE_URL, conn_max_age=600)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django's four standard validators aren't applied by default unless a
# project's settings.py explicitly lists them (that's the startproject
# template's doing, not a framework default) — without this, RegisterView's
# validate_password() call silently accepts any password, three-character
# ones included.
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

WSGI_APPLICATION = "core.wsgi.application"

# Redis backs the async ingestion job queue (Django-RQ) and, via
# django-redis, the cache DRF's throttle classes use to count requests — a
# process-local cache would under-count (and thus under-throttle) once you
# run more than one Django worker process.
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

RQ_QUEUES = {
    "ingestion": {
        "URL": REDIS_URL,
        "DEFAULT_TIMEOUT": 900,
    }
}

# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # One ingestion run spawns a subprocess against someone else's
        # database/repo — this is the knob that stops one tenant's runaway
        # script (or bug) from saturating the Node runner pool.
        "ingestion": os.getenv("INGESTION_RATE_LIMIT", "20/hour"),
    },
}

# ─── Field-level credential encryption ──────────────────────────────────────
# App-level envelope encryption (Fernet/AES) for stored data-source
# credentials (DataSourceConnection.encrypted_config). Not a substitute for a
# real KMS at larger scale, but the encrypted TextField schema doesn't need
# to change when you swap one in later — only core/crypto.py's key retrieval
# does.
FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY")
if not FIELD_ENCRYPTION_KEY and not DEBUG:
    raise ImproperlyConfigured(
        "FIELD_ENCRYPTION_KEY is required outside DEBUG. Generate one with: "
        "python -c \"from cryptography.fernet import Fernet; "
        "print(Fernet.generate_key().decode())\""
    )

# ─── SSRF egress guard ──────────────────────────────────────────────────────
# Hosts explicitly trusted to resolve to private/internal IP ranges (e.g. a
# self-hosted DB reachable only over a VPN/VPC). Everything else resolving to
# a loopback/link-local/RFC1918/metadata address is rejected before the
# ingestion engine ever dials out.
SSRF_ALLOWED_HOSTS = {
    h.strip().lower() for h in os.getenv("SSRF_ALLOWED_HOSTS", "").split(",") if h.strip()
}

# ─── GitHub App ─────────────────────────────────────────────────────────────
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID", "")
GITHUB_APP_SLUG = os.getenv("GITHUB_APP_SLUG", "")
GITHUB_APP_PRIVATE_KEY = os.getenv("GITHUB_APP_PRIVATE_KEY", "").replace("\\n", "\n")
GITHUB_APP_CLIENT_ID = os.getenv("GITHUB_APP_CLIENT_ID", "")
GITHUB_APP_CLIENT_SECRET = os.getenv("GITHUB_APP_CLIENT_SECRET", "")
GITHUB_APP_WEBHOOK_SECRET = os.getenv("GITHUB_APP_WEBHOOK_SECRET", "")
GITHUB_APP_BASE_URL = os.getenv("GITHUB_APP_BASE_URL", "http://localhost:8000")

# Where to send the browser back to after "Continue with GitHub" completes —
# GitHub redirects to *us* first (to exchange the code server-side), then we
# redirect on to the SPA carrying the issued token.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
