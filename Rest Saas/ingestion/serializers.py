from rest_framework import serializers

from .models import AuditLogEntry, DataSourceConnection, GitHubAppInstallation, IngestionJob


class DataSourceConnectionSerializer(serializers.ModelSerializer):
    """
    Write-only `config` — the plaintext credentials are accepted on create
    and immediately encrypted (DataSourceConnection.set_config); they are
    never included in any response, including this serializer's own output
    right after creation.
    """

    config = serializers.JSONField(write_only=True)

    class Meta:
        model = DataSourceConnection
        fields = ["id", "name", "kind", "config", "created_at", "updated_at", "last_used_at"]
        read_only_fields = ["id", "created_at", "updated_at", "last_used_at"]

    def validate_name(self, value):
        # The DB-level UniqueConstraint is on (user, name), but `user` isn't
        # a serializer field (it comes from request.user in create() below)
        # — DRF can't auto-generate a UniqueTogetherValidator for a
        # constraint it can't see all the fields of, so without this check
        # a duplicate name raises a raw IntegrityError (500) instead of a
        # normal 400.
        user = self.context["request"].user
        if DataSourceConnection.objects.filter(user=user, name=value).exists():
            raise serializers.ValidationError("You already have a connection with this name.")
        return value

    def create(self, validated_data):
        config = validated_data.pop("config")
        connection = DataSourceConnection(user=self.context["request"].user, **validated_data)
        connection.set_config(config)
        connection.save()
        return connection


class GitHubAppInstallationSerializer(serializers.ModelSerializer):
    class Meta:
        model = GitHubAppInstallation
        fields = ["id", "installation_id", "account_login", "account_type", "created_at"]
        read_only_fields = fields


class IngestionJobCreateSerializer(serializers.Serializer):
    postgres_connection_id = serializers.UUIDField(required=False, allow_null=True)
    mongo_connection_id = serializers.UUIDField(required=False, allow_null=True)
    mongo_db_name = serializers.CharField(required=False, allow_blank=True)
    mongo_scan_all_databases = serializers.BooleanField(required=False, default=False)
    storage_connection_id = serializers.UUIDField(required=False, allow_null=True)
    github_installation_id = serializers.IntegerField(required=False, allow_null=True)
    github_owner = serializers.CharField(required=False, allow_blank=True)
    github_repo = serializers.CharField(required=False, allow_blank=True)
    github_branch = serializers.CharField(required=False, allow_blank=True)
    meta = serializers.JSONField(required=False)

    def validate(self, attrs):
        has_source = any(
            attrs.get(k)
            for k in ("postgres_connection_id", "mongo_connection_id", "github_installation_id")
        )
        if not has_source:
            raise serializers.ValidationError(
                "At least one of postgres_connection_id, mongo_connection_id, "
                "or github_installation_id is required."
            )
        if attrs.get("github_installation_id") and not (attrs.get("github_owner") and attrs.get("github_repo")):
            raise serializers.ValidationError(
                "github_owner and github_repo are required when github_installation_id is set."
            )
        return attrs


class IngestionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = IngestionJob
        fields = [
            "id", "status", "stage", "progress_pct", "result", "error",
            "created_at", "started_at", "finished_at",
        ]
        read_only_fields = fields


class AuditLogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLogEntry
        fields = ["id", "action", "target_type", "target_id", "metadata", "ip_address", "created_at"]
        read_only_fields = fields
