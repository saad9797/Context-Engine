import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";

// Mocks the auth hook directly rather than standing up a real
// AuthProvider + backend — this test is specifically about the routing
// decision (does an unauthenticated visitor actually get redirected),
// not about AuthContext's own token-resolution logic.
let mockAuthState = {};
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

function renderProtected(initialEntry = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Secret dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when not authenticated", () => {
    mockAuthState = { isAuthenticated: false, resolvingOAuthToken: false };
    renderProtected();
    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Secret dashboard content")).not.toBeInTheDocument();
  });

  it("renders the protected content when authenticated", () => {
    mockAuthState = { isAuthenticated: true, resolvingOAuthToken: false };
    renderProtected();
    expect(screen.getByText("Secret dashboard content")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("shows a loading state instead of the login page while an OAuth token is resolving", () => {
    // Regression guard: during the brief window after a GitHub/Google OAuth
    // redirect lands with a #token= fragment, isAuthenticated is
    // momentarily still false — without this check, that instant would
    // flash the login page before flipping to authenticated.
    mockAuthState = { isAuthenticated: false, resolvingOAuthToken: true };
    renderProtected();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret dashboard content")).not.toBeInTheDocument();
  });
});
