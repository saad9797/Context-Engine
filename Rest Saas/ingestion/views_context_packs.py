from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
import django_rq
from copy import deepcopy
import posixpath
from django.db import transaction
from django.contrib.auth import get_user_model
from .models import ContextPreparation
from .preparation import dispatch_preparation, expire_preparations
from .privacy import safe_snapshot

from .context_packs import CODE, build_packs
from .privacy import SECRET_FILE
from .models import DataSourceConnection, GitHubAppInstallation, IngestionContext, IngestionJob
from .dispatch import dispatch_job
from .limits import reserve_job


class PackRequest(serializers.Serializer):
    retrieval_mode = serializers.ChoiceField(choices=['fast', 'semantic'], default='fast')
    task = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    endpoints = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    access = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    rules = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    response_shape = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    acceptance = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    follow_up = serializers.CharField(required=False, allow_blank=True, max_length=8000, default="")
    max_tokens = serializers.IntegerField(min_value=1000, max_value=32000, default=10000)
    include_paths = serializers.ListField(child=serializers.CharField(max_length=500), max_length=15, default=list)
    include_symbols = serializers.ListField(child=serializers.CharField(max_length=500), max_length=20, default=list)


class RebuildRequest(serializers.Serializer):
    include_paths = serializers.ListField(child=serializers.CharField(max_length=500), max_length=15, default=list)

    def validate_include_paths(self, paths):
        for path in paths:
            if path.startswith('/') or '\\' in path or ':' in path or posixpath.normpath(path) != path or '..' in path.split('/') or not CODE.search(path) or SECRET_FILE.search(path):
                raise serializers.ValidationError('Use repository-relative source paths without traversal, credential files or absolute paths.')
        return paths


class ContextPackView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_pack'

    def post(self, request, pk):
        serializer = PackRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        snapshot = IngestionContext.objects.filter(pk=pk, user=request.user).first()
        if snapshot is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            output = build_packs(snapshot.data, serializer.validated_data, snapshot.id, snapshot.created_at.isoformat(), use_semantic=False)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        response = Response(output)
        response['Cache-Control'] = 'no-store'
        return response


class PrepareContextView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_pack'

    def post(self, request, pk):
        serializer = PackRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            snapshot = IngestionContext.objects.select_for_update().filter(pk=pk, user=request.user).first()
            if snapshot is None:
                return Response({'error': 'Not found.'}, status=404)
            jobs = ContextPreparation.objects.filter(context__user=request.user)
            expire_preparations(jobs)
            if jobs.filter(status__in=['pending', 'running']).count() >= 2:
                return Response({'error': 'Two context preparations are already active. Wait for one to finish.'}, status=409)
            # Keep temporary exports bounded. Explicitly saved handoffs are separate.
            prior = list(jobs.filter(status__in=['succeeded', 'failed']).order_by('-created_at').values_list('id', flat=True)[9:])
            jobs.filter(id__in=prior).delete()
            job = ContextPreparation.objects.create(context=snapshot, request_data=safe_snapshot(dict(serializer.validated_data)))
        try:
            dispatch_preparation(job)
        except Exception:
            ContextPreparation.objects.filter(pk=job.pk).update(status='failed', error='Could not start preparation. Check the worker service and retry.')
            return Response({'error': 'Could not start preparation. Check the worker service and retry.'}, status=503)
        response = Response({'preparation_id': str(job.pk), 'status': 'pending'}, status=202)
        response['Cache-Control'] = 'no-store'
        return response


class PreparedContextView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_poll'

    def get(self, request, pk, preparation_id):
        jobs = ContextPreparation.objects.filter(context_id=pk, context__user=request.user)
        expire_preparations(jobs)
        job = jobs.filter(pk=preparation_id).first()
        if job is None:
            return Response({'error': 'Not found or expired. Prepare context again.'}, status=404)
        response = Response({'preparation_id': str(job.pk), 'status': job.status,
                             'progress': job.output.get('_progress', {}) if job.status != 'succeeded' else {},
                             'request': job.request_data, 'error': job.error,
                             **({'output': job.output} if job.status == 'succeeded' else {})})
        response['Cache-Control'] = 'no-store'
        return response


class RebuildSnapshotView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "ingestion"

    def post(self, request, pk):
        serializer = RebuildRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        paths = serializer.validated_data['include_paths']
        snapshot = IngestionContext.objects.filter(pk=pk, user=request.user).first()
        original = IngestionJob.objects.filter(result=snapshot, user=request.user).first() if snapshot else None
        if original is None:
            return Response({"error": "Original source selections are unavailable. Start a new snapshot from the project library."}, status=404)
        refs = deepcopy(original.connection_refs)
        if paths:
            if not refs.get('github_installation_id'):
                return Response({'error': 'Connect a repository before requesting source files.'}, status=400)
            refs['github_include_paths'] = paths
        for key, kind in (("postgres_connection_id", "postgres"), ("mysql_connection_id", "mysql"), ("mongo_connection_id", "mongo"), ("storage_connection_id", "storage")):
            if refs.get(key) and not DataSourceConnection.objects.filter(pk=refs[key], user=request.user, kind=kind).exists():
                return Response({"error": f"The original {kind} connection is no longer available. Choose a new source."}, status=400)
        if refs.get("github_installation_id") and not GitHubAppInstallation.objects.filter(installation_id=refs["github_installation_id"], user=request.user).exists():
            return Response({"error": "The original GitHub installation is no longer connected."}, status=400)
        try:
            job = reserve_job(request.user, refs)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=409)
        try:
            dispatch_job(job)
        except ValueError as exc:
            return Response({"error": str(exc), "job_id": str(job.id)}, status=503)
        return Response({"job_id": str(job.id)}, status=202)
