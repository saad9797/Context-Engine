from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
import django_rq
from copy import deepcopy

from .context_packs import build_packs
from .models import DataSourceConnection, GitHubAppInstallation, IngestionContext, IngestionJob
from .tasks import run_ingestion_job


class PackRequest(serializers.Serializer):
    task = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    endpoints = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    access = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    rules = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    response_shape = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    max_tokens = serializers.IntegerField(min_value=1000, max_value=32000, default=4000)
    include_paths = serializers.ListField(child=serializers.CharField(max_length=500), max_length=15, default=list)


class ContextPackView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        serializer = PackRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        snapshot = IngestionContext.objects.filter(pk=pk, user=request.user).first()
        if snapshot is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            output = build_packs(snapshot.data, serializer.validated_data, snapshot.id, snapshot.created_at.isoformat())
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(output)


class RebuildSnapshotView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "ingestion"

    def post(self, request, pk):
        snapshot = IngestionContext.objects.filter(pk=pk, user=request.user).first()
        original = IngestionJob.objects.filter(result=snapshot, user=request.user).first() if snapshot else None
        if original is None:
            return Response({"error": "Original source selections are unavailable. Start a new snapshot from the project library."}, status=404)
        refs = deepcopy(original.connection_refs)
        for key, kind in (("postgres_connection_id", "postgres"), ("mysql_connection_id", "mysql"), ("mongo_connection_id", "mongo"), ("storage_connection_id", "storage")):
            if refs.get(key) and not DataSourceConnection.objects.filter(pk=refs[key], user=request.user, kind=kind).exists():
                return Response({"error": f"The original {kind} connection is no longer available. Choose a new source."}, status=400)
        if refs.get("github_installation_id") and not GitHubAppInstallation.objects.filter(installation_id=refs["github_installation_id"], user=request.user).exists():
            return Response({"error": "The original GitHub installation is no longer connected."}, status=400)
        job = IngestionJob.objects.create(user=request.user, connection_refs=refs)
        try:
            queued = django_rq.get_queue("ingestion").enqueue(run_ingestion_job, str(job.id))
        except Exception:
            job.status = "failed"
            job.error = "Could not queue the snapshot. Try again when the worker service is available."
            job.save(update_fields=["status", "error"])
            return Response({"error": job.error}, status=503)
        job.rq_job_id = queued.id
        job.save(update_fields=["rq_job_id"])
        return Response({"job_id": str(job.id)}, status=202)
