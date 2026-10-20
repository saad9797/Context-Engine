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
