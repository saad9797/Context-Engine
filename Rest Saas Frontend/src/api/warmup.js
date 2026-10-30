import { API_BASE } from './client';
import { getBackendStatus, subscribeBackendStatus, updateBackendStatus as update } from './backendStatus';
export { getBackendStatus, subscribeBackendStatus } from './backendStatus';

let pending = null;
let retryTimer = null;
subscribeBackendStatus(() => {
  if (getBackendStatus() === 'ready') clearTimeout(retryTimer);
});

// Wake the service without blocking rendering or replaying user actions.
export function warmBackend() {
  if (pending) return pending;
  clearTimeout(retryTimer);
  update('checking');
  const controller = new AbortController();
  const unsubscribe = subscribeBackendStatus(() => {
    if (getBackendStatus() === 'ready') controller.abort();
  });
  const slowTimer = setTimeout(() => {
    if (getBackendStatus() !== 'ready') update('starting');
  }, 4000);
  const deadline = setTimeout(() => controller.abort(), 90000);
  pending = (async () => {
    try {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${API_BASE}/healthz`, {
            method: 'GET', credentials: 'omit', cache: 'no-store',
            headers: { Accept: 'application/json' }, signal: controller.signal,
          });
          if (response.ok && (await response.json()).status === 'ok') {
            update('ready');
            return;
          }
        } catch { /* A sleeping host can return errors before it is ready. */ }
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (getBackendStatus() !== 'ready') update('unavailable');
    } finally {
      unsubscribe();
      clearTimeout(slowTimer);
      clearTimeout(deadline);
      pending = null;
      // Keep checking after the initial cold-start window expires.
      if (getBackendStatus() === 'unavailable') {
        retryTimer = setTimeout(warmBackend, 15000);
      }
    }
  })();
  return pending;
}
