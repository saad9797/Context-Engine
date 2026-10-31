import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { copyToClipboard } from '../lib/format';

export const claudePrompt = handoff => 'Implement the request using this self-contained context. Review context_gaps and ask for missing contracts first.\n\n' + JSON.stringify(handoff);

export function useClaudeHandoff(contextId, request) {
  const [state, setState] = useState({ kind: 'idle' });
  const pending = useRef(null);
  const revision = useRef(0);
  useEffect(() => {
    setState({ kind: 'idle' });
    return () => {
      revision.current += 1;
      pending.current?.close();
      pending.current = null;
    };
  }, [contextId]);

  function reserve() {
    // Open during the click, before preparation/network work loses the
    // browser's user activation. Never expose Contexa's opener to Claude.
    if (pending.current && !pending.current.closed) return null;
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setState({ kind: 'error', text: 'Your browser blocked the Claude tab. Allow pop-ups for Contexa, then choose Open in Claude Code again. Your context is still here.' });
      return null;
    }
    tab.opener = null;
    tab.document.title = 'Preparing your Claude handoff — Contexa';
    tab.document.body.textContent = 'Preparing your context for Claude. Keep this tab open; it will continue automatically when the handoff is ready. You can return to Contexa while you wait.';
    tab.document.body.style.cssText = 'max-width:640px;margin:15vh auto;padding:24px;font:18px/1.7 system-ui;color:#273329;background:#f8faf5';
    pending.current = tab;
    setState({ kind: 'preparing' });
    return tab;
  }

  function cancel(tab, text) {
    if (!tab || pending.current !== tab) return;
    tab?.close();
    pending.current = null;
    setState(text ? { kind: 'error', text } : { kind: 'idle' });
  }

  async function launch(handoff, reservedTab) {
    if (!handoff?.request?.task) return;
    const prompt = claudePrompt(handoff);
    const destination = new URL('https://claude.ai/new');
    destination.searchParams.set('q', prompt);
    const prefilled = destination.href.length <= 6000;
    // Start clipboard access in the original click, before focusing a new tab.
    const copying = copyToClipboard(prompt);
    const tab = reservedTab || reserve();
    if (!tab) return;
    const current = revision.current;
    const copied = await copying;
    if (current !== revision.current) return;
    if (!prefilled && !copied) {
      cancel(tab, 'Clipboard access was denied. Copy the complete AI handoff using Copy for AI chat, then open claude.ai and paste it. No context was truncated.');
      return;
    }
    if (tab.closed) { cancel(tab, 'The Claude tab was closed. Choose Open in Claude again.'); return; }
    try {
      tab.location.replace(prefilled ? destination.href : 'https://claude.ai/new');
      pending.current = null;
      setState({ kind: 'chat', prefilled, copied });
    } catch (error) { cancel(tab, error.message || 'Could not open Claude. Your context is still here.'); }
  }

  async function launchCode(handoff, tab = reserve()) {
    if (!tab) return;
    if (tab.closed) {
      cancel(tab, 'The Claude tab was closed. Your context is ready; choose Open in Claude Code to try again.');
      return;
    }
    const current = revision.current;
    setState({ kind: 'opening' });
    let created;
    try {
      const output = await request(`/api/ingestion/${contextId}/claude-launch/`, { method: 'POST', body: { handoff } });
      created = output.id;
      if (current !== revision.current) {
        if (created) await request(`/api/ingestion/${contextId}/claude-launch/${created}/`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      const destination = new URL(output.url);
      if (destination.origin !== 'https://claude.ai' || destination.pathname !== '/code' || !output.id || !output.expires_at) throw new Error('The Claude handoff response was invalid. Try again.');
      if (tab.closed) throw new Error('The Claude tab was closed. Open Claude Code again to retry.');
      tab.location.replace(destination.href);
      pending.current = null;
      setState({ kind: 'opened', ...output });
    } catch (error) {
      if (created) request(`/api/ingestion/${contextId}/claude-launch/${created}/`, { method: 'DELETE' }).catch(() => {});
      if (current === revision.current) cancel(tab, error.message || 'Could not open Claude. Your context is still available to copy or download.');
    }
  }

  async function revoke() {
    try {
      await request(`/api/ingestion/${contextId}/claude-launch/${state.id}/`, { method: 'DELETE' });
      setState({ kind: 'revoked' });
    } catch (error) { setState(old => ({ ...old, revokeError: error.message })); }
  }
  return { state, reserve, launch, launchCode, cancel, revoke, busy: state.kind === 'preparing' || state.kind === 'opening' };
}

export default function ClaudeHandoff({ handoff, disabled, controller }) {
  const { state, launch, launchCode, revoke, busy } = controller;
  return <Box sx={{ mb: 2 }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <OpenInNew />} disabled={disabled || busy} onClick={() => launch(handoff)}>
        {busy ? 'Preparing Claude handoff…' : 'Open in Claude'}
      </Button>
      <Button variant="outlined" disabled={disabled || busy} onClick={() => launchCode(handoff)}>Open in Claude Code (paid)</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      Claude chat opens without requiring Claude Code access. Short prompts are prefilled; larger handoffs are copied in full — paste them into Claude with Ctrl+V (⌘V on Mac). Sign in there if asked, review the prompt, then send.
    </Typography>
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
      Claude Code is a separate paid feature and may show an upgrade screen if your account is not eligible. Use Open in Claude instead. Code handoffs use a private link valid for 15 minutes; Contexa cannot check your Claude subscription or sign-in status.
    </Typography>
    {state.kind === 'error' && <Alert severity="error" role="alert">{state.text}</Alert>}
    {busy && <Alert severity="info" role="status">{state.kind === 'preparing' ? 'Preparing your context. The new tab will open Claude automatically when ready.' : 'Creating your private Claude handoff…'}</Alert>}
    {state.kind === 'chat' && <Alert severity="success" role="status">{state.prefilled ? 'Claude chat opened with the prompt prefilled. If sign-in clears the prompt, return here and open Claude again.' : 'Your complete handoff was copied and Claude chat opened. Paste with Ctrl+V (⌘V on Mac), then review and send. Browser security prevents Contexa from pasting into another website automatically.'}</Alert>}
    {state.kind === 'opened' && <Alert severity="info" role="status">
      Claude Code opened with your handoff link. Sign in there if asked. If the prompt does not appear after sign-in, return here and choose Open in Claude Code again. The link expires at {new Date(state.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
      <Button size="small" onClick={revoke}>Revoke handoff link</Button>
      {state.revokeError && <Typography variant="body2" color="error">{state.revokeError}</Typography>}
    </Alert>}
    {state.kind === 'revoked' && <Alert severity="success">The handoff link was revoked. Any context already loaded into Claude remains there.</Alert>}
  </Box>;
}
