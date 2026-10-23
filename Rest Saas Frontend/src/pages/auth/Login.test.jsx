import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Login from './Login';
const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ login, startOAuth: vi.fn() }) }));
vi.mock('./AuthLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
beforeEach(() => { sessionStorage.clear(); login.mockReset(); login.mockResolvedValue(undefined); });

it('returns to the requested project after login instead of discarding the deep link', async () => {
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/contexts/project/claude-context' } } }]}><Routes>
    <Route path='/login' element={<Login />} /><Route path='/contexts/project/claude-context' element={<div>Requested task workspace</div>} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox', { name: /username/i }), { target: { value: 'review' } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'test-only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(screen.getByText('Requested task workspace')).toBeInTheDocument());
});
