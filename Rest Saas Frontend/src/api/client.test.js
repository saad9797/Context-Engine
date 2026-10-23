import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it("uses the deployed Vite API origin for authenticated requests", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid/");
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"ok":true}' });
  vi.stubGlobal("fetch", fetch);
  const { API_BASE, apiRequest } = await import("./client");
  expect(API_BASE).toBe("https://api.example.invalid");
  await expect(apiRequest("/api/ingestion/", { token: "test-only" })).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledWith("https://api.example.invalid/api/ingestion/", expect.objectContaining({
    headers: expect.objectContaining({ Authorization: "Token test-only" }), credentials: "omit",
  }));
});

it('reports an unavailable service without exposing an HTML hosting error page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '<html>upstream internal error</html>' }));
  const { apiRequest } = await import('./client');
  await expect(apiRequest('/api/auth/login/')).rejects.toThrow('Contexa is temporarily unavailable');
});

it('rejects HTML served by an incorrectly rewritten API URL', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>React app</html>' }));
  const { apiRequest } = await import('./client');
  await expect(apiRequest('/api/ingestion/')).rejects.toThrow('unexpected response');
});

it('aborts requests that never respond', async () => {
  vi.stubGlobal('fetch', vi.fn((_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
  const { apiRequest } = await import('./client');
  await expect(apiRequest('/api/ingestion/', { timeoutMs: 5 })).rejects.toThrow('taking too long');
});
