import React, { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ThemeModeProvider } from "./context/ThemeModeContext";
import { ToastProvider } from "./components/ToastProvider";
import ProtectedRoute from "./components/ProtectedRoute";
const AppShell = lazy(() => import("./components/layout/AppShell"));
import ErrorBoundary from "./components/ErrorBoundary";
import PageTransition, { PageLoading } from "./components/PageTransition";

import Landing from "./pages/Landing";
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewIngestion = lazy(() => import("./pages/NewIngestion"));
const IngestionProgress = lazy(() => import("./pages/IngestionProgress"));
const Results = lazy(() => import("./pages/Results"));
const ClaudeContext = lazy(() => import("./pages/ClaudeContext"));
const Connections = lazy(() => import("./pages/Connections"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RoutePosition() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const titles = {
      "/dashboard": "Project library",
      "/ingest/new": "Build a snapshot",
      "/connections": "Connected sources",
      "/audit-log": "Workspace activity",
      "/settings": "Settings",
      "/login": "Log in",
      "/register": "Create your account",
    };
    const title =
      titles[pathname] ||
      (pathname.includes("/claude-context")
        ? "AI context"
        : pathname.startsWith("/contexts/")
          ? "Project snapshot"
          : pathname.includes("/progress")
            ? "Building your snapshot"
            : null);
    document.title = title
      ? `${title} | Contexa`
      : "Contexa | Your whole project. One clear context.";
    if (hash) {
      requestAnimationFrame(() =>
        document.getElementById(hash.slice(1))?.scrollIntoView(),
      );
    } else window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <ThemeModeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <RoutePosition />
              <Suspense
                fallback={<PageLoading />}
              >
                <Routes>
                  <Route element={<PageTransition />}>
                  <Route path="/" element={<Landing />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="*" element={<NotFound />} />
                  </Route>

                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppShell />}>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/ingest/new" element={<NewIngestion />} />
                      <Route
                        path="/ingest/:jobId/progress"
                        element={<IngestionProgress />}
                      />
                      <Route
                        path="/contexts/:contextId"
                        element={<Results />}
                      />
                      <Route
                        path="/contexts/:contextId/claude-context"
                        element={<ClaudeContext />}
                      />
                      <Route path="/connections" element={<Connections />} />
                      <Route path="/audit-log" element={<AuditLog />} />
                      <Route path="/settings" element={<Settings />} />
                    </Route>
                  </Route>

                </Routes>
              </Suspense>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeModeProvider>
  );
}
