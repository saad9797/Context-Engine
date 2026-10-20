import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { prepareFolder } from '../lib/folderImport';

export default function FolderImport() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const generation = useRef(0);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(event) {
    const selected = event.target.files;
    if (!selected?.length) return;
    const current = ++generation.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const next = await prepareFolder(selected);
      if (current === generation.current) { setPreview(next); setName(next.projectName); }
    } catch { if (current === generation.current) setError('Could not read this folder. Select a smaller folder containing UTF-8 source files.'); }
    finally { if (current === generation.current) setBusy(false); event.target.value = ''; }
  }
  async function upload() {
    setBusy(true); setError('');
    try {
      const saved = await request('/api/ingestion/import/', { method: 'POST', body: { project_name: name.trim(), files: preview.files } });
      navigate(`/contexts/${saved.id}/claude-context`);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return <Card variant="outlined" sx={{ mb: 3 }}><CardContent><Stack spacing={2}>
    <Typography variant="h6">Start with a project folder</Typography>
    <Typography variant="body2" color="text.secondary">No GitHub setup needed. Select your project, review the source files, then create a snapshot. Nothing is uploaded until you continue.</Typography>
    <Stack direction="row" spacing={1}>
      <Button component="label" variant="outlined" disabled={busy}>Choose folder<input aria-label="Choose project folder" type="file" webkitdirectory="" multiple hidden onChange={choose} /></Button>
      <Button component="label" disabled={busy}>Choose files<input aria-label="Choose source files" type="file" multiple hidden onChange={choose} /></Button>
      {busy && <CircularProgress size={22} />}
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {preview && <>
      <TextField label="Imported project name" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 255 } }} disabled={busy} />
      <Alert severity="info">{preview.files.length} files • {(preview.bytes / 1000).toFixed(0)} KB. Limit: 220 files, 128 KB per file, 2 MB total. Source is stored in your account; known credential patterns are redacted on the server. Review proprietary code before sharing it with an AI.</Alert>
      {!!preview.skipped.length && <Alert severity="warning">{preview.skipped.length} files excluded. Missing project files can limit context selection. Review the list or select a more focused folder.</Alert>}
      <Box component="details"><summary>Review files before uploading</summary>
        <Box sx={{ maxHeight: 360, overflow: 'auto' }}>{preview.files.map(file => <Box key={file.path} component="details" sx={{ my: 1 }}><summary>{file.path}</summary>
          <Button size="small" disabled={busy} onClick={() => setPreview(old => ({ ...old, files: old.files.filter(f => f.path !== file.path), bytes: old.bytes - new TextEncoder().encode(file.content).length }))}>Exclude file</Button>
          <Box component="pre" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{file.content}</Box>
        </Box>)}</Box>
      </Box>
      {!!preview.skipped.length && <Box component="details"><summary>Excluded files ({preview.skipped.length}; showing first 100)</summary><Box component="ul" sx={{ maxHeight: 180, overflow: 'auto', fontSize: 12 }}>{preview.skipped.slice(0, 100).map((f, i) => <li key={i}>{f.path}: {f.reason}</li>)}</Box></Box>}
      <Button variant="contained" disabled={busy || !name.trim() || !preview.files.length} onClick={upload}>Create snapshot and prepare AI context</Button>
    </>}
  </Stack></CardContent></Card>;
}
