import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import ArrowBack from "@mui/icons-material/ArrowBack";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import { useAuth } from "../context/AuthContext";
import { copyToClipboard } from "../lib/format";
import { useToast } from "../components/ToastProvider";
import PageHeader from "../components/PageHeader";
import SavedHandoffs from "../components/SavedHandoffs";
import SnapshotBuildScreen from "../components/SnapshotBuildScreen";
import ClaudeHandoff, { useClaudeHandoff } from "../components/ClaudeHandoff";

const emptyTask = { retrieval_mode: 'fast', task: "", endpoints: "", access: "", rules: "", response_shape: "", acceptance: "", follow_up: "", paths: "", symbols: "" };
const fields = [
  ["task", "What do you want to build?", "Add interview scheduling for an applicant"],
  ["endpoints", "Endpoints or interfaces", "POST /interviews; GET /interviews/:id"],
  ["access", "Who can use it?", "Recruiters can schedule; applicants can view their own interviews"],
  ["rules", "Business rules and edge cases", "Reject overlapping times; validate timezone; use existing notification service"],
  ["response_shape", "Expected response", "Use the existing response helper and pagination shape"],
  ["acceptance", "How will you know it works?", "An authorized user can schedule; overlapping times fail; existing tests still pass"],
];

export default function ClaudeContext() {
  const { contextId } = useParams();
  const { request } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState(emptyTask);
  const [budget, setBudget] = useState(10000);
  const [packType, setPackType] = useState("handoff");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(null);
  const [openClaudeWhenReady, setOpenClaudeWhenReady] = useState(false);
  const claude = useClaudeHandoff(contextId, request);
  const generation = useRef(0);
  const resumeKey = `contexa-preparation:${contextId}`;

  async function pollPrepared(preparationId, current, initial = null) {
    const deadline = Date.now() + 30 * 60 * 1000;
    let job = initial;
    while (current === generation.current) {
      if (job?.status === 'pending') setProgress({ stage: 'Waiting for the preparation worker' });
      else if (job?.progress) setProgress(job.progress);
      if (job?.status === 'succeeded') return { ...job.output, preparation_id: preparationId };
      if (job?.status === 'failed') throw new Error(job.error || 'Context preparation failed. Retry.');
      if (Date.now() > deadline) throw new Error('Preparation is taking too long. Check the worker service and retry.');
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (current !== generation.current) return null;
      job = await request(`/api/ingestion/${contextId}/prepare/${preparationId}/`);
    }
    return null;
  }

  async function generate(values, size) {
    const claudeTab = openClaudeWhenReady && values.task.trim() ? claude.reserve() : null;
    const current = ++generation.current;
    setLoading(true); setError(""); setProgress(null);
    try {
      const { paths, symbols, ...task } = values;
      let output = await request(`/api/ingestion/${contextId}/${task.task.trim() ? 'prepare' : 'context-pack'}/`, {
        method: "POST",
        body: { ...task, max_tokens: size, include_paths: paths.split("\n").map((s) => s.trim()).filter(Boolean), include_symbols: symbols.split("\n").map((s) => s.trim()).filter(Boolean) },
      });
      if (output.preparation_id) {
        const preparationId = output.preparation_id;
        try { sessionStorage.setItem(resumeKey, preparationId); } catch { /* storage can be disabled */ }
        output = await pollPrepared(preparationId, current);
      }
      if (current !== generation.current) { claude.cancel(claudeTab); return; }
      if (!output?.handoff || !output?.base || !output?.report) throw new Error('The prepared context response was incomplete. Please retry.');
      if (current === generation.current) { setResult(output); setDirty(false); setCopied(false); }
      if (claudeTab) await claude.launch(output.handoff, claudeTab);
    } catch (e) {
      claude.cancel(claudeTab, 'Context preparation failed. Fix the preparation error below, then try again.');
      if (current === generation.current) { setError(e.message); setResult(null); try { sessionStorage.removeItem(resumeKey); } catch { /* optional */ } }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setForm(emptyTask); setPackType("handoff"); setResult(null); setBudget(10000); setDirty(false); setCopied(false);
    let remembered;
    try { remembered = sessionStorage.getItem(resumeKey); } catch { /* optional */ }
    if (remembered) {
      const current = ++generation.current;
      setLoading(true); setError('');
      (async () => {
        try {
          const job = await request(`/api/ingestion/${contextId}/prepare/${remembered}/`);
          if (current !== generation.current) return;
          const { include_paths = [], include_symbols = [], max_tokens = 10000, ...task } = job.request || {};
          setForm({ ...emptyTask, ...task, paths: include_paths.join('\n'), symbols: include_symbols.join('\n') });
          setBudget(max_tokens);
          const output = await pollPrepared(remembered, current, job);
          if (current === generation.current) setResult(output);
        } catch (e) {
          if (current === generation.current) { setError(e.message); try { sessionStorage.removeItem(resumeKey); } catch { /* optional */ } }
        } finally { if (current === generation.current) setLoading(false); }
      })();
    } else if (location.state?.carryTask) {
      const current = ++generation.current;
      const previous = location.state.carryTask;
      setLoading(true); setError('');
      request(`/api/ingestion/${previous.contextId}/prepare/${previous.preparationId}/`).then(job => {
        if (current !== generation.current) return;
        const { include_paths = [], include_symbols = [], max_tokens = 10000, ...task } = job.request || {};
        const values = { ...emptyTask, ...task, paths: include_paths.join('\n'), symbols: include_symbols.join('\n') };
        setForm(values); setBudget(max_tokens);
        return generate(values, max_tokens);
      }).catch(e => { if (current === generation.current) { setError(e.message); setLoading(false); } });
    } else generate(emptyTask, 10000);
    return () => { generation.current += 1; };
    // A snapshot change must never reuse the previous project's response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, request]);

  function edit(key, value) { setForm((old) => ({ ...old, [key]: value })); setDirty(true); }
  const { paths: pinnedPaths, symbols: pinnedSymbols, ...taskFields } = form;
  const savedValues = { ...taskFields, max_tokens: budget, include_paths: pinnedPaths.split('\n').map(s => s.trim()).filter(Boolean), include_symbols: pinnedSymbols.split('\n').map(s => s.trim()).filter(Boolean), ...(result?.preparation_id ? { preparation_id: result.preparation_id } : {}) };
  function restoreSaved(saved) {
    generation.current += 1;
    try { sessionStorage.removeItem(resumeKey); } catch { /* optional */ }
    const { include_paths = [], include_symbols = [], max_tokens = 10000, ...task } = saved.request;
    setForm({ ...emptyTask, ...task, paths: include_paths.join('\n'), symbols: include_symbols.join('\n') });
    setBudget(max_tokens); setResult(saved.output); setPackType('handoff'); setDirty(false); setError(''); setLoading(false);
  }
  const pack = result?.[packType];
  const report = result?.report;
  const visibleGaps = packType === "handoff" ? pack?.context_gaps || [] : report?.missing || [];
  const canRebuild = !!report?.dependency_gaps?.some(gap => gap.module) || report?.missing?.some(gap => /captur|unavailable|Requested file|Prisma detected|No complete repository/i.test(gap));
  const stale = loading || dirty || !!error;
  const carryTask = result?.preparation_id ? { contextId, preparationId: result.preparation_id } : undefined;
  async function copy(asPrompt) {
    if (!pack || stale) return;
    const preface = packType === "handoff" ? "Implement the request using this self-contained context. Review context_gaps and ask for missing contracts first."
      : packType === "base"
      ? "Keep this project base pack as reference for this conversation. I will send a task pack next. Do not generate code yet."
      : "Use this task pack with the matching base_id from this conversation. If that base pack or an essential contract is missing, ask for it before generating code. Follow exact ORM fields, enums, imports and access rules. Return complete changed files and commands to validate them.";
    const ok = await copyToClipboard(`${asPrompt && packType !== 'handoff' ? preface + "\n\n" : ""}${JSON.stringify(pack)}`);
    if (ok) setCopied(true);
    toast(ok ? `${packType === "handoff" ? "AI handoff" : packType === "base" ? "Base pack" : "Task pack"} copied.` : "Copy unavailable. Select and copy the preview text.", ok ? "success" : "error");
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
      const paths = [...new Set([...form.paths.split("\n"), ...(report?.requested_paths || []), ...form.symbols.split("\n").filter(s => s.includes("#")).map(s => s.split("#")[0])].map(s => s.trim()).filter(Boolean))].slice(0, 15);
      const job = await request(`/api/ingestion/${contextId}/rebuild/`, { method: "POST", body: { include_paths: paths } });
      navigate(`/ingest/${job.job_id}/progress`, { state: { carryTask } });
    } catch (e) { setError(e.message); }
    finally { setRebuilding(false); }
  }
  if (rebuilding) return <SnapshotBuildScreen open rebuilding />;
  return <Box>
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
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 3 }} aria-label="Change workflow">
      <Chip label="1. Describe a focused change" color={!result?.handoff?.request?.task ? 'primary' : 'default'} />
      <Chip label="2. Review and copy context" color={result?.handoff?.request?.task && !copied ? 'primary' : 'default'} />
      <Chip label="3. Apply changes and run checks" color={copied ? 'primary' : 'default'} />
      <Chip label="4. Resolve missing context or errors below" variant="outlined" />
    </Stack>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "350px 1fr" }, gap: 3, alignItems: "start" }}>
      <Card variant="outlined"><CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Describe the change</Typography>
          <TextField select label="Search approach" value={form.retrieval_mode} onChange={e => edit('retrieval_mode', e.target.value)} disabled={loading} helperText={form.retrieval_mode === 'semantic' ? 'Adds matches by meaning. First search may take several minutes; results still need review.' : 'Searches source names, keywords and dependencies without waiting for model indexing. Use exact files or symbols to improve scope.'}>
            <MenuItem value="fast">Fast source search (recommended)</MenuItem>
            <MenuItem value="semantic">Expanded semantic search (slower)</MenuItem>
          </TextField>
          {fields.map(([key, label, placeholder]) => <TextField key={key} label={label} placeholder={placeholder} multiline minRows={key === "task" || key === "rules" ? 2 : 1} fullWidth value={form[key]} onChange={(e) => edit(key, e.target.value)} disabled={loading} />)}
          <TextField label="Files to include (optional)" multiline minRows={2} helperText="One repository-relative path per line. Use this when automatic matching misses a file." placeholder={"src/controllers/interviewController.ts\nsrc/routes/interviewRoutes.ts"} value={form.paths} onChange={(e) => edit("paths", e.target.value)} disabled={loading} />
          <TextField label="Additional symbols (optional)" multiline minRows={2} helperText="If the AI asks for more context, enter exact declaration names or path#symbol, one per line." placeholder={"validateInterview\nsrc/types/session.ts#SessionUser"} value={form.symbols} onChange={(e) => edit("symbols", e.target.value)} disabled={loading} />
          <TextField select label="Estimated token budget per copy" value={budget} onChange={(e) => { setBudget(Number(e.target.value)); setDirty(true); }} disabled={loading}>
            {[...new Set([2000, 3000, 4000, 8000, 16000, 32000, budget, report?.suggested_handoff_budget].filter(Boolean))].sort((a, b) => a - b).map((size) => <MenuItem key={size} value={size}>{size.toLocaleString()} tokens</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">Complete source units are preserved. Large modules may contribute only relevant declarations; omitted contracts are listed. Smaller budgets can omit required contracts. Token counts are estimates; your AI provider’s usage limits vary.</Typography>
          <Button variant="contained" disabled={loading} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null} onClick={() => { if (form.task.trim()) setPackType("handoff"); generate(form, budget); }}>{loading ? "Preparing packs…" : "Prepare context packs"}</Button>
        </Stack>
      </CardContent></Card>
      <Box sx={{ minWidth: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {dirty && <Alert severity="info" sx={{ mb: 2 }}>Your requirements changed. Prepare the packs again before copying.</Alert>}
        <Card variant="outlined"><CardContent>
          <Tabs value={packType} onChange={(_, value) => setPackType(value)} aria-label="Context pack type" sx={{ mb: 2 }}>
            <Tab value="handoff" label="AI handoff" /><Tab value="base" label="Reusable base" /><Tab value="task" label="Task only" />
          </Tabs>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{packType === "handoff" ? "One copy includes your task, selected source, imports and model contracts within a single estimated budget. No earlier base pack is needed. Review gaps before requesting code." : packType === "base" ? "Paste once at the start of a new conversation: runtime stack, shared plumbing, and one complete implementation example. Recopy after a new snapshot." : "Paste for each new request using the matching reusable base: requirements, relevant models and enums, and source selected by symbols and local dependencies."}</Typography>
          {report?.coverage && <Alert severity={report.coverage.partial ? 'warning' : 'info'} sx={{ mb: 2 }}>
            {report.coverage.captured_files} files captured{report.coverage.candidate_files != null ? ` of ${report.coverage.candidate_files} eligible files` : ''}. {report.coverage.partial ? 'Capture is partial. Rebuild with missing paths before relying on this context.' : report.coverage.scope}
          </Alert>}
          {report?.retrieval && <Typography variant="caption" display="block" sx={{ mb: 2 }} color="text.secondary">
            {report.retrieval.status === 'fast' ? 'Fast source search used names, keywords and local dependencies. Semantic search was not requested; matches that use different terminology may be missed.' : report.retrieval.status === 'exact_scope' ? 'An exact declaration was specified; its source and dependencies were selected directly.' : report.retrieval.status === 'ready' ? 'Semantic code search and exact-name search were combined, then local dependencies were followed.' : `Exact-name and keyword search with dependency analysis. Semantic search ${report.retrieval.status === 'disabled' ? 'is disabled' : 'was unavailable for this request'}; ordinary-language matches may be missed.`}
            {report.retrieval.semantic_only && ' Matches are based on meaning without identifier overlap; review selected source carefully.'}
          </Typography>}
          <Stack direction="row" sx={{ mb: 2, gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip size="small" color={error ? 'error' : 'default'} label={loading ? 'Preparing…' : error ? 'Preparation failed' : count == null ? 'No context prepared' : `~${count.toLocaleString()} tokens`} />
            {report?.source_files_available != null && <Chip size="small" variant="outlined" label={`${report.source_files_available} captured source files`} />}
            {packType === "handoff" && pack?.request?.task && <Chip size="small" color={pack.status === "incomplete" ? "warning" : "default"} label={pack.status === "incomplete" ? "Missing contracts" : "Ready to review"} />}
            {result?.base?.base_id && <Chip size="small" variant="outlined" label={`Base ${result.base.base_id.slice(0, 8)}`} />}
            <Button size="small" startIcon={<ContentCopy />} onClick={() => copy(false)} disabled={copyDisabled}>Copy JSON</Button>
            <Button size="small" variant="contained" onClick={() => copy(true)} disabled={copyDisabled}>Copy for AI chat</Button>
            <Button size="small" onClick={download} disabled={copyDisabled}>Download JSON</Button>
          </Stack>
          <ClaudeHandoff handoff={result?.handoff} disabled={stale || !result?.handoff?.request?.task} controller={claude} />
          <FormControlLabel sx={{ mb: 2 }} control={<Checkbox checked={openClaudeWhenReady} disabled={loading || claude.busy} onChange={event => setOpenClaudeWhenReady(event.target.checked)} />} label="Open Claude automatically after I prepare a task" />
          {packType === "handoff" && pack?.status === "incomplete" && <Alert severity="warning" sx={{ mb: 2 }}>This handoff has missing contracts. Increase the budget, rebuild missing source, or request a narrower task before generating code.
            {report?.suggested_handoff_budget > budget && <Button size="small" disabled={loading} onClick={() => { const size = report.suggested_handoff_budget; setBudget(size); setDirty(true); generate(form, size); }}>Try {report.suggested_handoff_budget.toLocaleString()} token budget</Button>}
          </Alert>}
          {loading && <Stack direction="row" spacing={2} sx={{ my: 2, alignItems: 'center' }}><CircularProgress size={24} /><Box><Typography variant="body2" role="status">{progress?.stage || 'Searching source and tracing dependencies'}{progress?.total ? `: ${progress.completed} / ${progress.total} source sections` : ''}</Typography><Typography variant="caption">{form.retrieval_mode === 'semantic' ? 'Initial semantic indexing can take several minutes. Later searches reuse this snapshot’s index.' : 'Fast search does not load the semantic model. Server startup and a busy worker can delay preparation.'} Preparation resumes if you reload this page.</Typography></Box></Stack>}
          {copied && <Alert severity="success" sx={{ mb: 2 }}>Paste this into your AI chat. Review its changes, apply them locally, and run the project checks. If it asks for source or a check fails, use the follow-up box below.</Alert>}
          {pack?.source?.kind === 'folder' && <Alert severity="info" sx={{ mb: 2 }}>This is a snapshot of your selected local files. Reimport the folder after code changes; Contexa cannot check your local folder for updates. <Button size="small" disabled={stale} onClick={() => navigate('/ingest/new', { state: { carryTask } })}>Import updated folder</Button></Alert>}
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
          {pack && <Box component="details"><summary>Inspect export JSON</summary><Box component="pre" tabIndex={0} aria-label={`${packType} pack preview`} sx={{ fontSize: 12, lineHeight: 1.7, maxHeight: 620, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", p: 2, bgcolor: "action.hover", borderRadius: 1, opacity: stale ? .5 : 1 }}>{JSON.stringify(pack, null, 2)}</Box></Box>}
        </CardContent></Card>
        <Card variant="outlined" sx={{ mt: 2 }}><CardContent><Stack spacing={2}>
          <Typography variant="h6">Continue with missing context or a failed check</Typography>
          <Typography variant="body2" color="text.secondary">Paste your AI’s request for more source, or the relevant compiler/test error. Your original change and requirements stay attached. The refreshed handoff replaces the earlier export for this snapshot. Remove credentials from logs before pasting.</Typography>
          <TextField label="AI request or validation error" multiline minRows={4} fullWidth value={form.follow_up} onChange={e => edit('follow_up', e.target.value)} disabled={loading} slotProps={{ htmlInput: { maxLength: 8000 } }} placeholder={'Please provide src/auth/permissions.ts and the Invoice model.\nOr paste the failing command and its error here.'} />
          <Button variant="outlined" disabled={loading || !form.follow_up.trim() || !form.task.trim()} onClick={() => { setPackType('handoff'); generate(form, budget); }}>Prepare follow-up context</Button>
          {!form.task.trim() && <Typography variant="caption">Describe the original change first so follow-ups stay focused.</Typography>}
          <Typography variant="caption" color="text.secondary">After changing code, import or rebuild a fresh snapshot before requesting another implementation. Contexa does not run your project’s checks.</Typography>
        </Stack></CardContent></Card>
        {report && <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">{report.privacy}</Alert>
          {!!report.dependency_gaps?.length && <Alert severity="warning"><strong>Dependencies to resolve</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{report.dependency_gaps.map((gap, index) => <li key={index}>{gap.path}{gap.module ? ` → ${gap.module}` : gap.symbols?.length ? `: ${gap.symbols.slice(0, 3).join(", ")}` : ""} — {gap.reason}</li>)}</Box></Alert>}
          {packType === "handoff" && !!report.handoff_omitted?.length && <Alert severity="warning"><strong>Outside this copy’s budget</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{report.handoff_omitted.map((gap, index) => <li key={index}>{gap.path}{gap.symbols?.length ? `: ${gap.symbols.slice(0, 3).join(", ")}` : ""}</li>)}</Box></Alert>}
          {!!visibleGaps.length && <Alert severity="warning"><strong>Context gaps to review</strong><Box component="ul" sx={{ pl: 2, mb: 0 }}>{visibleGaps.map((item) => <li key={item}>{item}</li>)}</Box>{canRebuild && pack?.source?.kind !== 'folder' && <Button size="small" disabled={rebuilding || loading} onClick={rebuild}>{rebuilding ? "Rebuilding - keep this page open..." : "Rebuild from connected sources"}</Button>}</Alert>}
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
