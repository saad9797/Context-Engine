import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, readStoredUser, readToken, writeStoredUser, writeToken } from "../api/client";
import { useNavigate } from 'react-router-dom';
import { takeReturnPath } from '../lib/authReturn';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [token, setTokenState] = useState(readToken);
  const [user, setUser] = useState(readStoredUser);
  const [sessionExpired, setSessionExpired] = useState(false);
  // True only while resolving a `#token=...` fragment landed on us by an
  // OAuth redirect (GitHub or Google) — the rest of the app should show a
  // loading state, not the login screen, during this brief window.
  const [resolvingOAuthToken, setResolvingOAuthToken] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("token=")
  );

  const setToken = useCallback((next) => {
    setTokenState(next);
    writeToken(next);
  }, []);

  const setAuthenticated = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    writeStoredUser(nextUser);
    setSessionExpired(false);
  }, [setToken]);

  // Fires when any request comes back 401 with a token attached — clears
  // it locally and drops back to the login screen instead of leaving the
  // app stuck re-showing "Invalid token" forever.
  const forceLocalLogout = useCallback(() => {
    setToken("");
    setUser(null);
    writeStoredUser(null);
    setSessionExpired(true);
  }, [setToken]);

  const request = useCallback(
    (path, opts) => apiRequest(path, { ...opts, token, onUnauthorized: forceLocalLogout }),
    [token, forceLocalLogout]
  );

  // "Continue with GitHub"/"Continue with Google" end by redirecting the
  // whole browser back here with `#token=...` in the URL (a hash fragment,
  // so it never hits server access logs) — pick it up once on mount,
  // resolve who it belongs to via /api/auth/me/, log in, and scrub it from
  // the address bar.
  useEffect(() => {
    const match = window.location.hash.match(/token=([^&]+)/);
    if (!match) return;
    const incomingToken = decodeURIComponent(match[1]);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    apiRequest("/api/auth/me/", { token: incomingToken })
      .then((u) => { setAuthenticated(incomingToken, u); navigate(takeReturnPath(), { replace: true }); })
      .catch(() => { /* stale/invalid token from a redirect — fall through to login */ })
      .finally(() => setResolvingOAuthToken(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username, password) => {
      const res = await apiRequest("/api/auth/login/", { method: "POST", body: { username, password } });
      setAuthenticated(res.token, res.user);
    },
    [setAuthenticated]
  );

  const register = useCallback(
    async (username, email, password) => {
      const res = await apiRequest("/api/auth/register/", { method: "POST", body: { username, email, password } });
      setAuthenticated(res.token, res.user);
    },
    [setAuthenticated]
  );

  const logout = useCallback(async () => {
    try { await request("/api/auth/logout/", { method: "POST" }); } catch { /* token may already be invalid — clear locally regardless */ }
    setToken("");
    setUser(null);
    writeStoredUser(null);
  }, [request, setToken]);

  const startOAuth = useCallback(
    async (provider) => {
      const path = provider === "google" ? "/api/auth/google/login-url/" : "/api/integrations/github/login-url/";
      const res = await apiRequest(path);
      window.location.href = res.login_url;
    },
    []
  );

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: !!token,
      sessionExpired,
      resolvingOAuthToken,
      request,
      login,
      register,
      logout,
      startOAuth,
    }),
    [token, user, sessionExpired, resolvingOAuthToken, request, login, register, logout, startOAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
