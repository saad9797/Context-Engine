"""
Browser-side transit encryption for data-source credentials.

Separate from core/crypto.py (which handles at-rest encryption of already-
received credentials). This module exists so the credential is encrypted
*in the browser*, before it ever crosses the network, rather than relying on
TLS alone — the frontend fetches this server's RSA public key from
GET /api/crypto/public-key/, generates a fresh AES-256-GCM key per
submission, encrypts the credential payload with it, wraps that AES key with
the RSA public key (RSA-OAEP/SHA-256), and sends the three encrypted pieces.
decrypt_transit_payload() reverses that: unwrap the AES key with the private
key here, then decrypt the payload — the plaintext exists server-side only
for the instant it takes to hand off to DataSourceConnection.set_config(),
which immediately re-encrypts it for storage.

This does not (and cannot) make the credential invisible to this server —
the ingestion engine has to use it to actually connect to your database.
What it adds is a second, independent encryption layer that doesn't depend
on TLS termination being correctly configured everywhere between the
browser and this process (a misconfigured proxy, a debug log of raw request
bodies, etc. would otherwise see plaintext).
"""

import base64
import json

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

_OAEP_PADDING = padding.OAEP(
    mgf=padding.MGF1(algorithm=hashes.SHA256()),
    algorithm=hashes.SHA256(),
    label=None,
)


class TransitDecryptionError(ValueError):
    pass


def _load_private_key():
    pem = settings.TRANSIT_PRIVATE_KEY
    if not pem:
        raise ImproperlyConfigured(
            "TRANSIT_PRIVATE_KEY is not set. Generate one with the command in .env.example."
        )
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ImproperlyConfigured("TRANSIT_PRIVATE_KEY must be an RSA private key.")
    return key


def get_public_key_pem() -> str:
    """SubjectPublicKeyInfo PEM — safe to hand to any authenticated caller."""
    public_key = _load_private_key().public_key()
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def decrypt_transit_payload(payload: dict) -> dict:
    """
    `payload` is {"encrypted_key": b64, "iv": b64, "ciphertext": b64} as
    produced by the frontend's Web Crypto calls (see
    src/api/transitCrypto.js). `ciphertext` is expected in the standard
    SubtleCrypto AES-GCM shape (raw ciphertext with the 16-byte auth tag
    appended) — cryptography's AESGCM.decrypt expects exactly that.

    Raises TransitDecryptionError on any malformed/tampered/wrong-key input
    — deliberately one generic error rather than distinguishing "bad base64"
    from "bad tag" from "bad JSON", so a caller can't use error content to
    probe the decryption process.
    """
    try:
        encrypted_key = base64.b64decode(payload["encrypted_key"])
        iv = base64.b64decode(payload["iv"])
        ciphertext = base64.b64decode(payload["ciphertext"])

        private_key = _load_private_key()
        aes_key = private_key.decrypt(encrypted_key, _OAEP_PADDING)
        plaintext = AESGCM(aes_key).decrypt(iv, ciphertext, None)
        data = json.loads(plaintext.decode())
    except ImproperlyConfigured:
        raise
    except Exception as e:
        raise TransitDecryptionError(f"Could not decrypt transit payload: {e}") from e

    if not isinstance(data, dict):
        raise TransitDecryptionError("Decrypted transit payload was not a JSON object.")
    return data
