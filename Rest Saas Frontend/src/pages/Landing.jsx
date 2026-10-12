import React from "react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";

import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import GppGoodOutlinedIcon from "@mui/icons-material/GppGoodOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TokenOutlinedIcon from "@mui/icons-material/TokenOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { GitHubIcon } from "../components/BrandIcons";
import { useAuth } from "../context/AuthContext";

const FEATURES = [
  {
    icon: DnsOutlinedIcon,
    title: "Reads your real stack",
    body: "Connects to Postgres, MongoDB, object storage, and your GitHub repo and inspects them directly — schema, indexes, sample shapes, framework conventions. Nothing hand-described, nothing guessed.",
  },
  {
    icon: ScienceOutlinedIcon,
    title: "Distilled for code generation",
    body: "Scan statistics, extension internals, and bulk sample data are stripped before anything reaches a prompt — what's left is sized and shaped for a coding model to act on.",
  },
  {
    icon: TokenOutlinedIcon,
    title: "Task-scoped, token-budgeted",
    body: "Describe what you're building and the context trims itself to what's relevant, with one hop of related tables/collections included automatically. Set a hard token ceiling when you need one.",
  },
  {
    icon: AccountTreeOutlinedIcon,
    title: "One merged architecture graph",
    body: "Tables, collections, storage buckets, and detected routes as a single connected graph — not four JSON files you have to cross-reference by hand.",
  },
  {
    icon: HistoryOutlinedIcon,
    title: "Freshness and drift detection",
    body: "Know when a saved context is stale before you build against it — a lightweight live check flags schema drift since the last ingestion run.",
  },
  {
    icon: GppGoodOutlinedIcon,
    title: "Credentials encrypted at rest",
    body: "Connections are stored once, encrypted, and never echoed back to the browser after creation. Environment variable values are never extracted, even from template files.",
  },
];

const STEPS = [
  { n: "01", title: "Connect a source", body: "Add a Postgres/Mongo connection or install the GitHub App — credentials are encrypted once, reused across runs." },
  { n: "02", title: "Run an ingestion", body: "A background worker inspects your stack and distills it — you watch real progress, not a blocking spinner." },
  { n: "03", title: "Hand it to Claude", body: "Copy the distilled claude_context straight into a prompt, or pull it via the Contexa MCP server from Claude Code/Desktop directly." },
];

function NavBar() {
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Container maxWidth="lg">
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: "primary.main", color: "primary.contrastText", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ScienceOutlinedIcon fontSize="small" />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Contexa</Typography>
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <Button component={RouterLink} to="/login" color="inherit">Sign in</Button>
            <Button component={RouterLink} to="/register" variant="contained">Get started</Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <NavBar />

      {/* Hero */}
      <Container maxWidth="md" sx={{ pt: { xs: 8, md: 12 }, pb: { xs: 6, md: 8 }, textAlign: "center" }}>
        <Chip label="Context engineering for existing projects" size="small" variant="outlined" sx={{ mb: 3 }} />
        <Typography variant="h1" sx={{ fontSize: { xs: "2.25rem", md: "3rem" }, lineHeight: { xs: "2.75rem", md: "3.5rem" }, mb: 2.5 }}>
          Give Claude the context it's missing.
        </Typography>
        <Typography variant="body1" sx={{ fontSize: "1.0625rem", lineHeight: 1.7, color: "text.secondary", maxWidth: 620, mx: "auto", mb: 4 }}>
          Contexa reads your database, storage, and codebase, then distills it into one
          artifact sized for a coding model — so it stops guessing at your schema and
          starts generating code that actually fits.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="center">
          <Button component={RouterLink} to="/register" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>
            Get started free
          </Button>
          <Button component={RouterLink} to="/login" variant="outlined" size="large" startIcon={<GitHubIcon fontSize="small" />}>
            Continue with GitHub
          </Button>
        </Stack>
      </Container>

      {/* Feature grid */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 10 } }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
          {FEATURES.map((f) => (
            <Card key={f.title} variant="outlined">
              <CardContent>
                <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", mb: 1.5 }}>
                  <f.icon fontSize="small" sx={{ color: "text.secondary" }} />
                </Box>
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>{f.title}</Typography>
                <Typography variant="body2">{f.body}</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      <Divider />

      {/* How it works */}
      <Container maxWidth="md" sx={{ py: { xs: 8, md: 10 } }}>
        <Typography variant="h3" sx={{ textAlign: "center", mb: 1 }}>How it works</Typography>
        <Typography variant="body1" sx={{ textAlign: "center", color: "text.secondary", mb: 6 }}>
          Three steps, most of it running on a background worker.
        </Typography>
        <Stack spacing={4}>
          {STEPS.map((s) => (
            <Stack key={s.n} direction="row" spacing={3} alignItems="flex-start">
              <Typography variant="h5" sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums", flexShrink: 0, width: 40 }}>{s.n}</Typography>
              <Box>
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>{s.title}</Typography>
                <Typography variant="body2">{s.body}</Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Container>

      <Divider />

      {/* Trust note */}
      <Container maxWidth="sm" sx={{ py: { xs: 8, md: 10 }, textAlign: "center" }}>
        <LockOutlinedIcon sx={{ color: "text.secondary", mb: 2 }} />
        <Typography variant="h5" sx={{ mb: 1.5 }}>Encrypted before it leaves your browser</Typography>
        <Typography variant="body2" sx={{ mb: 4 }}>
          Connection credentials are encrypted client-side (AES-256-GCM, wrapped with our
          server's RSA-OAEP public key via the Web Crypto API) before the request is ever sent,
          then re-encrypted at rest and only briefly decrypted server-side to run an ingestion —
          never round-tripped back to the browser after you create them.
        </Typography>
        <Button component={RouterLink} to="/register" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>
          Get started free
        </Button>
      </Container>

      <Divider />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography variant="caption">© {new Date().getFullYear()} Contexa</Typography>
      </Container>
    </Box>
  );
}
