"""Official Claude Code prefill. The only public resource is an expiring,
signed capability to one prompt, with no Contexa account credentials in it.
Claude owns the login gate and final submission.
"""
import json
import re
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import HttpResponse
from django.urls import reverse
from django.utils import timezone
from django.views import View
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.crypto import encrypt_json, decrypt_json
from .models import ClaudeLaunch, IngestionContext
from .privacy import safe_snapshot

TTL = 15 * 60
SALT = 'contexa.claude.prompt.v1'
PREFACE = 'Implement the request using this self-contained context. Review context_gaps and ask for missing contracts first.'


class LaunchRequest(serializers.Serializer):
    handoff = serializers.JSONField()

    def validate_handoff(self, value):
        if not isinstance(value, dict) or not isinstance(value.get('request'), dict) or not isinstance(value['request'].get('task'), str) or not value['request']['task'].strip():
            raise serializers.ValidationError('Prepare a self-contained handoff with a task first.')
        if len(json.dumps(value).encode('utf-8')) > 1024 * 1024:
            raise serializers.ValidationError('The handoff exceeds 1 MB. Prepare a smaller context.')
        return safe_snapshot(value)


class ClaudeLaunchView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_pack'

    def post(self, request, pk):
        serializer = LaunchRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        base = settings.BACKEND_BASE_URL.rstrip('/') or request.build_absolute_uri('/').rstrip('/')
        parsed = urlsplit(base)
        # Claude must fetch the prompt from its origin; a localhost/private
        # deployment cannot reliably service this cross-site browser fetch.
        if parsed.scheme != 'https' or not parsed.hostname or parsed.hostname in ('localhost', '127.0.0.1', '::1'):
            return Response({'error': 'Opening Claude requires a public HTTPS backend. You can still copy or download this handoff.'}, status=409)
        with transaction.atomic():
            snapshot = IngestionContext.objects.select_for_update().filter(pk=pk, user=request.user).first()
            if snapshot is None:
                return Response({'error': 'Not found.'}, status=404)
            now = timezone.now()
            ClaudeLaunch.objects.filter(expires_at__lte=now).delete()
            if ClaudeLaunch.objects.filter(context__user=request.user).count() >= 20:
                return Response({'error': 'Twenty Claude handoffs are active. Revoke an earlier handoff or wait 15 minutes.'}, status=429)
            handoff = serializer.validated_data['handoff']
            prompt = PREFACE + '\n\n' + json.dumps(handoff, ensure_ascii=False, separators=(',', ':'))
            launch = ClaudeLaunch.objects.create(context=snapshot, expires_at=now + timedelta(seconds=TTL), encrypted_prompt=encrypt_json({'prompt': prompt}))
        token = signing.dumps(str(launch.id), salt=SALT)
        prompt_url = base + reverse('claude-prompt', kwargs={'launch_id': launch.id}) + '?' + urlencode({'token': token})
        query = {'prompt_url': prompt_url}
        repository = ((snapshot.data.get('codebase') or {}).get('repository') or {}).get('full_name', '')
        if isinstance(repository, str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
            query['repositories'] = repository
        url = 'https://claude.ai/code?' + urlencode(query)
        response = Response({'id': str(launch.id), 'url': url, 'expires_at': launch.expires_at.isoformat()}, status=201)
        response['Cache-Control'] = 'no-store'
        return response


class ClaudeLaunchDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, launch_id):
        deleted, _ = ClaudeLaunch.objects.filter(pk=launch_id, context_id=pk, context__user=request.user).delete()
        return Response(status=204) if deleted else Response({'error': 'Not found.'}, status=404)


class ClaudePromptView(View):
    # A plain-text fetch endpoint, independent of DRF content negotiation.
    # Access is controlled solely by the signed, expiring capability below.
    def dispatch(self, request, *args, **kwargs):
        response = super().dispatch(request, *args, **kwargs)
        # Only this capability endpoint accepts Claude's browser origin.
        response['Access-Control-Allow-Origin'] = 'https://claude.ai'
        response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        response['Cache-Control'] = 'no-store, private, max-age=0'
        response['Referrer-Policy'] = 'no-referrer'
        response['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    def get(self, request, launch_id):
        try:
            value = signing.loads(request.GET.get('token', ''), salt=SALT, max_age=TTL)
            if value != str(launch_id):
                raise signing.BadSignature('Wrong prompt')
        except signing.BadSignature:
            return HttpResponse('Handoff unavailable or expired. Return to Contexa and open Claude again.', status=404, content_type='text/plain')
        launch = ClaudeLaunch.objects.filter(pk=launch_id, expires_at__gt=timezone.now()).first()
        if launch is None:
            return HttpResponse('Handoff unavailable or expired. Return to Contexa and open Claude again.', status=404, content_type='text/plain')
        return HttpResponse(decrypt_json(launch.encrypted_prompt)['prompt'], content_type='text/plain; charset=utf-8')
