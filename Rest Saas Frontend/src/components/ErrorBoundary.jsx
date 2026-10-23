import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";

// Catches unexpected render-time JS errors anywhere below it and shows a
// real page instead of a blank white screen — there was previously no
// error boundary anywhere in the app, so any unhandled render error (a
// malformed API response hitting an unguarded field access, etc.) would
// have unmounted the entire React tree silently.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Unhandled render error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", px: 3 }}>
        <ErrorOutlineIcon sx={{ fontSize: 40, color: "error.main", mb: 2 }} />
        <Typography variant="h4" sx={{ mb: 1 }}>Something went wrong</Typography>
        <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 420 }}>
          Reload this page to try again, or return to your project library.
        </Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>Reload</Button>
        <Button href="/dashboard" sx={{ mt: 1 }}>Go to project library</Button>
      </Box>
    );
  }
}
