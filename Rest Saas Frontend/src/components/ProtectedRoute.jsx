import React, { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useAuth } from "../context/AuthContext";
import { rememberReturnPath } from '../lib/authReturn';

export default function ProtectedRoute() {
  const { isAuthenticated, resolvingOAuthToken } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (!isAuthenticated && !resolvingOAuthToken) rememberReturnPath(location);
  }, [isAuthenticated, resolvingOAuthToken, location]);

  if (resolvingOAuthToken) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
