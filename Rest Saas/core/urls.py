from django.urls import path, include

urlpatterns = [
    path("", include("accounts.urls")),
    path("", include("ingestion.urls")),
]
