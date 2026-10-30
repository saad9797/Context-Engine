import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it('stays silent when healthy and shares concurrent checks', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
  vi.stubGlobal('fetch', fetch);
  const api = await import('./warmup');
  const request = api.warmBackend();
  expect(api.warmBackend()).toBe(request);
  await request;
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.getBackendStatus()).toBe('ready');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('shows startup status, retries host errors, then clears on recovery', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }));
  const api = await import('./warmup');
  const request = api.warmBackend();
  await vi.advanceTimersByTimeAsync(4000);
  expect(api.getBackendStatus()).toBe('starting');
  await vi.advanceTimersByTimeAsync(2000);
  await request;
  expect(api.getBackendStatus()).toBe('ready');
});

it('ends a stalled check and allows a manual retry', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetch);
  const api = await import('./warmup');
  const request = api.warmBackend();
  await vi.advanceTimersByTimeAsync(90000);
  await request;
  expect(api.getBackendStatus()).toBe('unavailable');
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
  await api.warmBackend();
  expect(api.getBackendStatus()).toBe('ready');
});

it('clears a stalled health check when a normal API request reaches the server', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((url, { signal }) => {
    if (url.endsWith('/healthz')) return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    return Promise.resolve({ ok: true, status: 200, text: async () => '{"items":[]}' });
  }));
  const api = await import('./warmup');
  const { apiRequest } = await import('./client');
  const request = api.warmBackend();
  await vi.advanceTimersByTimeAsync(4000);
  expect(api.getBackendStatus()).toBe('starting');
  await apiRequest('/api/ingestion/');
  await request;
  await vi.advanceTimersByTimeAsync(100000);
  expect(api.getBackendStatus()).toBe('ready');
});

it('automatically detects recovery after the initial deadline', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal('fetch', fetch);
  const api = await import('./warmup');
  const request = api.warmBackend();
  await vi.advanceTimersByTimeAsync(90000);
  await request;
  expect(api.getBackendStatus()).toBe('unavailable');
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
  await vi.advanceTimersByTimeAsync(15000);
  expect(api.getBackendStatus()).toBe('ready');
});
