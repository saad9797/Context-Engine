import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClaudeHandoff, { useClaudeHandoff } from './ClaudeHandoff';

const handoff = { request: { task: 'Add interviews' }, code: [{ content: 'complete source' }] };
const response = { id: 'launch-1', url: 'https://claude.ai/code?prompt_url=https%3A%2F%2Fapi.example.com%2Fprompt', expires_at: '2026-10-30T12:00:00Z' };
let request, tab, open;
function Harness({ disabled = false, contextId = 'snapshot' }) {
  const controller = useClaudeHandoff(contextId, request);
  return <ClaudeHandoff handoff={handoff} disabled={disabled} controller={controller} />;
}
beforeEach(() => {
  request = vi.fn().mockResolvedValue(response);
  tab = { closed: false, opener: {}, document: { title: '', body: { textContent: '', style: {} } }, location: { replace: vi.fn() }, close: vi.fn() };
  open = vi.spyOn(window, 'open').mockReturnValue(tab);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens synchronously, sends the complete handoff, and navigates with no opener', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  expect(tab.opener).toBeNull();
  expect(request).toHaveBeenCalledWith('/api/ingestion/snapshot/claude-launch/', { method: 'POST', body: { handoff } });
  await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(response.url));
  expect(screen.getByText(/Claude Code opened with your handoff link/)).toBeInTheDocument();
});

it('does not create a link if a pop-up was blocked', () => {
  open.mockReturnValue(null);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Allow pop-ups');
  expect(request).not.toHaveBeenCalled();
});

it('cleans up its waiting tab and offers retry after an API failure', async () => {
  request.mockRejectedValueOnce(new Error('Server is unavailable. Try again.'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  await screen.findByText('Server is unavailable. Try again.');
  expect(tab.close).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Open in Claude Code' })).toBeEnabled();
});

it('never navigates to an unexpected destination returned by the API', async () => {
  request.mockResolvedValue({ ...response, url: 'https://other.example/code' });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  await screen.findByText(/handoff response was invalid/);
  expect(tab.location.replace).not.toHaveBeenCalled();
});

it('blocks stale handoffs', () => {
  render(<Harness disabled />);
  expect(screen.getByRole('button', { name: 'Open in Claude Code' })).toBeDisabled();
  expect(open).not.toHaveBeenCalled();
});

it('revokes the current link without claiming already-loaded context was deleted', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke handoff link' }));
  await screen.findByText(/Any context already loaded into Claude remains there/);
  expect(request).toHaveBeenLastCalledWith('/api/ingestion/snapshot/claude-launch/launch-1/', { method: 'DELETE' });
});

it('closes pending tabs and never launches an old snapshot after navigation', async () => {
  let resolve;
  request.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in Claude Code' }));
  view.rerender(<Harness contextId="different" />);
  await act(async () => resolve(response));
  expect(tab.close).toHaveBeenCalled();
  expect(tab.location.replace).not.toHaveBeenCalled();
});
