import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Collapse from "@mui/material/Collapse";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";

import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";

import { useAuth } from "../context/AuthContext";
import { GitHubIcon } from "../components/BrandIcons";
import PageHeader from "../components/PageHeader";

const emptyForm = {
  usePostgres: false, postgres_connection_id: "",
  useMongo: false, mongo_connection_id: "", mongo_db_name: "", mongo_scan_all_databases: false,
  useStorage: false, storage_connection_id: "",
  useGithub: false, github_installation_id: "", github_owner: "", github_repo: "", github_branch: "",
  project_name: "", description: "",
};

function SourceCard({ icon: Icon, title, desc, enabled, onToggle, children }) {
  return (
    <Card variant="outlined" sx={{ mb: 1.5, borderColor: enabled ? "primary.main" : "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 1.75 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 1.5, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: enabled ? "primary.main" : "action.hover", color: enabled ? "primary.contrastText" : "text.secondary", flexShrink: 0 }}>
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{desc}</Typography>
        </Box>
        <Switch checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      </Box>
      <Collapse in={enabled}>
        <CardContent sx={{ pt: 0, borderTop: 1, borderColor: "divider" }}>{children}</CardContent>
      </Collapse>
    </Card>
  );
}

function ConnectionPicker({ connections, value, onChange, kindLabel }) {
  const navigate = useNavigate();
  if (connections === null) return <CircularProgress size={18} sx={{ my: 1 }} />;
  if (connections.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No saved {kindLabel} connections yet.{" "}
        <Link component="button" type="button" onClick={() => navigate("/connections")}>Add one from Connections</Link>.
      </Alert>
    );
  }
  return (
    <TextField select label="Connection" value={value} onChange={(e) => onChange(e.target.value)} fullWidth required sx={{ mt: 2 }}>
      <MenuItem value=""><em>Select a connection…</em></MenuItem>
      {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
    </TextField>
  );
}

export default function NewIngestion() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [connections, setConnections] = useState(null);
  const [installations, setInstallations] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [validationError, setValidationError] = useState(null);

  useEffect(() => {
    request("/api/connections/").then(setConnections).catch(() => setConnections([]));
    request("/api/integrations/github/installations/").then(setInstallations).catch(() => setInstallations([]));
  }, [request]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const byKind = (kind) => (connections || []).filter((c) => c.kind === kind);
  const canSubmit = form.usePostgres || form.useMongo || form.useGithub;

  const submit = async () => {
    setValidationError(null);
    if (!canSubmit) {
      setValidationError("Add at least one of Postgres, MongoDB, or a GitHub repo — the engine needs somewhere to read from.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const body = { meta: { project_name: form.project_name, description: form.description } };
    if (form.usePostgres) body.postgres_connection_id = form.postgres_connection_id;
    if (form.useMongo) {
      body.mongo_connection_id = form.mongo_connection_id;
      if (form.mongo_scan_all_databases) body.mongo_scan_all_databases = true;
      else if (form.mongo_db_name) body.mongo_db_name = form.mongo_db_name;
    }
    if (form.useStorage) body.storage_connection_id = form.storage_connection_id;
    if (form.useGithub) {
      body.github_installation_id = Number(form.github_installation_id);
      body.github_owner = form.github_owner;
      body.github_repo = form.github_repo;
      body.github_branch = form.github_branch || undefined;
    }

    try {
      const res = await request("/api/ingestion/run/", { method: "POST", body });
      navigate(`/ingest/${res.job_id}/progress`, {
        state: {
          sourcesEnabled: { database: form.usePostgres, mongo_database: form.useMongo, object_storage: form.useStorage, codebase: form.useGithub },
          projectName: form.project_name,
        },
      });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const selectedSources = [
    form.usePostgres && "PostgreSQL",
    form.useMongo && "MongoDB",
    form.useStorage && "Object storage",
    form.useGithub && "GitHub repository",
  ].filter(Boolean);

  return (
    <Box sx={{ maxWidth: 720 }}>
      <PageHeader
        title="Point it at your stack"
        description="Contexa reads your database, storage bucket, and repo, then distills all three into one artifact sized for a coding model. Runs happen on a background worker — you'll watch live progress on the next screen."
      />

      {validationError && <Alert severity="warning" sx={{ mb: 2 }}>{validationError}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <SourceCard icon={DnsOutlinedIcon} title="PostgreSQL" desc="Tables, columns, keys, indexes, functions, sample rows." enabled={form.usePostgres} onToggle={(v) => set({ usePostgres: v })}>
        <ConnectionPicker connections={byKind("postgres")} value={form.postgres_connection_id} onChange={(v) => set({ postgres_connection_id: v })} kindLabel="Postgres" />
      </SourceCard>

      <SourceCard icon={StorageOutlinedIcon} title="MongoDB" desc="Collection shapes, indexes, inferred relationships." enabled={form.useMongo} onToggle={(v) => set({ useMongo: v })}>
        <ConnectionPicker connections={byKind("mongo")} value={form.mongo_connection_id} onChange={(v) => set({ mongo_connection_id: v })} kindLabel="MongoDB" />
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox checked={form.mongo_scan_all_databases} onChange={(e) => set({ mongo_scan_all_databases: e.target.checked })} />}
          label={<Typography variant="body2">Scan all databases on the cluster (slower, nothing missed)</Typography>}
        />
        {!form.mongo_scan_all_databases && (
          <TextField label="Database name" placeholder="myapp" helperText="Overrides the name saved on the connection, if any." value={form.mongo_db_name} onChange={(e) => set({ mongo_db_name: e.target.value })} fullWidth sx={{ mt: 1 }} />
        )}
      </SourceCard>

      <SourceCard icon={CloudQueueOutlinedIcon} title="Object storage" desc="Bucket contents, folder conventions, file-type breakdown." enabled={form.useStorage} onToggle={(v) => set({ useStorage: v })}>
        <ConnectionPicker connections={byKind("storage")} value={form.storage_connection_id} onChange={(v) => set({ storage_connection_id: v })} kindLabel="storage" />
      </SourceCard>

      <SourceCard icon={GitHubIcon} title="GitHub repository" desc="Route/model/middleware files, framework detection, conventions." enabled={form.useGithub} onToggle={(v) => set({ useGithub: v })}>
        {installations && installations.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            No GitHub App installations yet.{" "}
            <Link component="button" type="button" onClick={() => navigate("/connections")}>Connect GitHub from Connections</Link>.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField select label="Installation" value={form.github_installation_id} onChange={(e) => set({ github_installation_id: e.target.value })} fullWidth required>
              <MenuItem value=""><em>Select an installation…</em></MenuItem>
              {(installations || []).map((i) => <MenuItem key={i.id} value={i.installation_id}>{i.account_login}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField label="Owner" placeholder="acme-corp" value={form.github_owner} onChange={(e) => set({ github_owner: e.target.value })} fullWidth required />
              <TextField label="Repository" placeholder="backend-api" value={form.github_repo} onChange={(e) => set({ github_repo: e.target.value })} fullWidth required />
            </Stack>
            <TextField label="Branch" placeholder="main" helperText="Defaults to the repository's default branch." value={form.github_branch} onChange={(e) => set({ github_branch: e.target.value })} fullWidth />
          </Stack>
        )}
      </SourceCard>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2}>
            <TextField label="Project name" placeholder="Staffing CRM / ATS" value={form.project_name} onChange={(e) => set({ project_name: e.target.value })} fullWidth />
            <TextField label="Description" placeholder="Optional — helps you find it later" value={form.description} onChange={(e) => set({ description: e.target.value })} fullWidth />
          </Stack>
        </CardContent>
      </Card>

      {selectedSources.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3, bgcolor: "action.hover" }}>
          <CardContent sx={{ py: "16px !important" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>This run will ingest</Typography>
            <Stack spacing={0.5}>
              {selectedSources.map((s) => (
                <Stack key={s} direction="row" spacing={1} alignItems="center">
                  <CheckCircleOutlineIcon sx={{ fontSize: 15, color: "success.main" }} />
                  <Typography variant="body2">{s}</Typography>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Button variant="contained" size="large" startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />} onClick={submit} disabled={submitting}>
        {submitting ? "Starting…" : "Run ingestion"}
      </Button>
    </Box>
  );
}
