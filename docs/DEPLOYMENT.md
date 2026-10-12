# Deployment

*How to deploy Contexa once you've made the infrastructure decisions in `REMAINING_HUMAN_ACTIONS.md`. This document is a guide with exact commands, not a record of an actual live deployment — none exists yet (see `PRODUCTION_READINESS.md` P0-8). The `Dockerfile`/`docker-compose.yml` referenced here have not been build-tested in this environment (no Docker available) — verify with a real build before depending on them.*

## What needs to run, and where

| Process | What | Notes |
|---|---|---|
| Backend web | `gunicorn core.wsgi:application` | Needs Python **and** Node.js in the same environment — it spawns the ingestion engine as a subprocess. This is why the `Dockerfile` installs both. |
| Backend worker | `python manage.py rqworker ingestion --worker-class rq.worker.SimpleWorker` | Must be a long-running process, not a serverless function — it holds a blocking Redis connection. Same image as the web process, different command. |
| Frontend | Static build (`npm run build` → `dist/`) | No server-side code — any static host works. |
| Redis | Managed instance | Backs the job queue and the throttle/cache counters. |
| Postgres | Managed instance | SQLite (the local fallback) is explicitly not safe for concurrent writes from multiple processes. |

## Backend (Django + worker)

1. **Provision Postgres and Redis** (a managed instance from your chosen platform, or any managed Postgres/Redis provider).
2. **Generate fresh production secrets** — do not reuse anything from a local `.env`:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(50))"                                    # DJANGO_SECRET_KEY
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"        # FIELD_ENCRYPTION_KEY
   python -c "from cryptography.hazmat.primitives.asymmetric import rsa; from cryptography.hazmat.primitives import serialization; k = rsa.generate_private_key(public_exponent=65537, key_size=2048); print(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode().replace(chr(10), '\\n'))"  # TRANSIT_PRIVATE_KEY
   ```
3. **Set every variable in `.env.example`** in your platform's secret manager — `DEBUG` must be `False` (it's actually hardcoded `False` in `core/settings.py` regardless, but don't rely on that alone), `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` must include your real domain(s), `DATABASE_URL`/`REDIS_URL` point at the managed instances from step 1.
4. **Build and push the image** (or let your platform build from `Rest Saas/Dockerfile` directly — Railway and Render both support "deploy from Dockerfile" natively, which sidesteps needing a container registry yourself):
   ```bash
   docker build -t contexa-backend "Rest Saas"
   ```
5. **Run migrations as an explicit, one-off step** — not automatically on container start (see the `Dockerfile`'s comment on why):
   ```bash
   docker run --env-file "Rest Saas/.env" contexa-backend python manage.py migrate
   ```
6. **Deploy two services from the same image**, differing only in command:
   - Web: `gunicorn core.wsgi:application --bind 0.0.0.0:8000 --workers 3`
   - Worker: `python manage.py rqworker ingestion --worker-class rq.worker.SimpleWorker`

   (`--worker-class rq.worker.SimpleWorker` is required on Windows, where RQ's default forking worker crashes — harmless to keep on Linux too, it just means one job at a time per worker process; scale by running more worker replicas instead of relying on RQ's own forking.)
7. **Set up the production GitHub App** and Google OAuth client per `REMAINING_HUMAN_ACTIONS.md` items 1 and 3, once you have a real domain.

## Frontend

```bash
cd "Rest Saas Frontend"
VITE_API_BASE_URL=https://your-backend-domain npm run build
```

Deploy the resulting `dist/` to any static host. If using Vercel/Netlify, set `VITE_API_BASE_URL` as a build-time environment variable in the platform's dashboard rather than hardcoding it.

## Post-deploy verification

```bash
curl https://your-backend-domain/healthz          # {"status": "ok"} — process is up
curl https://your-backend-domain/readyz            # {"status": "ok", "checks": {...}} — DB + Redis reachable
```

Then walk the real user journey once by hand (register → connect a source → run an ingestion → view the result) — see the testing guide for the exact steps.

## What this document deliberately does not do

Pick a specific hosting platform for you, or provision any account/payment/domain — those are the items in `REMAINING_HUMAN_ACTIONS.md`, and this document assumes they're already decided.
