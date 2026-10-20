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
    # First-ish so the id exists for the entire response cycle, including
    # anything logged by exception handling further down the chain.
    "core.middleware.RequestIDMiddleware",
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
# Bounded source imports contain at most 2 MB of UTF-8; JSON escaping adds
# transport overhead. Keep the request bounded before serializer validation.
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

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
    # This service is a JSON API. Browser Accept headers must not select
    # DRF's HTML renderer, whose templates are not installed in this API.
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
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
        "context_pack": os.getenv("CONTEXT_PACK_RATE_LIMIT", "60/hour"),
        # Added 2026-09-28 (production-readiness audit) — login/register had
        # no rate limiting at all. Login is scoped tighter per-minute since
        # brute-force needs fine-grained limiting; register is scoped
        # per-hour since a legitimate user only does it once.
        "auth_login": os.getenv("AUTH_LOGIN_RATE_LIMIT", "10/min"),
        "auth_register": os.getenv("AUTH_REGISTER_RATE_LIMIT", "10/hour"),
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

# RSA keypair for browser-side transit encryption of connection credentials
# (core/transit_crypto.py) — separate from FIELD_ENCRYPTION_KEY above, which
# only covers encryption at rest. See .env.example for the generation command.
TRANSIT_PRIVATE_KEY = os.getenv("TRANSIT_PRIVATE_KEY", "").replace("\\n", "\n")
if not TRANSIT_PRIVATE_KEY and not DEBUG:
    raise ImproperlyConfigured(
        "TRANSIT_PRIVATE_KEY is required outside DEBUG. See .env.example for the generation command."
    )

# ─── SSRF egress guard ──────────────────────────────────────────────────────
# Hosts explicitly trusted to resolve to private/internal IP ranges (e.g. a
# self-hosted DB reachable only over a VPN/VPC). Everything else resolving to
# a loopback/link-local/RFC1918/metadata address is rejected before the
# ingestion engine ever dials out.
SSRF_ALLOWED_HOSTS = {
    h.strip().lower() for h in os.getenv("SSRF_ALLOWED_HOSTS", "").split(",") if h.strip()
}

# Caps the ingestion-engine Node subprocess's V8 heap (see
# ingestion/tasks.py for what this does and doesn't guard against).
INGESTION_MAX_MEMORY_MB = int(os.getenv("INGESTION_MAX_MEMORY_MB", "512"))

# ─── GitHub App ─────────────────────────────────────────────────────────────
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID", "")
GITHUB_APP_SLUG = os.getenv("GITHUB_APP_SLUG", "")
GITHUB_APP_PRIVATE_KEY = os.getenv("GITHUB_APP_PRIVATE_KEY", "").replace("\\n", "\n")
GITHUB_APP_CLIENT_ID = os.getenv("GITHUB_APP_CLIENT_ID", "")
GITHUB_APP_CLIENT_SECRET = os.getenv("GITHUB_APP_CLIENT_SECRET", "")
GITHUB_APP_WEBHOOK_SECRET = os.getenv("GITHUB_APP_WEBHOOK_SECRET", "")
GITHUB_APP_BASE_URL = os.getenv("GITHUB_APP_BASE_URL", "http://localhost:8000")

# ─── Google OAuth ("Continue with Google") ──────────────────────────────────
# From Google Cloud Console → APIs & Services → Credentials → OAuth client ID
# (type "Web application"), with an authorized redirect URI of
# {BACKEND_BASE_URL}/api/auth/google/callback/. Login is disabled (503) until
# both are set — no manifest-style self-setup flow exists for Google.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# This backend's own public URL, used to build the Google OAuth redirect_uri.
# Kept as a separate var from GITHUB_APP_BASE_URL (whose name ties it
# conceptually to the GitHub App) even though they're normally the same
# value — falls back to it so most deployments don't need to set both.
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "").strip() or GITHUB_APP_BASE_URL

# Where to send the browser back to after "Continue with GitHub"/"Continue
# with Google" completes — the provider redirects to *us* first (to exchange
# the code server-side), then we redirect on to the SPA carrying the issued
# token.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# Django's default console handler for unhandled-exception tracebacks is
# filtered to DEBUG=True only (django.utils.log.DEFAULT_LOGGING's 'console'
# handler has require_debug_true) — since this project intentionally runs
# with DEBUG=False even locally, that meant every 500 showed up in the
# runserver log as a bare status line with the actual exception logged
# nowhere. This restores console tracebacks regardless of DEBUG.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        # Attaches request_id to every record so the formatter below can
        # reference it — "-" for anything logged outside a request cycle
        # (startup, a management command, an RQ worker job).
        "request_id": {"()": "core.middleware.RequestIDLogFilter"},
    },
    "formatters": {
        "with_request_id": {
            "format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["request_id"],
            "formatter": "with_request_id",
        },
    },
    "root": {
        # Catches anything not explicitly routed below — previously there
        # was no root handler at all once the default LOGGING config was
        # overridden, meaning any logger.info()/warning() call anywhere in
        # the app (present or future) would have gone nowhere silently.
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}
