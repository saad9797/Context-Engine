"""Private saved exports. Outcomes are user reports, never measured model accuracy."""
import hashlib
import json

from django.db import transaction
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .context_packs import build_packs
from .models import IngestionContext, SavedHandoff
from .privacy import safe_snapshot
from .views_context_packs import PackRequest


def summary(saved):
    return {'id': str(saved.id), 'title': saved.title, 'digest': saved.digest, 'created_at': saved.created_at.isoformat(), 'outcome': saved.outcome}


class SavedHandoffsView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_pack'

    def get(self, request, pk):
        if not IngestionContext.objects.filter(pk=pk, user=request.user).exists():
            return Response({'error': 'Not found.'}, status=404)
        response = Response([summary(saved) for saved in SavedHandoff.objects.filter(context_id=pk).defer('output', 'request_data', 'feedback')[:30]])
        response['Cache-Control'] = 'no-store'
        return response

    def post(self, request, pk):
        serializer = PackRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = safe_snapshot(dict(serializer.validated_data))
        if not values.get('task', '').strip():
            return Response({'error': 'Describe a task before saving a handoff.'}, status=400)
        with transaction.atomic():
            snapshot = IngestionContext.objects.select_for_update().filter(pk=pk, user=request.user).first()
            if not snapshot:
                return Response({'error': 'Not found.'}, status=404)
            try:
                output = build_packs(snapshot.data, values, snapshot.id, snapshot.created_at.isoformat())
            except ValueError as exc:
                return Response({'error': str(exc)}, status=400)
            digest = hashlib.sha256(json.dumps(output['handoff'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            saved = SavedHandoff.objects.filter(context=snapshot, digest=digest).first()
            if saved is None:
                if SavedHandoff.objects.filter(context=snapshot).count() >= 30:
                    return Response({'error': 'This snapshot has 30 saved handoffs. Delete one before saving another.'}, status=409)
                saved = SavedHandoff.objects.create(context=snapshot, title=values['task'][:160], request_data=values, output=output, digest=digest)
        response = Response({**summary(saved), 'request': saved.request_data, 'output': saved.output, 'feedback': saved.feedback}, status=201)
        response['Cache-Control'] = 'no-store'
        return response


class FeedbackRequest(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=['unreviewed', 'worked', 'needed_context', 'did_not_work'])
    feedback = serializers.CharField(max_length=2000, allow_blank=True, default='')


class SavedHandoffView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'context_pack'

    def get_object(self, request, pk, handoff_id):
        return SavedHandoff.objects.filter(pk=handoff_id, context_id=pk, context__user=request.user).first()

    def get(self, request, pk, handoff_id):
        saved = self.get_object(request, pk, handoff_id)
        if not saved:
            return Response({'error': 'Not found.'}, status=404)
        response = Response({**summary(saved), 'request': saved.request_data, 'output': saved.output, 'feedback': saved.feedback})
        response['Cache-Control'] = 'no-store'
        return response

    def patch(self, request, pk, handoff_id):
        saved = self.get_object(request, pk, handoff_id)
        if not saved:
            return Response({'error': 'Not found.'}, status=404)
        serializer = FeedbackRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        saved.outcome = serializer.validated_data['outcome']
        saved.feedback = safe_snapshot(serializer.validated_data['feedback'])
        saved.save(update_fields=['outcome', 'feedback', 'updated_at'])
        response = Response(summary(saved))
        response['Cache-Control'] = 'no-store'
        return response

    def delete(self, request, pk, handoff_id):
        saved = self.get_object(request, pk, handoff_id)
        if not saved:
            return Response({'error': 'Not found.'}, status=404)
        saved.delete()
        return Response(status=204)
