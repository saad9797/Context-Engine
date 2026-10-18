"""Keep Redis dequeue waits below managed-provider socket timeouts."""
from rq.worker import Worker, SimpleWorker


class ShortDequeueWait:
    @property
    def dequeue_timeout(self):
        connection = getattr(self, "connection", None)
        socket_timeout = connection.connection_pool.connection_kwargs.get("socket_timeout") if connection else None
        return max(1, min(15, int(socket_timeout) - 10)) if socket_timeout else 15


class ProductionWorker(ShortDequeueWait, Worker):
    """Forking worker for Linux deployments with bounded Redis idle waits."""


class WindowsWorker(ShortDequeueWait, SimpleWorker):
    """Development worker for Windows, where fork is unavailable."""
