# Run snapshots without a separate worker

Set `INGESTION_EXECUTION_MODE=inline` in the backend Render environment and redeploy both backend and frontend. No worker service or local computer is needed. Keep your existing Redis and PostgreSQL settings: Redis still supports throttling and a shared capacity lock.

Use Docker Command `sh /app/render-start.sh`. The updated script runs Gunicorn with two threads and a 90-second server timeout. The Docker default command also has these limits. If you supply another Gunicorn command, include `--threads 2 --timeout 90`.

New snapshots and rebuilds run during the HTTP request. The form displays a building message until the saved job is returned; stage-by-stage polling remains available in worker mode. One backend snapshot runs at a time across the deployment; another request gets a clear retry message rather than an unconsumed queue entry. Node receives a 45-second remaining runtime budget (including source setup time) and a 128 MB V8 heap limit. This is not a total process memory cap or an absolute HTTP deadline: connection setup, output handling and saving also take time. Larger projects can fail; use fewer sources, folder import, or worker mode.

Free Render services can sleep or restart. Requests may fail during a restart; interrupted inline jobs become failed on the next status check or build reservation after two minutes. Do not describe this mode as a durable background queue.

## Existing queued jobs

Changing mode affects new requests only. Old jobs already waiting for a worker will not automatically run. Before enabling inline mode, with no ingestion worker running, you can deliberately mark the old pending builds failed in the Render shell:

```sh
python manage.py shell -c 'from ingestion.models import IngestionJob; from django.utils import timezone; print(IngestionJob.objects.filter(status="pending").update(status="failed", error="Worker was not available. Start a new snapshot.", finished_at=timezone.now()))'
```

This clears pending builds for all users. Do not run this cleanup while workers are consuming the queue. It does not delete snapshots or connections. Retry from the new snapshot form afterward. If your plan does not provide a shell, temporarily run this command after migrations in the startup script for one deployment, then remove it.

## Switch to workers later

Set `INGESTION_EXECUTION_MODE=worker` on the web service, deploy an RQ worker with the same backend image, database, encryption keys, Redis and other backend secrets, and run `python manage.py rqworker ingestion`. Redeploy the web service. Existing worker functionality and its 600-second runner limit remain; no commenting or code changes are necessary. Old inline requests cannot be resumed by the queue.

## Smoke test

Start a small live-source snapshot: the form shows the building message, then the saved result appears. Verify it in the project library. Rebuild it from connected sources. Try another account while one build runs: it should receive the capacity message. Verify invalid source credentials show an error rather than an endless queued build. Switch to worker mode with a worker running and confirm that the progress page updates through stages. Never run tests against your production database.
