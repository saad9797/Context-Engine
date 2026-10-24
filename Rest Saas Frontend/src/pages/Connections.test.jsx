import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Connections from './Connections';

const { request, supported, encrypt } = vi.hoisted(() => ({ request: vi.fn(), supported: vi.fn(), encrypt: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ request }) }));
vi.mock('../components/ToastProvider', () => ({ useToast: () => vi.fn() }));
vi.mock('../api/transitCrypto', () => ({ isTransitEncryptionSupported: supported, encryptForTransit: encrypt }));

beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue([]);
});

async function fillConnection() {
  render(<MemoryRouter><Connections /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Postgres' }));
  fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Read-only source' } });
  fireEvent.change(screen.getByLabelText(/^Connection string/), { target: { value: 'postgresql://user:secret@host/db' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

test('blocks saving when browser encryption is unavailable', async () => {
  supported.mockReturnValue(false);
  await fillConnection();
  await screen.findByText(/Your browser cannot encrypt this connection/);
  expect(encrypt).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('does not fall back to plaintext when encryption fails', async () => {
  supported.mockReturnValue(true);
  encrypt.mockRejectedValue(new Error('Encryption unavailable'));
  await fillConnection();
  await screen.findByText('Encryption unavailable');
  expect(request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
