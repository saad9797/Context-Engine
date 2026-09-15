"""
Ingestion Engine views.

Endpoints
---------
POST   /api/ingestion/run/                     — enqueue an async ingestion job (202 + job id)
GET    /api/ingestion/jobs/<uuid:pk>/          — poll a job's status/progress
GET    /api/ingestion/                         — list saved contexts for the caller
GET    /api/ingestion/<uuid:pk>/                — retrieve a full saved context (owner only)
GET    /api/ingestion/<uuid:pk>/claude-context/ — retrieve the distilled, LLM-ready context
GET    /api/connections/                       — list the caller's data-source connections
POST   /api/connections/                       — create one (credentials encrypted at rest)
DELETE /api/connections/<uuid:pk>/             — delete one
GET    /api/audit-log/                         — the caller's own audit trail

All ingestion/connection/job endpoints are scoped to `request.user` — a
non-owned pk always 404s (never 403), so a UUID can't be used to probe for
the existence of someone else's data.
"""

import django_rq
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import freshness, scoping
from .audit import log_action
from .models import AuditLogEntry, DataSourceConnection, IngestionContext, IngestionJob
from .serializers import (
    AuditLogEntrySerializer,
    DataSourceConnectionSerializer,
    IngestionJobCreateSerializer,
    IngestionJobSerializer,
)
from .tasks import run_ingestion_job


class IngestionJobCreateView(APIView):
    """
    POST /api/ingestion/run/

    Body: references to previously-created connections/installation, e.g.
    {
        "postgres_connection_id": "<uuid>",
        "storage_connection_id": "<uuid>",
        "github_installation_id": 12345678,
        "github_owner": "acme-corp", "github_repo": "backend-api", "github_branch": "main",
        "meta": {"project_name": "My App"}
    }

    Returns 202 immediately with a job id — the actual inspection runs on an
    RQ worker, not this request's thread. Poll
    GET /api/ingestion/jobs/<job_id>/ for progress/result.
    """

    throttle_scope = "ingestion"

    def post(self, request):
        serializer = IngestionJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refs = dict(serializer.validated_data)
        for key in ("postgres_connection_id", "mongo_connection_id", "storage_connection_id"):
            if refs.get(key):
                refs[key] = str(refs[key])

        # Ownership is checked here, not just at execution time — failing
        # fast beats enqueueing a job that's guaranteed to error in the worker.
        for field, kind in (
            ("postgres_connection_id", "postgres"),
            ("mongo_connection_id", "mongo"),
            ("storage_connection_id", "storage"),
        ):
            conn_id = refs.get(field)
            if conn_id and not DataSourceConnection.objects.filter(
                id=conn_id, user=request.user, kind=kind
            ).exists():
                return Response(
                    {"error": f"{field} does not reference a {kind} connection you own."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        installation_id = refs.get("github_installation_id")
        if installation_id and not request.user.github_installations.filter(
            installation_id=installation_id
        ).exists():
            return Response(
                {"error": "github_installation_id does not belong to you."},
                status=status.HTTP_404_NOT_FOUND,
            )

        job = IngestionJob.objects.create(user=request.user, connection_refs=refs)
        rq_job = django_rq.get_queue("ingestion").enqueue(run_ingestion_job, str(job.id))
        job.rq_job_id = rq_job.id
        job.save(update_fields=["rq_job_id"])

        log_action(
            request.user,
            "ingestion.run",
            job,
            metadata={k: v for k, v in refs.items() if k != "meta"},
            request=request,
        )

        return Response(
            {
                "job_id": str(job.id),
                "status": job.status,
                "status_url": f"/api/ingestion/jobs/{job.id}/",
            },
            status=status.HTTP_202_ACCEPTED,
        )


class IngestionJobStatusView(APIView):
    """GET /api/ingestion/jobs/<uuid:pk>/ — poll status/progress of one job."""

    def get(self, request, pk):
        job = IngestionJob.objects.filter(id=pk, user=request.user).first()
        if job is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(IngestionJobSerializer(job).data)


class IngestionResultView(APIView):
    """GET /api/ingestion/<uuid:pk>/  —  retrieve a full saved context (owner only)."""

    def get(self, request, pk):
        data = (
            IngestionContext.objects.filter(id=pk, user=request.user)
            .values_list("data", flat=True)
            .first()
        )
        if data is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(data)


class IngestionClaudeContextView(APIView):
    """
    GET /api/ingestion/<uuid:pk>/claude-context/
    GET /api/ingestion/<uuid:pk>/claude-context/?task=<free text>

    Returns only the distilled `claude_context` slice of a saved ingestion —
    schema, relationships, storage patterns, codebase conventions, and the
    unified architecture graph — the payload meant to actually be handed to
    Claude when generating code against this project.

    Falls back to computing it on the fly for contexts saved before this
    field existed, so older saved records don't 404 or 500.

    With `?task=...` (roadmap.md P2), trims the context down to what looks
    relevant to that task via keyword matching plus one hop of architecture-
    graph expansion — see ingestion/scoping.py. Falls back to the full
    context (with `_scoping.matched: false`) if the task yields no usable
    keywords or matches nothing, rather than risk silently handing back an
    empty or misleadingly narrow context.
    """

    def get(self, request, pk):
        data = (
            IngestionContext.objects.filter(id=pk, user=request.user)
            .values_list("data", flat=True)
            .first()
        )
        if data is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        claude_context = data.get("claude_context")
        if claude_context is None:
            claude_context = _build_fallback_claude_context(data)

        if claude_context is None:
            return Response(
                {
                    "error": (
                        "This context was saved before claude_context was introduced. "
                        "Re-run ingestion to regenerate it."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        task = request.query_params.get("task", "").strip()
        if not task:
            return Response(claude_context)

        full_tokens = scoping.approx_tokens(claude_context)
        scoped = scoping.build_scoped_context(claude_context, task)
        if scoped is None:
            result = dict(claude_context)
            result["_scoping"] = {
                "task": task,
                "matched": False,
                "note": "No entities matched this task description closely enough — returning the full context instead of an empty or misleading scope.",
            }
            return Response(result)

        scoped_tokens = scoping.approx_tokens(scoped)
        scoped["_scoping"] = {
            "task": task,
            "matched": True,
            "approx_tokens_full": full_tokens,
            "approx_tokens_scoped": scoped_tokens,
            "reduction_pct": round((1 - scoped_tokens / full_tokens) * 100) if full_tokens else 0,
        }
        return Response(scoped)


class IngestionFreshnessView(APIView):
    """
    GET /api/ingestion/<uuid:pk>/freshness/

    Reports how long ago a context was generated, and — when the context
    has a stored fingerprint and the job that produced it referenced live
    connections the caller still owns — whether the underlying source has
    actually drifted since then (roadmap.md P3), via a fresh, deliberately
    cheap re-check (schema shape for Postgres, collection existence for
    Mongo, latest commit sha for GitHub — see ingestion/freshness.py).

    Falls back to an age-only report (`checked_live: false`) for contexts
    saved before schema_fingerprint existed, or if the originating job/
    connections can no longer be found (e.g. the connection was deleted).
    A live check that fails to reach every referenced source at all (not
    just "no drift detected") is reported as `check_error`, not silently
    treated as drift-free.
    """

    def get(self, request, pk):
        context = IngestionContext.objects.filter(id=pk, user=request.user).first()
        if context is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        age_seconds = (timezone.now() - context.created_at).total_seconds()
        base = {
            "generated_at": context.created_at,
            "age_hours": round(age_seconds / 3600, 1),
        }

        if not context.schema_fingerprint:
            return Response({**base, "checked_live": False, "note": "This context predates drift detection — re-run ingestion to enable it."})

        job = IngestionJob.objects.filter(result_id=context.id, user=request.user).first()
        if job is None:
            return Response({**base, "checked_live": False, "note": "Original ingestion job not found — can't re-check live sources."})

        try:
            live, source_errors = freshness.check_live_fingerprint(job.connection_refs or {}, request.user)
        except freshness.FreshnessCheckError as e:
            return Response({**base, "checked_live": False, "check_error": str(e)})

        details = freshness.compare_fingerprints(context.schema_fingerprint, live)
        return Response({
            **base,
            "checked_live": True,
            "drifted": any(v is True for v in details.values()),
            "details": details,
            "source_errors": source_errors or None,
        })


class IngestionListView(APIView):
    """
    GET /api/ingestion/  —  list saved ingestion contexts for the current user.

    Returns summary metadata only (sources detected, table/collection counts) —
    not the full raw context, which can run into hundreds of KB per record once
    blob listings and sample rows are included. Fetch a specific context's full
    payload via GET /<pk>/ or its distilled form via GET /<pk>/claude-context/.
    """

    def get(self, request):
        contexts = (
            IngestionContext.objects.filter(user=request.user)
            .order_by("-created_at")
            .values("id", "project_name", "data", "created_at")
        )
        return Response([_summarise(context) for context in contexts])


class DataSourceConnectionListCreateView(APIView):
    """
    GET  /api/connections/  — list the caller's connections (config omitted)
    POST /api/connections/  — create one; credentials are encrypted at rest
                               and never echoed back in any response.
    """

    def get(self, request):
        connections = DataSourceConnection.objects.filter(user=request.user)
        return Response(DataSourceConnectionSerializer(connections, many=True).data)

    def post(self, request):
        serializer = DataSourceConnectionSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        connection = serializer.save()
        log_action(
            request.user, "connection.create", connection, metadata={"kind": connection.kind}, request=request
        )
        return Response(DataSourceConnectionSerializer(connection).data, status=status.HTTP_201_CREATED)


class DataSourceConnectionDetailView(APIView):
    """DELETE /api/connections/<uuid:pk>/"""

    def delete(self, request, pk):
        connection = DataSourceConnection.objects.filter(user=request.user, id=pk).first()
        if connection is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        log_action(
            request.user, "connection.delete", connection, metadata={"kind": connection.kind}, request=request
        )
        connection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogListView(APIView):
    """GET /api/audit-log/ — the caller's own audit trail, most recent first."""

    def get(self, request):
        entries = AuditLogEntry.objects.filter(user=request.user)[:200]
        return Response(AuditLogEntrySerializer(entries, many=True).data)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _summarise(context_row):
    """Reduce one saved context row to list-view-safe summary fields."""
    data = context_row["data"] or {}
    meta = data.get("_meta", {})
    database = data.get("database") or {}
    mongo_database = data.get("mongo_database") or {}
    object_storage = data.get("object_storage")
    codebase = data.get("codebase") or {}

    return {
        "id": str(context_row["id"]),
        "project_name": context_row["project_name"],
        "created_at": context_row["created_at"],
        "sources": meta.get("sources"),
        "errors": meta.get("errors"),
        "summary": {
            "postgres_tables": database.get("metadata", {}).get("total_tables"),
            "mongo_collections": mongo_database.get("metadata", {}).get("total_collections"),
            # None (not "0 buckets") when storage wasn't part of this run at
            # all — otherwise it's indistinguishable from a run that legitimately
            # found zero buckets.
            "storage_containers": len(object_storage.get("containers", [])) if object_storage else None,
            "repository": (codebase.get("repository") or {}).get("full_name"),
        },
    }


def _build_fallback_claude_context(raw_data):
    """Build a compact, LLM-friendly summary for older contexts without a distilled payload."""
    if not isinstance(raw_data, dict):
        return None

    meta = raw_data.get("_meta") or {}
    database = raw_data.get("database") or {}
    mongo_database = raw_data.get("mongo_database") or {}
    object_storage = raw_data.get("object_storage") or {}
    codebase = raw_data.get("codebase") or {}

    fallback = {
        "project": meta.get("project", {}),
        "generated_at": meta.get("generated_at"),
        "sources": meta.get("sources"),
        "database": None,
        "mongo_database": None,
        "object_storage": None,
        "codebase": None,
        "architecture_graph": raw_data.get("architecture_graph"),
        "api_generation_hints": raw_data.get("api_generation_hints") or {},
    }

    if database:
        fallback["database"] = {
            "dialect": "postgres",
            "database_name": database.get("metadata", {}).get("database_name"),
            "schemas": database.get("metadata", {}).get("schemas", []),
            "tables": [
                {
                    "schema": table.get("schema"),
                    "name": table.get("name"),
                    "columns": [
                        {
                            "name": column.get("name"),
                            "type": column.get("type"),
                            "nullable": column.get("nullable"),
                            "is_storage_reference": column.get("is_storage_reference"),
                        }
                        for column in (table.get("columns") or [])
                    ],
                    "primary_keys": table.get("primary_keys", []),
                    "foreign_keys": table.get("foreign_keys", []),
                    "estimated_rows": table.get("estimated_rows"),
                }
                for table in (database.get("tables") or [])
            ],
        }

    if mongo_database:
        fallback["mongo_database"] = {
            "dialect": "mongodb",
            "scan_mode": mongo_database.get("scan_mode"),
            "database_name": mongo_database.get("metadata", {}).get("database_name"),
            "scanned_databases": mongo_database.get("metadata", {}).get("scanned_databases"),
            "collections": mongo_database.get("collections", []),
        }

    if object_storage:
        fallback["object_storage"] = {
            "provider": object_storage.get("provider"),
            "containers": object_storage.get("containers", []),
        }

    if codebase:
        fallback["codebase"] = {
            "repository": codebase.get("repository") or {},
            "stack": codebase.get("stack"),
            "file_tree": codebase.get("file_tree") or {},
        }

    return fallback
