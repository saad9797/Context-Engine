from django.urls import path

from .views import (
    AuditLogListView,
    DataSourceConnectionDetailView,
    DataSourceConnectionListCreateView,
    IngestionClaudeContextView,
    IngestionJobCreateView,
    IngestionJobStatusView,
    IngestionListView,
    IngestionResultView,
)
from .views_github import (
    GitHubInstallationDetailView,
    GitHubInstallationListView,
    GitHubInstallCallbackView,
    GitHubInstallURLView,
    GitHubLoginCallbackView,
    GitHubLoginStartView,
    GitHubManifestCallbackView,
    GitHubManifestView,
    GitHubWebhookView,
)

urlpatterns = [
    path("api/ingestion/run/", IngestionJobCreateView.as_view(), name="ingestion-run"),
    path("api/ingestion/jobs/<uuid:pk>/", IngestionJobStatusView.as_view(), name="ingestion-job-status"),
    path("api/ingestion/", IngestionListView.as_view(), name="ingestion-list"),
    path(
        "api/ingestion/<uuid:pk>/claude-context/",
        IngestionClaudeContextView.as_view(),
        name="ingestion-claude-context",
    ),
    path("api/ingestion/<uuid:pk>/", IngestionResultView.as_view(), name="ingestion-result"),
    path("api/connections/", DataSourceConnectionListCreateView.as_view(), name="connection-list-create"),
    path("api/connections/<uuid:pk>/", DataSourceConnectionDetailView.as_view(), name="connection-detail"),
    path("api/audit-log/", AuditLogListView.as_view(), name="audit-log"),
    path("api/integrations/github/manifest/", GitHubManifestView.as_view(), name="github-manifest"),
    path(
        "api/integrations/github/manifest/callback/",
        GitHubManifestCallbackView.as_view(),
        name="github-manifest-callback",
    ),
    path("api/integrations/github/install-url/", GitHubInstallURLView.as_view(), name="github-install-url"),
    path("api/integrations/github/callback/", GitHubInstallCallbackView.as_view(), name="github-install-callback"),
    path("api/integrations/github/login-url/", GitHubLoginStartView.as_view(), name="github-login-url"),
    path(
        "api/integrations/github/login-callback/",
        GitHubLoginCallbackView.as_view(),
        name="github-login-callback",
    ),
    path("api/integrations/github/webhook/", GitHubWebhookView.as_view(), name="github-webhook"),
    path(
        "api/integrations/github/installations/",
        GitHubInstallationListView.as_view(),
        name="github-installation-list",
    ),
    path(
        "api/integrations/github/installations/<uuid:pk>/",
        GitHubInstallationDetailView.as_view(),
        name="github-installation-detail",
    ),
]
