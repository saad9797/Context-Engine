// Browser-side transit encryption for data-source credentials — see
// Rest Saas/core/transit_crypto.py for the server half and the full
// rationale. Credentials are encrypted with a fresh AES-256-GCM key
// generated per submission; that AES key is then wrapped with the server's
// RSA-OAEP public key. Nothing here is invented crypto — every primitive
// is a direct Web Crypto (SubtleCrypto) call.

let cachedPublicKey = null; // { pem, cryptoKey } — the imported CryptoKey, not just the PEM

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function isTransitEncryptionSupported() {
  return typeof window !== "undefined" && !!window.crypto?.subtle;
}

async function getPublicKey(request) {
  if (cachedPublicKey) return cachedPublicKey;
  const { public_key_pem } = await request("/api/crypto/public-key/");
  const cryptoKey = await window.crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(public_key_pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  cachedPublicKey = { pem: public_key_pem, cryptoKey };
  return cachedPublicKey;
}

/**
 * Encrypts `data` (any JSON-serializable object) for transit to the server.
 * Returns { encrypted_key, iv, ciphertext } (all base64) — the shape
 * ingestion/serializers.py's `transit_payload` field expects. `request` is
 * the authenticated fetch function from useAuth(), used once to fetch (and
 * cache) the server's public key.
 */
export async function encryptForTransit(request, data) {
  const { cryptoKey } = await getPublicKey(request);

  const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

  const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
  const encryptedKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, cryptoKey, rawAesKey);

  return {
    encrypted_key: bufferToBase64(encryptedKey),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}
