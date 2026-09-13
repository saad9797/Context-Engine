from .models import AuditLogEntry


def _client_ip(request):
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_action(user, action, target=None, metadata=None, request=None):
    """
    Record one audit trail entry.

    `target` may be a model instance (its class name + pk are recorded) or
    left None for actions with no single subject (e.g. a failed login).
    """
    target_type = ""
    target_id = ""
    if target is not None:
        target_type = target.__class__.__name__
        target_id = str(getattr(target, "pk", ""))

    AuditLogEntry.objects.create(
        user=user,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata=metadata or {},
        ip_address=_client_ip(request),
    )
