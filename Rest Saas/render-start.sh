#!/bin/sh
# Single-instance Render beta startup. Migrate once before accepting traffic.
# Larger deployments should run migrations as a separate pre-deploy step.
set -eu

python manage.py migrate --noinput
exec gunicorn core.wsgi:application \
    --bind "0.0.0.0:${PORT:-10000}" \
    --workers "${WEB_CONCURRENCY:-1}" \
    --timeout 60 \
    --access-logfile -
