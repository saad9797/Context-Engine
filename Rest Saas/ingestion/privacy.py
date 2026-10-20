"""Defense in depth for exports, including snapshots made before schema-only ingestion."""
import re

DROP_KEYS = {"sample_rows", "sample_documents", "row_shape", "env_vars", "recent_commits",
             "example_keys", "sample_objects", "objects", "blobs", "files_sample", "blobs_sample", "objects_sample", "folders"}
SECRET_FILE = re.compile(r"(^|/)(\.env(?:\..*)?|credentials[^/]*|[^/]*\.(?:pem|key|p12|pfx))$", re.I)


def redact_text(text):
    # Known credential formats and credential-bearing literals. Code identifiers
    # (req.user.password, process.env.SECRET) remain intact.
    text = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", "[REDACTED PRIVATE KEY]", text, flags=re.S)
    text = re.sub(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", "[REDACTED HASH]", text)
    text = re.sub(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|sk-(?:ant-)?[A-Za-z0-9_-]{20,})\b", "[REDACTED TOKEN]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED JWT]", text)
    text = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED EMAIL]", text)
    text = re.sub(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)://[^\s'\"`]+", "[REDACTED CONNECTION URL]", text)
    text = re.sub(r"(?i)https?://[^\s'\"`]*\.(?:blob\.core\.windows\.net|s3[.-][a-z0-9.-]*amazonaws\.com)[^\s'\"`]*", "[REDACTED OBJECT URL]", text)
    names = r"password|passwd|client_secret|api_key|access_token|refresh_token|routing_number|account_number|AccountKey"
    key = r"['\"]?\b(?:" + names + r")\b['\"]?"
    text = re.sub(r"(?i)(" + key + r"\s*[=:]\s*)(['\"])[^'\"\n]+\2", r"\1\2[REDACTED]\2", text)
    return text


def safe_snapshot(value):
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and SECRET_FILE.search(value["path"]):
            return {"path": value["path"], "omitted": "credential file"}
        return {k: safe_shape(v) if k == "schema_shape" else safe_snapshot(v) for k, v in value.items() if k not in DROP_KEYS}
    if isinstance(value, list):
        return [safe_snapshot(v) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def safe_shape(value):
    if isinstance(value, dict):
        return {k: safe_shape(v) for k, v in value.items()}
    if isinstance(value, list):
        return [safe_shape(v) for v in value]
    if isinstance(value, str):
        return re.sub(r"^(ObjectId|Date|string|number|boolean|Buffer)\([\s\S]*\)$", r"\1", value)
    return value
