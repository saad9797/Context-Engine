import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ThemeModeProvider } from "./context/ThemeModeContext";
import { ToastProvider } from "./components/ToastProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import AppShell from "./components/layout/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";

import Landing from "./pages/Landing";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import Dashboard from "./pages/Dashboard";
import NewIngestion from "./pages/NewIngestion";
import IngestionProgress from "./pages/IngestionProgress";
import Results from "./pages/Results";
import ClaudeContext from "./pages/ClaudeContext";
import Connections from "./pages/Connections";
import AuditLog from "./pages/AuditLog";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <ThemeModeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/ingest/new" element={<NewIngestion />} />
                    <Route path="/ingest/:jobId/progress" element={<IngestionProgress />} />
                    <Route path="/contexts/:contextId" element={<Results />} />
                    <Route path="/contexts/:contextId/claude-context" element={<ClaudeContext />} />
                    <Route path="/connections" element={<Connections />} />
                    <Route path="/audit-log" element={<AuditLog />} />
                    <Route path="/settings" element={<Settings />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeModeProvider>
  );
}
