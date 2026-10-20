# One image, two roles (web vs worker — see docker-compose.yml / DEPLOYMENT.md
# for the two different CMDs run from it). Needs both Python (Django) and
# Node.js (the ingestion engine, spawned as a subprocess at runtime by
# ingestion/tasks.py) in the same runtime environment — that's the reason
# this exists instead of relying on a platform's native Python buildpack,
# which wouldn't have `node` on PATH.
#
# NOT build-tested in the development environment this was written in
# (Docker is not installed there) — written to standard, verifiable
# patterns, but treat the first real build (locally or in CI) as the actual
# verification, not this comment.

FROM python:3.11-slim

# --- Node.js 22.x, matching CI and the ingestion drivers ---
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python deps first (better layer caching than copying the whole repo first) ---
COPY requirements.txt requirements-build.txt ./
RUN python -m pip install --no-cache-dir -r requirements-build.txt \
    && python -m pip install --no-cache-dir -r requirements.txt

# --- Node deps for the ingestion engine ---
COPY ingestion/ingestion-engine/package.json ingestion/ingestion-engine/package-lock.json* ingestion/ingestion-engine/
RUN cd ingestion/ingestion-engine && npm ci --omit=dev

# --- Application code ---
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app
COPY --chown=app:app . .
USER app

ENV PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=core.settings

EXPOSE 8000

# Default (web) — override the command to `python manage.py rqworker ingestion`
# for the worker service. No entrypoint script: migrations are run as an
# explicit deploy step (see DEPLOYMENT.md), not automatically on container
# start, so a bad migration doesn't get silently applied by an autoscaled
# replica restarting.
CMD ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
