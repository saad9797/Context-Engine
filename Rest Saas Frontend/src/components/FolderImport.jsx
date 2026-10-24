import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { prepareFolder } from '../lib/folderImport';
import { prepareZip } from '../lib/zipImport';

function SourceReview({ file, busy, exclude }) {
  const [open, setOpen] = useState(false);
  return <Box component="details" sx={{ my: 1 }} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{file.path}</summary>
    {open && <>
      <Button size="small" disabled={busy} onClick={exclude}>Exclude file</Button>
      <Box component="pre" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{file.content}</Box>
    </>}
  </Box>;
}

export default function FolderImport() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const generation = useRef(0);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(event, zip = false) {
    const selected = event.target.files;
    if (!selected?.length) return;
    const current = ++generation.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const next = zip ? await prepareZip(selected[0]) : await prepareFolder(selected);
      if (current === generation.current) { setPreview(next); setName(next.projectName); }
    } catch (e) { if (current === generation.current) setError(zip ? (e.message || 'Could not read this ZIP. Choose a valid, unencrypted source archive.') : 'Could not read this folder. Select a smaller folder containing UTF-8 source files.'); }
    finally { if (current === generation.current) setBusy(false); event.target.value = ''; }
  }
  async function upload() {
    setBusy(true); setError('');
    try {
      const saved = await request('/api/ingestion/import/', { method: 'POST', body: { project_name: name.trim(), files: preview.files, omitted_source_files: preview.omittedSourceFiles || 0 } });
      navigate(`/contexts/${saved.id}/claude-context`, { state: { carryTask: location.state?.carryTask } });
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return <Card variant="outlined" sx={{ mb: 3 }}><CardContent><Stack spacing={2}>
    <Typography variant="h6">Import your project source</Typography>
    <Typography variant="body2" color="text.secondary">Choose a source ZIP or project folder, then review the files before creating a snapshot. ZIPs are opened on your device; only the reviewed source files are uploaded when you continue.</Typography>
    <Typography variant="body2" color="text.secondary">For a ZIP, include your application source and package manifests. Leave out .env files, credentials, node_modules, virtual environments, .git, and build output. Maximum ZIP size: 25 MB; source limits below apply after extraction.</Typography>
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button component="label" variant="contained" disabled={busy}>Choose ZIP<input aria-label="Choose project ZIP" type="file" accept=".zip,application/zip" hidden onChange={event => choose(event, true)} /></Button>
      <Button component="label" variant="outlined" disabled={busy}>Choose folder<input aria-label="Choose project folder" type="file" webkitdirectory="" multiple hidden onChange={event => choose(event)} /></Button>
      <Button component="label" disabled={busy}>Choose files<input aria-label="Choose source files" type="file" multiple hidden onChange={event => choose(event)} /></Button>
      {busy && <CircularProgress size={22} />}
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {preview && <>
      <TextField label="Imported project name" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 255 } }} disabled={busy} />
      <Alert severity="info">{preview.files.length} source files • {(preview.bytes / 1000).toFixed(0)} KB. Limit: 1,200 files, 512 KB per file, 12 MB total. Source is stored in your account; known credential patterns are redacted on the server. Review proprietary code before sharing it with an AI.</Alert>
      {!!preview.ignoredFiles && <Alert severity="info">{preview.ignoredFiles.toLocaleString()} files left out by the import filters (dependencies, generated files, credentials, unsupported formats, or unsafe/duplicate paths). This count does not mean your source limit was reached. See the excluded list for details.</Alert>}
      {!!preview.omittedSourceFiles && <Alert severity="warning">{preview.omittedSourceFiles} source files could not be included. Review the reasons below. For size or count limits, split the project into focused snapshots; a ZIP does not increase these limits.</Alert>}
      {!preview.files.length && <Alert severity="warning">No supported source files found. Include application code such as .js, .ts, .py, .java, or .go files, rather than a build, dependencies, or an archive inside another ZIP.</Alert>}
      <Box component="details"><summary>Review files before uploading</summary>
        <Box sx={{ maxHeight: 360, overflow: 'auto' }}>{preview.files.map(file => <SourceReview key={file.path} file={file} busy={busy}
          exclude={() => setPreview(old => ({ ...old, files: old.files.filter(f => f.path !== file.path), omittedSourceFiles: (old.omittedSourceFiles || 0) + 1, bytes: old.bytes - new TextEncoder().encode(file.content).length }))}
        />)}</Box>
      </Box>
      {!!preview.skipped.length && <Box component="details"><summary>Excluded files ({preview.skipped.length}; showing first 100)</summary><Box component="ul" sx={{ maxHeight: 180, overflow: 'auto', fontSize: 12 }}>{[...preview.skipped].sort((a, b) => Number(a.reason.startsWith('Excluded:')) - Number(b.reason.startsWith('Excluded:'))).slice(0, 100).map((f, i) => <li key={i}>{f.path}: {f.reason}</li>)}</Box></Box>}
      <Button variant="contained" disabled={busy || !name.trim() || !preview.files.length} onClick={upload}>Create snapshot and prepare AI context</Button>
    </>}
  </Stack></CardContent></Card>;
}
