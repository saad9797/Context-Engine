import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SystemArchitecture, { systemSources } from './SystemArchitecture';

afterEach(cleanup);

it('shows the server and every inspected source with plain language connections', () => {
  render(<SystemArchitecture data={{ codebase: {}, database: { dialect: 'mysql' }, mongo_database: {}, object_storage: { provider: 'azure-blob' } }} />);
  for (const label of ['Application server', 'MySQL database', 'MongoDB database', 'Azure Blob storage', 'Reads and saves data', 'Uploads and retrieves files']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.getByText(/suggested connections/)).toBeInTheDocument();
  expect(screen.queryByText('AWS S3 storage')).not.toBeInTheDocument();
});

it('does not invent a server or cloud provider for a database-only snapshot', () => {
  render(<SystemArchitecture data={{ database: {} }} />);
  expect(screen.getByText('PostgreSQL database')).toBeInTheDocument();
  expect(screen.queryByText('Application server')).not.toBeInTheDocument();
  expect(screen.getByText(/Add a codebase/)).toBeInTheDocument();
});

it('distinguishes AWS from compatible storage and omits absent sources', () => {
  expect(systemSources({})).toEqual([]);
  expect(systemSources({ object_storage: { provider: 'aws-s3' } })[0].name).toBe('AWS S3 storage');
  expect(systemSources({ object_storage: { provider: 's3-compatible' } })[0].name).toBe('S3-compatible storage');
});

it('explains a selected component using keyboard navigation and can pause motion', () => {
  const view = render(<SystemArchitecture data={{ codebase: {}, object_storage: { provider: 'aws-s3' } }} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Explain AWS S3 storage' }), { key: 'Enter' });
  expect(screen.getByText(/Keeps larger files outside the database/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pause motion' }));
  expect(screen.getByRole('button', { name: 'Resume motion' })).toHaveAttribute('aria-pressed', 'true');
  expect(view.container.querySelector('svg')).toHaveClass('motion-paused');
  expect(view.container.querySelector('style').textContent).toContain('prefers-reduced-motion');
});
