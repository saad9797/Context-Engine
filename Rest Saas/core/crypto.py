"""
Field-level encryption for stored data-source credentials.

App-level envelope encryption (Fernet = AES-128-CBC + HMAC) keyed by
FIELD_ENCRYPTION_KEY. This is the pragmatic v1 for a deployment without a
cloud KMS: the key lives in an env var / secrets manager, never in the
database next to the ciphertext it protects. Migrating to a real KMS later
(AWS KMS, GCP KMS) only means changing `_fernet()` to unwrap a data key via
the KMS SDK instead of reading FIELD_ENCRYPTION_KEY directly — the stored
column stays an opaque text blob either way.
"""

import json

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _fernet():
    key = settings.FIELD_ENCRYPTION_KEY
    if not key:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEY is not set — cannot encrypt/decrypt stored "
            "credentials. See .env.example."
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_json(data: dict) -> str:
    """Serialize `data` to JSON and return an opaque encrypted token (str)."""
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    return _fernet().encrypt(payload).decode("ascii")


def decrypt_json(token: str) -> dict:
    """Inverse of encrypt_json. Raises ValueError if the token is invalid."""
    try:
        payload = _fernet().decrypt(token.encode("ascii"))
    except InvalidToken as e:
        raise ValueError("Stored credential could not be decrypted (bad key or corrupt data).") from e
    return json.loads(payload.decode("utf-8"))
