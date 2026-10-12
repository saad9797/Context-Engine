from django.urls import path, include

from .health import LivenessView, ReadinessView

urlpatterns = [
    path("healthz", LivenessView.as_view(), name="healthz"),
    path("readyz", ReadinessView.as_view(), name="readyz"),
    path("", include("accounts.urls")),
    path("", include("ingestion.urls")),
]
