import { API_BASE } from './client';

let status = 'idle';
let pending = null;
const listeners = new Set();
function update(next) {
  status = next;
  listeners.forEach((listener) => listener());
}
export const getBackendStatus = () => status;
export function subscribeBackendStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Wake the service without blocking rendering or replaying user actions.
export function warmBackend() {
  if (pending) return pending;
  update('checking');
  const controller = new AbortController();
  const slowTimer = setTimeout(() => update('starting'), 4000);
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
      update('unavailable');
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(deadline);
      pending = null;
    }
  })();
  return pending;
}
