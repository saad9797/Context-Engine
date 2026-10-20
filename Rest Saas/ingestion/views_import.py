"""Bounded, authenticated source import without GitHub, workers or customer execution."""
import hashlib
import json
import posixpath
import re
from django.utils import timezone

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .context_packs import CODE
from .models import IngestionContext
from .privacy import SECRET_FILE, redact_text
from .project_metadata import MANIFEST
from .limits import snapshot_usage, SNAPSHOT_LIMIT

EXCLUDED = re.compile(r'(?:^|/)(?:\.git|\.venv|venv|node_modules|vendor|dist|build|coverage|__pycache__|\.next|\.nuxt|fixtures?|seeds?|migrations?)(?:/|$)', re.I)


class SourceFile(serializers.Serializer):
    path = serializers.CharField(max_length=500)
    content = serializers.CharField(trim_whitespace=False, allow_blank=True, max_length=128000)

    def validate_path(self, path):
        if path.startswith('/') or '\\' in path or ':' in path or '..' in path.split('/') or posixpath.normpath(path) != path or any(ord(c) < 32 for c in path):
            raise serializers.ValidationError('Use a safe project-relative path.')
        if SECRET_FILE.search(path) or EXCLUDED.search(path) or not (CODE.search(path) or MANIFEST.search(path)):
            raise serializers.ValidationError('Only source and supported manifests are accepted; credential and generated files are excluded.')
        return path


class ImportRequest(serializers.Serializer):
    project_name = serializers.CharField(max_length=255)
    files = SourceFile(many=True, min_length=1, max_length=220)

    def validate_files(self, files):
        names, size = set(), 0
        for item in files:
            if item['path'].casefold() in names:
                raise serializers.ValidationError('Duplicate source paths are not accepted.')
            names.add(item['path'].casefold())
            length = len(item['content'].encode('utf-8'))
            if length > 128000 or '\x00' in item['content']:
                raise serializers.ValidationError('Files must be UTF-8 text, at most 128 KB each.')
            size += length
        if size > 2000000:
            raise serializers.ValidationError('Import at most 2 MB of source. Select a focused project folder.')
        if not any(CODE.search(item['path']) for item in files):
            raise serializers.ValidationError('Select at least one source file, not just manifests.')
        return files


class ImportSnapshotView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'ingestion'

    def post(self, request):
        serializer = ImportRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        sources, redacted = [], []
        for item in values['files']:
            clean = redact_text(item['content'])
            if clean != item['content']:
                redacted.append(item['path'])
            sources.append({'path': item['path'], 'content': clean, 'size_bytes': len(clean.encode('utf-8')), 'sha': hashlib.sha256(clean.encode()).hexdigest()})
        digest = hashlib.sha256(json.dumps(sorted((s['path'], s['sha']) for s in sources)).encode()).hexdigest()
        languages = sorted({label for ext, label in [('.ts', 'TypeScript'), ('.tsx', 'TypeScript'), ('.js', 'JavaScript'), ('.jsx', 'JavaScript'), ('.py', 'Python'), ('.go', 'Go'), ('.java', 'Java'), ('.cs', 'C#'), ('.php', 'PHP'), ('.rb', 'Ruby'), ('.rs', 'Rust')] if any(s['path'].endswith(ext) for s in sources)})
        raw = {'_meta': {'project': {'project_name': values['project_name']}, 'generated_at': timezone.now().isoformat(), 'source_kind': 'folder', 'sources': {'codebase': True}}, 'codebase': {
            'repository': {'source_kind': 'folder', 'content_sha256': digest, 'full_name': values['project_name']},
            'file_tree': {'total_files': len(sources)},
            'stack': {'languages': languages}, 'key_files_by_role': {'source': sources},
            'capture': {'files_captured': len(sources), 'redacted_paths': redacted, 'scope': 'User-selected files; other project files may be absent.'}}}
        # Serialize quota checks per owner on Postgres; never evict customer data.
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if snapshot_usage(request.user) >= SNAPSHOT_LIMIT:
                return Response({'error': 'Snapshot limit reached (100). Delete an unused snapshot before importing another.'}, status=409)
            snapshot = IngestionContext.objects.create(user=request.user, project_name=values['project_name'], data=raw)
        response = Response({'id': str(snapshot.id), 'files_captured': len(sources), 'redacted_paths': redacted}, status=201)
        response['Cache-Control'] = 'no-store'
        return response
