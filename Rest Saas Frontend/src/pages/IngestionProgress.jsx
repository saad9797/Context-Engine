import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";

import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import CloudQueueOutlinedIcon from "@mui/icons-material/CloudQueueOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import PowerSettingsNewOutlinedIcon from "@mui/icons-material/PowerSettingsNewOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ReplayIcon from "@mui/icons-material/Replay";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

import { useAuth } from "../context/AuthContext";
import { GitHubIcon } from "../components/BrandIcons";
import PageHeader from "../components/PageHeader";

// Real stage keys the backend emits (ingestion-engine/src/index.js PROGRESS::
// markers, tailed by ingestion/tasks.py): "starting" fires first, then one
// entry per enabled source as it finishes, then "finalizing", then the job
// record itself flips to status "succeeded"/stage "complete".
const STEP_DEFS = [
  { stage: "starting", key: "database", label: "Connecting to sources", icon: PowerSettingsNewOutlinedIcon, always: true },
  { stage: "postgres", key: "database", label: "Reading PostgreSQL schema", icon: DnsOutlinedIcon },
  { stage: "mongo", key: "mongo_database", label: "Reading MongoDB collections", icon: StorageOutlinedIcon },
  { stage: "storage", key: "object_storage", label: "Scanning object storage", icon: CloudQueueOutlinedIcon },
  { stage: "github", key: "codebase", label: "Indexing GitHub repository", icon: GitHubIcon },
  { stage: "finalizing", key: "database", label: "Building architecture graph", icon: AccountTreeOutlinedIcon, always: true },
  { stage: "complete", key: "database", label: "Distilling claude_context", icon: AutoAwesomeIcon, always: true },
];

function StepRow({ step, status }) {
  const Icon = step.icon;
  const color = status === "done" ? "success.main" : status === "error" ? "error.main" : status === "active" ? "primary.main" : "text.disabled";
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1 }}>
      <Box sx={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color }}>
        {status === "done" ? <CheckCircleIcon sx={{ fontSize: 18 }} /> :
         status === "error" ? <ErrorOutlineIcon sx={{ fontSize: 18 }} /> :
         status === "active" ? <CircularProgress size={14} thickness={5} /> :
         <RadioButtonUncheckedIcon sx={{ fontSize: 18 }} />}
      </Box>
      <Icon fontSize="small" sx={{ color: status === "pending" ? "text.disabled" : "text.secondary" }} />
      <Typography variant="body2" sx={{ color: status === "pending" ? "text.disabled" : "text.primary", fontWeight: status === "active" ? 600 : 400 }}>
        {step.label}
      </Typography>
    </Stack>
  );
}

export default function IngestionProgress() {
  const { jobId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sourcesEnabled = location.state?.sourcesEnabled || null;
  const projectName = location.state?.projectName;

  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const cancelledRef = useRef(false);
  const lastStageRef = useRef(null);

  const steps = useMemo(() => {
    if (!sourcesEnabled) return STEP_DEFS;
    return STEP_DEFS.filter((s) => s.always || sourcesEnabled[s.key]);
  }, [sourcesEnabled]);

  const startPolling = () => {
    cancelledRef.current = false;
    lastStageRef.current = null;
    setError(null);
    setJob(null);
    setLog([]);

    const poll = async (id) => {
      if (cancelledRef.current) return;
      let status;
      try {
        status = await request(`/api/ingestion/jobs/${id}/`);
      } catch (e) {
        if (!cancelledRef.current) setError(e.message);
        return;
      }
      if (cancelledRef.current) return;
      setJob(status);
      if (status.stage && status.stage !== lastStageRef.current) {
        lastStageRef.current = status.stage;
        const stepDef = STEP_DEFS.find((s) => s.stage === status.stage);
        setLog((l) => [...l, { label: stepDef?.label || status.stage, pct: status.progress_pct, ts: Date.now() }]);
      }

      if (status.status === "succeeded") {
        setTimeout(() => { if (!cancelledRef.current) navigate(`/contexts/${status.result}`, { replace: true }); }, 500);
        return;
      }
      if (status.status === "failed") {
        setError(status.error || "Ingestion failed.");
        return;
      }
      setTimeout(() => poll(id), 2000);
    };

    poll(jobId);
  };

  useEffect(() => {
    startPolling();
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const currentStepIndex = steps.findIndex((s) => s.stage === job?.stage);
  const failed = job?.status === "failed" || !!error;

  const stepStatus = (idx) => {
    if (failed && idx === Math.max(currentStepIndex, 0)) return "error";
    if (currentStepIndex === -1) return idx === 0 ? "active" : "pending";
    if (idx < currentStepIndex) return "done";
    if (idx === currentStepIndex) return job?.status === "succeeded" ? "done" : "active";
    return "pending";
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    navigate("/ingest/new");
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageHeader
        title={projectName || "Ingestion in progress"}
        description="Runs on a background worker — you can leave this page and it'll keep going, but this view stops updating once you do."
      />

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={<Button color="inherit" size="small" startIcon={<ReplayIcon fontSize="small" />} onClick={startPolling}>Retry</Button>}
        >
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <LinearProgress variant="determinate" value={job?.progress_pct ?? 0} color={failed ? "error" : "primary"} sx={{ mb: 3 }} />
          <Box>
            {steps.map((step, idx) => <StepRow key={step.stage} step={step} status={stepStatus(idx)} />)}
          </Box>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <Box
            onClick={() => setLogOpen((o) => !o)}
            sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2.5, py: 1.5, cursor: "pointer" }}
          >
            <Typography variant="body2" fontWeight={500}>Log</Typography>
            <ExpandMoreIcon fontSize="small" sx={{ transform: logOpen ? "rotate(180deg)" : "none", transition: "transform 150ms ease", color: "text.secondary" }} />
          </Box>
          <Collapse in={logOpen}>
            <Box sx={{ borderTop: 1, borderColor: "divider", px: 2.5, py: 1.5, maxHeight: 180, overflowY: "auto", fontFamily: (t) => t.tokens.fontMono, fontSize: 12.5 }}>
              {log.map((entry, i) => (
                <Stack key={i} direction="row" spacing={1.5} sx={{ py: 0.25, color: "text.secondary" }}>
                  <Box component="span" sx={{ flexShrink: 0 }}>{new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}</Box>
                  <Box component="span">{entry.label} ({entry.pct ?? 0}%)</Box>
                </Stack>
              ))}
            </Box>
          </Collapse>
        </Card>
      )}

      <Stack direction="row" spacing={1.5}>
        {failed ? (
          <Button startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => navigate("/ingest/new")}>Back to ingestion form</Button>
        ) : (
          <Button color="inherit" onClick={handleCancel}>Cancel</Button>
        )}
      </Stack>
    </Box>
  );
}
