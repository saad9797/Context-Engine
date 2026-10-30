import uuid

from django.conf import settings
from django.db import models

from core.crypto import decrypt_json, encrypt_json


class IngestionContext(models.Model):
    """Stores the structured JSON output produced by the ingestion engine."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ingestion_contexts",
        null=True,
        blank=True,
    )
    project_name = models.CharField(max_length=255, blank=True)
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    # Cheap shape hashes per source, computed once at ingestion time from
    # data already extracted (no extra queries) — compared against a fresh
    # lightweight live check by the freshness endpoint (see
    # ingestion/freshness.py, roadmap.md P3). Null for records saved before
    # this field existed.
    schema_fingerprint = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at", "-id"], name="context_user_recent_idx")]

    def __str__(self):
        return f"{self.project_name or 'Unnamed'} — {self.user} — {self.id}"


class SavedHandoff(models.Model):
    """Private, immutable export plus its request and user-reported outcome."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    context = models.ForeignKey(IngestionContext, on_delete=models.CASCADE, related_name="saved_handoffs")
    title = models.CharField(max_length=160)
    request_data = models.JSONField()
    output = models.JSONField()
    digest = models.CharField(max_length=64)
    outcome = models.CharField(max_length=24, default="unreviewed")
    feedback = models.CharField(max_length=2000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["context", "digest"], name="unique_saved_handoff_digest")]


class DataSourceConnection(models.Model):
    """
    A reusable, encrypted-at-rest connection to a Postgres/Mongo/object
    storage backend. Credentials are stored only as an opaque Fernet token
    (see core/crypto.py) — set_config()/get_config() are the only way in/out,
    and the plaintext never round-trips back to the client after creation.
    """

    KIND_CHOICES = [
        ("postgres", "Postgres"),
        ("mysql", "MySQL"),
        ("mongo", "MongoDB"),
        ("storage", "Object storage"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections"
    )
    name = models.CharField(max_length=255)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    encrypted_config = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "name"], name="unique_connection_name_per_user")
        ]

    def set_config(self, config: dict) -> None:
        self.encrypted_config = encrypt_json(config)

    def get_config(self) -> dict:
        return decrypt_json(self.encrypted_config)

    def __str__(self):
        return f"{self.name} ({self.kind}) — {self.user}"


class GitHubAppInstallation(models.Model):
    """
    Tracks which GitHub App installation belongs to which user. No token is
    stored here — installation access tokens are short-lived (~1hr) and
    minted on demand server-side from the App's private key
    (see ingestion/github_app.py), scoped to exactly the repos the user
    picked when installing the App on github.com.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="github_installations"
    )
    installation_id = models.BigIntegerField(unique=True)
    account_login = models.CharField(max_length=255)
    account_type = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.account_login} ({self.installation_id}) — {self.user}"


class GitHubIdentity(models.Model):
    """
    Links one Django account to the GitHub account that logged into it via
    "Continue with GitHub" (ingestion/views_github.py GitHubLoginCallbackView).
    Keyed by GitHub's numeric user id, not their login — logins can be
    renamed on GitHub's side, ids can't.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="github_identity"
    )
    github_id = models.BigIntegerField(unique=True)
    github_login = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.github_login} ({self.github_id}) — {self.user}"


class GoogleIdentity(models.Model):
    """
    Links one Django account to the Google account that logged into it via
    "Continue with Google" (accounts/views_google.py). Keyed by Google's
    OIDC `sub` claim, a stable opaque per-account id Google guarantees never
    changes or gets reused — unlike email, which a user can change later.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_identity"
    )
    google_id = models.CharField(max_length=255, unique=True)
    email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.email or self.google_id} — {self.user}"


class IngestionJob(models.Model):
    """
    An async ingestion run. Created in `pending`, enqueued to the `ingestion`
    RQ queue, and updated in place by ingestion/tasks.py as it progresses —
    this is what lets IngestionJobCreateView return immediately (202) instead of
    blocking a web worker on a subprocess for up to several minutes.
    """

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ingestion_jobs"
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    stage = models.CharField(max_length=100, blank=True)
    progress_pct = models.PositiveSmallIntegerField(default=0)
    # Which connections/installation + repo/branch/meta this run used — ids
    # and non-secret fields only, never raw credentials.
    connection_refs = models.JSONField(default=dict, blank=True)
    result = models.ForeignKey(
        IngestionContext, on_delete=models.SET_NULL, null=True, blank=True, related_name="jobs"
    )
    error = models.TextField(blank=True)
    rq_job_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"IngestionJob({self.id}, {self.status})"


class SourceVectorCache(models.Model):
    """Private source-derived vectors; deleting the snapshot removes the cache."""
    context = models.OneToOneField(IngestionContext, on_delete=models.CASCADE, related_name='vector_cache', primary_key=True)
    policy = models.CharField(max_length=100)
    keys = models.JSONField(default=list)
    vectors = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)


class ContextPreparation(models.Model):
    """Owner-scoped, short-lived context build; snapshot deletion cascades."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    context = models.ForeignKey(IngestionContext, on_delete=models.CASCADE, related_name='preparations')
    request_data = models.JSONField(default=dict)
    output = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default='pending')
    error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ClaudeLaunch(models.Model):
    """Expiring capability for Claude's prompt_url fetch; never an account token."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    context = models.ForeignKey(IngestionContext, on_delete=models.CASCADE, related_name='claude_launches')
    encrypted_prompt = models.TextField()
    expires_at = models.DateTimeField(db_index=True)


class AuditLogEntry(models.Model):
    """Append-only record of who did what, for after-the-fact review."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="audit_log_entries",
    )
    action = models.CharField(max_length=100)
    target_type = models.CharField(max_length=100, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "audit log entries"

    def __str__(self):
        return f"{self.action} by {self.user} @ {self.created_at:%Y-%m-%d %H:%M:%S}"
