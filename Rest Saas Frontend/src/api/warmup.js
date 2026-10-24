import { API_BASE } from './client';

// Start the backend while visitors read the landing page or enter credentials.
// One request per page load; it never blocks rendering or authentication.
let started = false;
export function warmBackend() {
  if (started) return;
  started = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  fetch(`${API_BASE}/healthz`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    signal: controller.signal,
  })
    .catch(() => { /* Best effort: normal API requests handle errors. */ })
    .finally(() => clearTimeout(timer));
}
