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
import SavedHandoffs from "../components/SavedHandoffs";
import SnapshotBuildScreen from "../components/SnapshotBuildScreen";

const emptyTask = { task: "", endpoints: "", access: "", rules: "", response_shape: "", paths: "", symbols: "" };
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
  const [packType, setPackType] = useState("handoff");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const generation = useRef(0);

  async function generate(values, size) {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const { paths, symbols, ...task } = values;
      const output = await request(`/api/ingestion/${contextId}/context-pack/`, {
        method: "POST",
        body: { ...task, max_tokens: size, include_paths: paths.split("\n").map((s) => s.trim()).filter(Boolean), include_symbols: symbols.split("\n").map((s) => s.trim()).filter(Boolean) },
      });
      if (current === generation.current) { setResult(output); setDirty(false); }
    } catch (e) {
      if (current === generation.current) { setError(e.message); setResult(null); }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setForm(emptyTask); setPackType("handoff"); setResult(null); setBudget(4000); setDirty(false);
    generate(emptyTask, 4000);
    return () => { generation.current += 1; };
    // A snapshot change must never reuse the previous project's response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, request]);

  function edit(key, value) { setForm((old) => ({ ...old, [key]: value })); setDirty(true); }
  const { paths: pinnedPaths, symbols: pinnedSymbols, ...taskFields } = form;
  const savedValues = { ...taskFields, max_tokens: budget, include_paths: pinnedPaths.split('\n').map(s => s.trim()).filter(Boolean), include_symbols: pinnedSymbols.split('\n').map(s => s.trim()).filter(Boolean) };
  function restoreSaved(saved) {
    generation.current += 1;
    const { include_paths = [], include_symbols = [], max_tokens = 4000, ...task } = saved.request;
    setForm({ ...emptyTask, ...task, paths: include_paths.join('\n'), symbols: include_symbols.join('\n') });
    setBudget(max_tokens); setResult(saved.output); setPackType('handoff'); setDirty(false); setError(''); setLoading(false);
  }
  const pack = result?.[packType];
  const report = result?.report;
  const visibleGaps = packType === "handoff" ? pack?.context_gaps || [] : report?.missing || [];
  const canRebuild = !!report?.dependency_gaps?.some(gap => gap.module) || report?.missing?.some(gap => /captur|unavailable|Requested file|Prisma detected|No complete repository/i.test(gap));
  const stale = loading || dirty || !!error;
  async function copy(asPrompt) {
    if (!pack || stale) return;
    const preface = packType === "handoff" ? "Implement the request using this self-contained context. Review context_gaps and ask for missing contracts first."
      : packType === "base"
      ? "Keep this project base pack as reference for this conversation. I will send a task pack next. Do not generate code yet."
      : "Use this task pack with the matching base_id from this conversation. If that base pack or an essential contract is missing, ask for it before generating code. Follow exact ORM fields, enums, imports and access rules. Return complete changed files and commands to validate them.";
    const ok = await copyToClipboard(`${asPrompt ? preface + "\n\n" : ""}${JSON.stringify(pack)}`);
    toast(ok ? `${packType === "handoff" ? "Complete handoff" : packType === "base" ? "Base pack" : "Task pack"} copied.` : "Copy unavailable. Select and copy the preview text.", ok ? "success" : "error");
  }
  const count = packType === "handoff" ? report?.handoff_size : packType === "base" ? report?.base_size : report?.task_size;
  const copyDisabled = !pack || stale || (packType !== "base" && !pack?.request?.task);
  function download() {
    if (copyDisabled) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `contexa-${packType}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function rebuild() {
    setRebuilding(true); setError("");
    try {
      const paths = [...new Set([...form.paths.split("\n"), ...form.symbols.split("\n").filter(s => s.includes("#")).map(s => s.split("#")[0].trim()).filter(Boolean)])];
      const job = await request(`/api/ingestion/${contextId}/rebuild/`, { method: "POST", body: { include_paths: paths } });
      navigate(`/ingest/${job.job_id}/progress`);
    } catch (e) { setError(e.message); }
    finally { setRebuilding(false); }
  }
  return <Box>
    <SnapshotBuildScreen open={rebuilding} rebuilding />
    <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between' }}>
      <Button startIcon={<ArrowBack />} onClick={() => navigate(`/contexts/${contextId}`)}>Back to project</Button>
      <Button color="error" disabled={deleting || loading} onClick={async () => {
        if (!window.confirm('Delete this project snapshot and all its saved handoffs? This cannot be undone. Connected sources will stay connected.')) return;
        setDeleting(true);
        try { await request(`/api/ingestion/${contextId}/`, { method: 'DELETE' }); navigate('/dashboard'); }
        catch (e) { setError(e.message); setDeleting(false); }
      }}>Delete snapshot</Button>
    </Stack>
    <PageHeader title="Prepare context for your next change" description="Describe the task, review selected contracts, then copy one self-contained handoff into your AI chat. Reusable base and task packs are also available." />
    <Alert severity="info" sx={{ mb: 3 }}>Use repository or folder source for exact ORM models, auth contracts, and code examples. Database schemas alone cannot tell an AI your application’s names and conventions.</Alert>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "350px 1fr" }, gap: 3, alignItems: "start" }}>
      <Card variant="outlined"><CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Describe the change</Typography>
          {fields.map(([key, label, placeholder]) => <TextField key={key} label={label} placeholder={placeholder} multiline minRows={key === "task" || key === "rules" ? 2 : 1} fullWidth value={form[key]} onChange={(e) => edit(key, e.target.value)} disabled={loading} />)}
          <TextField label="Files to include (optional)" multiline minRows={2} helperText="One repository-relative path per line. Use this when automatic matching misses a file." placeholder={"src/controllers/interviewController.ts\nsrc/routes/interviewRoutes.ts"} value={form.paths} onChange={(e) => edit("paths", e.target.value)} disabled={loading} />
          <TextField label="Additional symbols (optional)" multiline minRows={2} helperText="If the AI asks for more context, enter exact declaration names or path#symbol, one per line." placeholder={"validateInterview\nsrc/types/session.ts#SessionUser"} value={form.symbols} onChange={(e) => edit("symbols", e.target.value)} disabled={loading} />
          <TextField select label="Estimated token budget per copy" value={budget} onChange={(e) => { setBudget(Number(e.target.value)); setDirty(true); }} disabled={loading}>
            {[...new Set([2000, 3000, 4000, 8000, 16000, 32000, budget, report?.suggested_handoff_budget].filter(Boolean))].sort((a, b) => a - b).map((size) => <MenuItem key={size} value={size}>{size.toLocaleString()} tokens</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">Complete source units are preserved. Large modules may contribute only relevant declarations; omitted contracts are listed. Token counts are estimates; your AI provider’s usage limits vary.</Typography>
          <Button variant="contained" disabled={loading} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null} onClick={() => { if (form.task.trim()) setPackType("handoff"); generate(form, budget); }}>{loading ? "Preparing packs…" : "Prepare context packs"}</Button>
        </Stack>
      </CardContent></Card>
      <Box sx={{ minWidth: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {dirty && <Alert severity="info" sx={{ mb: 2 }}>Your requirements changed. Prepare the packs again before copying.</Alert>}
        <Card variant="outlined"><CardContent>
          <Tabs value={packType} onChange={(_, value) => setPackType(value)} aria-label="Context pack type" sx={{ mb: 2 }}>
            <Tab value="handoff" label="Complete handoff" /><Tab value="base" label="Reusable base" /><Tab value="task" label="Task only" />
          </Tabs>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{packType === "handoff" ? "One copy includes your task, selected source, imports and model contracts within a single estimated budget. No earlier base pack is needed. Review gaps before requesting code." : packType === "base" ? "Paste once at the start of a new conversation: runtime stack, shared plumbing, and one complete implementation example. Recopy after a new snapshot." : "Paste for each new request using the matching reusable base: requirements, relevant models and enums, and source selected by symbols and local dependencies."}</Typography>
          <Stack direction="row" sx={{ mb: 2, gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip size="small" label={count == null ? "Preparing…" : `~${count.toLocaleString()} tokens`} />
            {report?.source_files_available != null && <Chip size="small" variant="outlined" label={`${report.source_files_available} captured source files`} />}
            {packType === "handoff" && pack?.request?.task && <Chip size="small" color={pack.status === "incomplete" ? "warning" : "default"} label={pack.status === "incomplete" ? "Missing contracts" : "Ready to review"} />}
            {result?.base.base_id && <Chip size="small" variant="outlined" label={`Base ${result.base.base_id.slice(0, 8)}`} />}
            <Button size="small" startIcon={<ContentCopy />} onClick={() => copy(false)} disabled={copyDisabled}>Copy JSON</Button>
            <Button size="small" variant="contained" onClick={() => copy(true)} disabled={copyDisabled}>Copy for AI chat</Button>
            <Button size="small" onClick={download} disabled={copyDisabled}>Download JSON</Button>
          </Stack>
          {packType === "handoff" && pack?.status === "incomplete" && <Alert severity="warning" sx={{ mb: 2 }}>This handoff has missing contracts. Increase the budget, rebuild missing source, or request a narrower task before generating code.
            {report?.suggested_handoff_budget > budget && <Button size="small" disabled={loading} onClick={() => { const size = report.suggested_handoff_budget; setBudget(size); setDirty(true); generate(form, size); }}>Try {report.suggested_handoff_budget.toLocaleString()} token budget</Button>}
          </Alert>}
          {loading && <CircularProgress size={24} sx={{ my: 2 }} />}
          {pack?.source?.kind === 'folder' && <Alert severity="info" sx={{ mb: 2 }}>This is a snapshot of your selected local files. Reimport the folder after code changes; Contexa cannot check your local folder for updates.</Alert>}
          <SavedHandoffs contextId={contextId} values={savedValues} disabled={stale || !form.task.trim() || !result} onRestore={restoreSaved} />
          {packType === 'handoff' && pack?.validation && <Box component="details" sx={{ mb: 2 }}><summary>Project validation commands ({pack.validation.commands.length})</summary>
            <Typography variant="caption">{pack.validation.execution}</Typography>
            {pack.validation.commands.map((check, index) => <Box key={index} sx={{ my: 1 }}><Typography component="code" variant="body2">{check.command}</Typography><Typography variant="caption" display="block">Run in {check.working_directory} • declared in {check.declared_in}</Typography></Box>)}
            {pack.validation.missing.map(text => <Typography key={text} variant="body2">{text}</Typography>)}
          </Box>}
          {!!pack?.code?.length && <Box component="details" sx={{ mb: 2 }}><summary>Review selected source ({pack.code.length} units)</summary>
            {pack.code.map((unit, index) => <Box key={index} component="details" sx={{ my: 1 }}><summary>{unit.path}{unit.start_line ? `:${unit.start_line}–${unit.end_line}` : ''}{unit.redacted ? ' (credential patterns redacted)' : ''}</summary>
              <Box component="pre" sx={{ fontSize: 12, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{[...(unit.imports || []), unit.content].join('\n')}</Box>
            </Box>)}
          </Box>}
          {pack && <Box component="pre" tabIndex={0} aria-label={`${packType} pack preview`} sx={{ fontSize: 12, lineHeight: 1.7, maxHeight: 620, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", p: 2, bgcolor: "action.hover", borderRadius: 1, opacity: stale ? .5 : 1 }}>{JSON.stringify(pack, null, 2)}</Box>}
        </CardContent></Card>
        {report && <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">{report.privacy}</Alert>
          {!!report.dependency_gaps?.length && <Alert severity="warning"><strong>Dependencies to resolve</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{report.dependency_gaps.map((gap, index) => <li key={index}>{gap.path}{gap.module ? ` → ${gap.module}` : gap.symbols?.length ? `: ${gap.symbols.slice(0, 3).join(", ")}` : ""} — {gap.reason}</li>)}</Box></Alert>}
          {packType === "handoff" && !!report.handoff_omitted?.length && <Alert severity="warning"><strong>Outside this copy’s budget</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{report.handoff_omitted.map((gap, index) => <li key={index}>{gap.path}{gap.symbols?.length ? `: ${gap.symbols.slice(0, 3).join(", ")}` : ""}</li>)}</Box></Alert>}
          {!!visibleGaps.length && <Alert severity="warning"><strong>Context gaps to review</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{visibleGaps.map((item) => <li key={item}>{item}</li>)}</Box>{canRebuild && <Button size="small" disabled={rebuilding || loading} onClick={rebuild}>{rebuilding ? "Rebuilding - keep this page open..." : "Rebuild from connected sources"}</Button>}</Alert>}
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
