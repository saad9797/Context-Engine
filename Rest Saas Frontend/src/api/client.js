// Env resolution — reads the API base URL regardless of bundler naming
// convention (Vite's import.meta.env.VITE_API_BASE_URL, or plain
// API_BASE_URL for other setups), falling back to a typical local Django
// runserver.
function resolveApiBase() {
  let fromEnv = null;
  try {
    // eslint-disable-next-line no-new-func
    const viteEnv = new Function("try { return import.meta.env; } catch (e) { return null; }")();
    if (viteEnv) fromEnv = viteEnv.VITE_API_BASE_URL || viteEnv.API_BASE_URL || fromEnv;
  } catch (e) { /* not in an ESM/Vite context */ }
  try {
    if (!fromEnv && typeof process !== "undefined" && process.env) {
      fromEnv = process.env.API_BASE_URL || process.env.REACT_APP_API_BASE_URL || fromEnv;
    }
  } catch (e) { /* process undefined in this environment */ }
  return (fromEnv || "http://localhost:8000").replace(/\/$/, "");
}

export const API_BASE = resolveApiBase();

const TOKEN_KEY = "cxa_token";
const USER_KEY = "cxa_user";

export function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function writeToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode etc — degrade to in-memory only */ }
}
export function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function writeStoredUser(user) {
  try { user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}

// Two different error shapes come back from this API: hand-written views
// return {"error": "..."} (or {"detail": "..."}), but anything backed by a
// DRF serializer's own validation returns DRF's default shape instead:
// {"username": ["..."]} or {"non_field_errors": [...]}. Without unwrapping
// that second shape, every validation failure showed only the generic
// "Request failed with status 400" with no indication of which field.
function formatErrorPayload(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (payload.error) return payload.error;
  if (payload.detail) return payload.detail;
  if (Array.isArray(payload)) return payload.join(" ");
  if (typeof payload === "object") {
    const parts = Object.entries(payload).map(([field, messages]) => {
      const text = Array.isArray(messages) ? messages.join(" ") : String(messages);
      return field === "non_field_errors" ? text : `${field}: ${text}`;
    });
    if (parts.length) return parts.join(" · ");
  }
  return null;
}

export async function apiRequest(path, { method = "GET", body, params, token, onUnauthorized } = {}) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Token ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      // Cookies are only needed for Django's session auth. With a token
      // set, the token is what's doing the authenticating — sending
      // cookies too just forces stricter CORS requirements for no benefit.
      credentials: "omit",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Could not reach ${url}. Check that the backend is running and VITE_API_BASE_URL is correct.`);
  }

  let payload = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    // A 401 on an authenticated call means the token itself is no good
    // (expired, revoked, or invalidated by a logout elsewhere — DRF's
    // TokenAuthentication is one token per user).
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    const detail = formatErrorPayload(payload) || `Request failed with status ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}
