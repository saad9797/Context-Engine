import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../context/AuthContext';

const outcomes = [['unreviewed', 'Not evaluated yet'], ['worked', 'Helped me finish the change'], ['needed_context', 'AI needed more project context'], ['did_not_work', 'Did not help me finish']];

export default function SavedHandoffs({ contextId, values, disabled, onRestore }) {
  const { request } = useAuth();
  const [history, setHistory] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('unreviewed');
  const [feedback, setFeedback] = useState('');
  const [message, setMessage] = useState('');
  const version = useRef(0);
  useEffect(() => { version.current += 1; setHistory(null); setSaved(null); setError(''); setMessage(''); setBusy(false); return () => { version.current += 1; }; }, [contextId]);
  async function action(fn) {
    const current = version.current;
    setBusy(true); setError(''); setMessage('');
    try { await fn(() => current === version.current); }
    catch (e) { if (current === version.current) setError(e.message); }
    finally { if (current === version.current) setBusy(false); }
  }
  const root = `/api/ingestion/${contextId}/handoffs/`;
  function restore(item) { setSaved(item); setOutcome(item.outcome); setFeedback(item.feedback || ''); onRestore(item); }
  return <Box sx={{ my: 2 }}>
    <Typography variant="subtitle2">Keep a handoff for later</Typography>
    <Typography variant="caption" color="text.secondary">Saved privately with this snapshot. Up to 30 handoffs; delete them whenever you like.</Typography>
    <Stack direction="row" spacing={1} sx={{ my: 1 }}>
      <Button size="small" disabled={disabled || busy} onClick={() => action(async valid => {
        const item = await request(root, { method: 'POST', body: values });
        if (!valid()) return;
        setSaved(item); setOutcome(item.outcome); setFeedback(item.feedback || ''); setMessage('Handoff saved.'); setHistory(null);
      })}>Save handoff</Button>
      <Button size="small" disabled={busy} onClick={() => action(async valid => {
        const list = await request(root); if (valid()) setHistory(list);
      })}>Browse saved handoffs</Button>
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    {history && <Stack spacing={1} sx={{ my: 1 }}>
      {!history.length && <Typography variant="body2">No saved handoffs for this snapshot yet.</Typography>}
      {history.map(item => <Stack direction="row" key={item.id} spacing={1} sx={{ alignItems: 'center' }}>
        <Button size="small" disabled={busy} sx={{ textAlign: 'left', justifyContent: 'flex-start', flex: 1 }} onClick={() => action(async valid => { const full = await request(`${root}${item.id}/`); if (valid()) restore(full); })}>{item.title}</Button>
        <Button size="small" color="error" disabled={busy} onClick={() => {
          if (!window.confirm('Delete this saved handoff? The project snapshot will stay.')) return;
          action(async valid => { await request(`${root}${item.id}/`, { method: 'DELETE' }); if (valid()) { setHistory(old => old.filter(row => row.id !== item.id)); if (saved?.id === item.id) setSaved(null); } });
        }}>Delete</Button>
      </Stack>)}
    </Stack>}
    {saved && <Stack spacing={1} sx={{ mt: 2 }}>
      <Typography variant="caption">Saved {new Date(saved.created_at).toLocaleString()} • {saved.digest.slice(0, 10)}. Loading a saved handoff restores its original export.</Typography>
      <TextField select size="small" label="Did this handoff help?" value={outcome} onChange={e => setOutcome(e.target.value)} disabled={busy}>{outcomes.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</TextField>
      <TextField size="small" label="Missing context or result (optional)" multiline maxRows={4} value={feedback} onChange={e => setFeedback(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} disabled={busy} />
      <Typography variant="caption" color="text.secondary">Your assessment is private and self-reported. It is not an automated compilation or accuracy score.</Typography>
      <Button size="small" disabled={busy} onClick={() => action(async valid => { await request(`${root}${saved.id}/`, { method: 'PATCH', body: { outcome, feedback } }); if (valid()) setMessage('Your result was saved.'); })}>Save result</Button>
    </Stack>}
  </Box>;
}
