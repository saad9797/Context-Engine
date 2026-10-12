# Local Development

Full detail lives in each subproject's own README — this is the quick-start that ties them together.

## 1. Backend

```bash
cd "Rest Saas"
py -3 -m venv .venv && .venv\Scripts\Activate.ps1     # Windows
python3 -m venv .venv && source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
copy .env.example .env    # then fill in DJANGO_SECRET_KEY, FIELD_ENCRYPTION_KEY, TRANSIT_PRIVATE_KEY
python manage.py migrate
```

## 2. Redis (required — nothing in the ingestion flow works without it)

```bash
docker run -p 6379:6379 redis     # or WSL2 redis-server, or Memurai on native Windows
```

## 3. Ingestion engine dependencies

```bash
cd "Rest Saas/ingestion/ingestion-engine"
npm install
cd ../../..
```

## 4. Start the three backend processes (separate terminals)

```bash
cd "Rest Saas"
python manage.py runserver
python manage.py rqworker ingestion --worker-class rq.worker.SimpleWorker   # --worker-class required on Windows
```

## 5. Frontend

```bash
cd "Rest Saas Frontend"
npm install
npm run dev
```

Opens on `http://localhost:5173`.

## 6. (Optional) GitHub App / Google OAuth

Only needed to test "Continue with GitHub"/"Continue with Google" — username/password auth works without either. See `Rest Saas/README.md` step 8 and `docs/REMAINING_HUMAN_ACTIONS.md` item 1.

## 7. Run the test suite

```bash
cd "Rest Saas"
pip install -r requirements-dev.txt
pytest
```

## Sanity check everything is up

```bash
curl http://localhost:8000/healthz    # {"status": "ok"}
curl http://localhost:8000/readyz     # {"status": "ok", "checks": {"database": {"ok": true}, "redis": {"ok": true}}}
```

If `/readyz` reports `redis.ok: false`, step 2 isn't actually running/reachable — this is the single most common local-dev failure mode in this project's history (see `docs/TROUBLESHOOTING.md`).

## Docker alternative

`docker-compose.yml` at the repo root brings up Redis + backend + worker in one command (`docker compose up`) — the frontend still runs separately via `npm run dev`. Not build-tested in the environment this was written in; see the file's own header comment.
