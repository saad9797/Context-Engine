"""
GET /api/crypto/public-key/ — the server's RSA public key, for the frontend
to encrypt data-source credentials with (core/transit_crypto.py) before
POSTing them to /api/connections/.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from core.transit_crypto import get_public_key_pem


class TransitPublicKeyView(APIView):
    def get(self, request):
        return Response({"public_key_pem": get_public_key_pem()})
