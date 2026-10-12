from django.urls import path

from .views import LoginView, LogoutView, MeView, RegisterView
from .views_google import GoogleLoginCallbackView, GoogleLoginStartView

urlpatterns = [
    path("api/auth/register/", RegisterView.as_view(), name="auth-register"),
    path("api/auth/login/", LoginView.as_view(), name="auth-login"),
    path("api/auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("api/auth/me/", MeView.as_view(), name="auth-me"),
    path("api/auth/google/login-url/", GoogleLoginStartView.as_view(), name="google-login-url"),
    path("api/auth/google/callback/", GoogleLoginCallbackView.as_view(), name="google-login-callback"),
]
