import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import FolderImport from './FolderImport';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ request }) }));
beforeEach(() => { vi.clearAllMocks(); });
it('reviews source without uploading and creates the snapshot only after the user continues', async () => {
  request.mockResolvedValue({ id: 'local' });
  render(<MemoryRouter><Routes><Route path="/" element={<FolderImport />} /><Route path="/contexts/local/claude-context" element={<div>Context workspace</div>} /></Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Choose project folder'), { target: { files: [
    { name: 'invoice.ts', webkitRelativePath: 'billing/src/invoice.ts', size: 24, text: () => Promise.resolve('export const invoice = 1;') },
  ] } });
  await screen.findByLabelText('Imported project name');
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByText('src/invoice.ts')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot and prepare AI context' }));
  await screen.findByText('Context workspace');
  expect(request).toHaveBeenCalledWith('/api/ingestion/import/', { method: 'POST', body: { project_name: 'billing', omitted_source_files: 0, files: [{ path: 'src/invoice.ts', content: 'export const invoice = 1;' }] } });
});
it('keeps reviewed files available when an upload fails', async () => {
  request.mockRejectedValue(new Error('Import service unavailable'));
  render(<MemoryRouter><FolderImport /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Choose source files'), { target: { files: [{ name: 'a.py', size: 4, text: () => Promise.resolve('pass') }] } });
  const upload = await screen.findByRole('button', { name: 'Create snapshot and prepare AI context' });
  fireEvent.click(upload);
  await screen.findByText('Import service unavailable');
  await waitFor(() => expect(upload).toBeEnabled());
  expect(screen.getByText('a.py')).toBeInTheDocument();
});
