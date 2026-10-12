import React, { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";

import { useAuth } from "../../context/AuthContext";
import AuthLayout from "./AuthLayout";
import { GitHubIcon, GoogleIcon } from "../../components/BrandIcons";

export default function Register() {
  const { register, startOAuth } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(username, email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider) => {
    setError(null);
    setOauthBusy(provider);
    try {
      await startOAuth(provider);
    } catch (err) {
      setError(err.message);
      setOauthBusy(null);
    }
  };

  return (
    <AuthLayout>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Create your account</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Free to start — connect a database or repo in the next step.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={1.25} sx={{ mb: 2.5 }}>
        <Button
          fullWidth variant="outlined" size="large"
          startIcon={oauthBusy === "google" ? <CircularProgress size={16} /> : <GoogleIcon />}
          onClick={() => oauth("google")}
          disabled={!!oauthBusy}
          sx={{ borderColor: "divider", color: "text.primary", justifyContent: "flex-start", pl: 2.5 }}
        >
          Continue with Google
        </Button>
        <Button
          fullWidth variant="outlined" size="large"
          startIcon={oauthBusy === "github" ? <CircularProgress size={16} /> : <GitHubIcon />}
          onClick={() => oauth("github")}
          disabled={!!oauthBusy}
          sx={{ borderColor: "divider", color: "text.primary", justifyContent: "flex-start", pl: 2.5 }}
        >
          Continue with GitHub
        </Button>
      </Stack>

      <Divider sx={{ mb: 2.5, "&::before, &::after": { borderColor: "divider" } }}>
        <Typography variant="caption" color="text.secondary">or</Typography>
      </Divider>

      <Box component="form" onSubmit={submit}>
        <Stack spacing={2}>
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus fullWidth required autoComplete="username" />
          <TextField label="Email" type="email" helperText="Optional" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth autoComplete="email" />
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            helperText="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth required
            autoComplete="new-password"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowPassword((s) => !s)} edge="end" aria-label={showPassword ? "Hide password" : "Show password"} tabIndex={-1}>
                    {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={busy}>
            {busy ? <CircularProgress size={18} color="inherit" /> : "Create account"}
          </Button>
        </Stack>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: "center" }}>
        Already have an account? <Link component={RouterLink} to="/login">Log in</Link>
      </Typography>
    </AuthLayout>
  );
}
