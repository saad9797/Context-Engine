import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import ArrowBack from "@mui/icons-material/ArrowBack";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import { useAuth } from "../context/AuthContext";
import { copyToClipboard } from "../lib/format";
import { useToast } from "../components/ToastProvider";
import PageHeader from "../components/PageHeader";

const emptyTask = { task: "", endpoints: "", access: "", rules: "", response_shape: "", paths: "" };
const fields = [
  ["task", "What do you want to build?", "Add interview scheduling for an applicant"],
  ["endpoints", "Endpoints or interfaces", "POST /interviews; GET /interviews/:id"],
  ["access", "Who can use it?", "Recruiters can schedule; applicants can view their own interviews"],
  ["rules", "Business rules and edge cases", "Reject overlapping times; validate timezone; use existing notification service"],
  ["response_shape", "Expected response", "Use the existing response helper and pagination shape"],
];

export default function ClaudeContext() {
  const { contextId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(emptyTask);
  const [budget, setBudget] = useState(4000);
  const [packType, setPackType] = useState("base");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const generation = useRef(0);

  async function generate(values, size) {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const { paths, ...task } = values;
      const output = await request(`/api/ingestion/${contextId}/context-pack/`, {
        method: "POST",
        body: { ...task, max_tokens: size, include_paths: paths.split("\n").map((s) => s.trim()).filter(Boolean) },
      });
      if (current === generation.current) { setResult(output); setDirty(false); }
    } catch (e) {
      if (current === generation.current) { setError(e.message); setResult(null); }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setForm(emptyTask); setPackType("base"); setResult(null); setBudget(4000); setDirty(false);
    generate(emptyTask, 4000);
    return () => { generation.current += 1; };
    // A snapshot change must never reuse the previous project's response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, request]);

  function edit(key, value) { setForm((old) => ({ ...old, [key]: value })); setDirty(true); }
  const pack = result?.[packType];
  const report = result?.report;
  const stale = loading || dirty || !!error;
  async function copy(asPrompt) {
    if (!pack || stale) return;
    const preface = packType === "base"
      ? "Keep this project base pack as reference for this conversation. I will send a task pack next. Do not generate code yet."
      : "Use this task pack with the matching base_id from this conversation. If that base pack or an essential contract is missing, ask for it before generating code. Follow exact ORM fields, enums, imports and access rules. Return complete changed files and commands to validate them.";
    const ok = await copyToClipboard(`${asPrompt ? preface + "\n\n" : ""}${JSON.stringify(pack)}`);
    toast(ok ? `${packType === "base" ? "Base" : "Task"} pack copied.` : "Copy unavailable. Select and copy the preview text.", ok ? "success" : "error");
  }
  const count = packType === "base" ? report?.base_size : report?.task_size;
  async function rebuild() {
    setRebuilding(true); setError("");
    try {
      const job = await request(`/api/ingestion/${contextId}/rebuild/`, { method: "POST", body: {} });
      navigate(`/ingest/${job.job_id}/progress`);
    } catch (e) { setError(e.message); }
    finally { setRebuilding(false); }
  }
  return <Box>
    <Button startIcon={<ArrowBack />} onClick={() => navigate(`/contexts/${contextId}`)} sx={{ mb: 1 }}>Back to project</Button>
    <PageHeader title="Give your AI just what it needs" description="Paste the base pack once in a conversation. Then send a small task pack for each change. Works with any AI chat that accepts text." />
    <Alert severity="info" sx={{ mb: 3 }}>Connect your repository for exact ORM models, auth contracts, and complete code examples. Database schemas alone cannot tell an AI your application’s names and conventions.</Alert>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "350px 1fr" }, gap: 3, alignItems: "start" }}>
      <Card variant="outlined"><CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Describe the change</Typography>
          {fields.map(([key, label, placeholder]) => <TextField key={key} label={label} placeholder={placeholder} multiline minRows={key === "task" || key === "rules" ? 2 : 1} fullWidth value={form[key]} onChange={(e) => edit(key, e.target.value)} disabled={loading} />)}
          <TextField label="Files to include (optional)" multiline minRows={2} helperText="One repository-relative path per line. Use this when automatic matching misses a file." placeholder={"src/controllers/interviewController.ts\nsrc/routes/interviewRoutes.ts"} value={form.paths} onChange={(e) => edit("paths", e.target.value)} disabled={loading} />
          <TextField select label="Estimated token budget per pack" value={budget} onChange={(e) => { setBudget(Number(e.target.value)); setDirty(true); }} disabled={loading}>
            {[2000, 3000, 4000, 8000, 16000].map((size) => <MenuItem key={size} value={size}>{size.toLocaleString()} tokens</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">Source code stays complete. If a file cannot fit, it is omitted and listed for review. Token counts are estimates; your AI provider’s usage limits vary.</Typography>
          <Button variant="contained" disabled={loading} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null} onClick={() => { if (form.task.trim()) setPackType("task"); generate(form, budget); }}>{loading ? "Preparing packs…" : "Prepare context packs"}</Button>
        </Stack>
      </CardContent></Card>
      <Box sx={{ minWidth: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {dirty && <Alert severity="info" sx={{ mb: 2 }}>Your requirements changed. Prepare the packs again before copying.</Alert>}
        <Card variant="outlined"><CardContent>
          <Tabs value={packType} onChange={(_, value) => setPackType(value)} aria-label="Context pack type" sx={{ mb: 2 }}>
            <Tab value="base" label="1. Base pack" /><Tab value="task" label="2. Task pack" />
          </Tabs>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{packType === "base" ? "Paste once at the start of a new conversation: runtime stack, shared plumbing, and one complete implementation example. Recopy after a new snapshot." : "Paste for each new request: your requirements, relevant models and enums, and code selected by task names and local imports."}</Typography>
          <Stack direction="row" sx={{ mb: 2, gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip size="small" label={count == null ? "Preparing…" : `~${count.toLocaleString()} tokens`} />
            {result?.base.base_id && <Chip size="small" variant="outlined" label={`Base ${result.base.base_id.slice(0, 8)}`} />}
            <Button size="small" startIcon={<ContentCopy />} onClick={() => copy(false)} disabled={!pack || stale || (packType === "task" && !pack.request.task)}>Copy JSON</Button>
            <Button size="small" variant="contained" onClick={() => copy(true)} disabled={!pack || stale || (packType === "task" && !pack.request.task)}>Copy for AI chat</Button>
          </Stack>
          {loading && <CircularProgress size={24} sx={{ my: 2 }} />}
          {pack && <Box component="pre" tabIndex={0} aria-label={`${packType} pack preview`} sx={{ fontSize: 12, lineHeight: 1.7, maxHeight: 620, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", p: 2, bgcolor: "action.hover", borderRadius: 1, opacity: stale ? .5 : 1 }}>{JSON.stringify(pack, null, 2)}</Box>}
        </CardContent></Card>
        {report && <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">{report.privacy}</Alert>
          {!!report.missing.length && <Alert severity="warning"><strong>Context gaps to review</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{report.missing.map((item) => <li key={item}>{item}</li>)}</Box><Button size="small" disabled={rebuilding || loading} onClick={rebuild}>{rebuilding ? "Starting rebuild…" : "Rebuild from connected sources"}</Button></Alert>}
          <Card variant="outlined"><CardContent>
            <Typography variant="subtitle2">Why these files?</Typography>
            <Typography variant="caption" color="text.secondary">{report.selection}</Typography>
            <Box component="ul" sx={{ pl: 2, fontSize: 12 }}>{report.included.map((item, index) => <li key={index}><strong>{item.path}</strong> — {item.reason} ({item.pack})</li>)}</Box>
            {!!report.omitted.length && <Box component="details"><summary>{report.omitted.length} files or blocks omitted</summary><Box component="ul" sx={{ pl: 2, fontSize: 12 }}>{report.omitted.map((item, index) => <li key={index}>{item.path} — {item.reason}</li>)}</Box></Box>}
          </CardContent></Card>
        </Stack>}
      </Box>
    </Box>
  </Box>;
}
