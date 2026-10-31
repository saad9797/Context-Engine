import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClaudeHandoff, { useClaudeHandoff } from './ClaudeHandoff';
import { copyToClipboard } from '../lib/format';
vi.mock('../lib/format', () => ({ copyToClipboard: vi.fn() }));

const handoff = { request: { task: 'Add interviews' }, code: [{ content: 'complete source' }] };
const response = { id: 'launch-1', url: 'https://claude.ai/code?prompt_url=https%3A%2F%2Fapi.example.com%2Fprompt', expires_at: '2026-10-30T12:00:00Z' };
let request, tab, open;
function Harness({ disabled = false, contextId = 'snapshot' }) {
  const controller = useClaudeHandoff(contextId, request);
  return <ClaudeHandoff handoff={handoff} disabled={disabled} controller={controller} />;
}
beforeEach(() => {
  copyToClipboard.mockResolvedValue(true);
  request = vi.fn().mockResolvedValue(response);
  tab = { closed: false, opener: {}, document: { title: '', body: { textContent: '', style: {} } }, location: { replace: vi.fn() }, close: vi.fn() };
  open = vi.spyOn(window, 'open').mockReturnValue(tab);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens ordinary Claude chat by default, without a Code subscription or backend launch', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude', exact: true }));
  await waitFor(() => expect(tab.location.replace).toHaveBeenCalled());
  const url = new URL(tab.location.replace.mock.calls[0][0]);
  expect(url.pathname).toBe('/new');
  expect(url.searchParams.get('q')).toContain(JSON.stringify(handoff));
  expect(request).not.toHaveBeenCalled();
});

it('copies large contexts intact and never sends an oversized URL or opens the paid Code route', async () => {
  const large = { request: { task: 'Large task' }, code: [{ content: 'x'.repeat(60000) }] };
  function Large() { const controller = useClaudeHandoff('snapshot', request); return <ClaudeHandoff handoff={large} controller={controller} />; }
  render(<Large />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude', exact: true }));
  await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://claude.ai/new'));
  expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('x'.repeat(60000)));
  expect(screen.getByText(/Your complete handoff was copied/)).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

it('does not claim a large prompt was copied when clipboard access is denied', async () => {
  copyToClipboard.mockResolvedValue(false);
  const large = { request: { task: 'Large task' }, code: [{ content: 'x'.repeat(60000) }] };
  function Large() { const controller = useClaudeHandoff('snapshot', request); return <ClaudeHandoff handoff={large} controller={controller} />; }
  render(<Large />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude', exact: true }));
  await screen.findByText(/Clipboard access was denied/);
  expect(tab.location.replace).not.toHaveBeenCalled();
  expect(tab.close).toHaveBeenCalled();
});

it('opens synchronously, sends the complete handoff, and navigates with no opener', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  expect(tab.opener).toBeNull();
  expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify(handoff)));
  expect(request).toHaveBeenCalledWith('/api/ingestion/snapshot/claude-launch/', { method: 'POST', body: { handoff } });
  await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(response.url));
  expect(screen.getByText(/Claude Code opened with your handoff link/)).toBeInTheDocument();
  expect(screen.getByText(/AI handoff copied. If the composer is empty/)).toBeInTheDocument();
});

it('offers a selectable complete prompt if clipboard copying fails for Code', async () => {
  copyToClipboard.mockResolvedValue(false);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  await screen.findByText(/Clipboard access was blocked/);
  fireEvent.click(screen.getByRole('button', { name: 'View full prompt' }));
  const preview = screen.getByLabelText('Complete AI handoff prompt');
  expect(preview.value).toContain(JSON.stringify(handoff));
  expect(preview).toHaveAttribute('readonly');
});

it('does not create a link if a pop-up was blocked', () => {
  open.mockReturnValue(null);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Allow pop-ups');
  expect(request).not.toHaveBeenCalled();
});

it('cleans up its waiting tab and offers retry after an API failure', async () => {
  request.mockRejectedValueOnce(new Error('Server is unavailable. Try again.'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  await screen.findByText('Server is unavailable. Try again.');
  expect(tab.close).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Open in Claude Code (paid)' })).toBeEnabled();
});

it('never navigates to an unexpected destination returned by the API', async () => {
  request.mockResolvedValue({ ...response, url: 'https://other.example/code' });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  await screen.findByText(/handoff response was invalid/);
  expect(tab.location.replace).not.toHaveBeenCalled();
});

it('blocks stale handoffs', () => {
  render(<Harness disabled />);
  expect(screen.getByRole('button', { name: 'Open in Claude Code (paid)' })).toBeDisabled();
  expect(open).not.toHaveBeenCalled();
});

it('revokes the current link without claiming already-loaded context was deleted', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke handoff link' }));
  await screen.findByText(/Any context already loaded into Claude remains there/);
  expect(request).toHaveBeenLastCalledWith('/api/ingestion/snapshot/claude-launch/launch-1/', { method: 'DELETE' });
});

it('closes pending tabs and never launches an old snapshot after navigation', async () => {
  let resolve;
  request.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code (paid)' }));
  view.rerender(<Harness contextId="different" />);
  await act(async () => resolve(response));
  expect(tab.close).toHaveBeenCalled();
  expect(tab.location.replace).not.toHaveBeenCalled();
});
