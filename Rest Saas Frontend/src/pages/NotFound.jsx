import React from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import SearchOffOutlinedIcon from "@mui/icons-material/SearchOffOutlined";

import { useAuth } from "../context/AuthContext";

// Real 404 page — replaces a previous silent redirect-to-"/" for any
// unmatched route, which meant a logged-in user hitting a stale link or
// typo'd URL got bounced to their dashboard with zero explanation instead
// of a real "not found." Also what a deep link to a deleted/never-existing
// resource ends up on, once a page's own fetch surfaces a 404.
export default function NotFound() {
  const { isAuthenticated } = useAuth();
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        px: 3,
      }}
    >
      <SearchOffOutlinedIcon
        sx={{ fontSize: 40, color: "text.secondary", mb: 2 }}
      />
      <Typography variant="h4" sx={{ mb: 1 }}>
        Page not found
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 420 }}>
        This page may have moved, or the project may no longer be available.
        Let's get you back to your workspace.
      </Typography>
      <Button
        variant="contained"
        component={RouterLink}
        to={isAuthenticated ? "/dashboard" : "/"}
      >
        {isAuthenticated ? "Back to project library" : "Back home"}
      </Button>
    </Box>
  );
}
