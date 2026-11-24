import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { AuthContext, type AuthState } from '../src/auth/AuthContext';
import { LoginPage } from '../src/pages/LoginPage';

function renderWith(login: AuthState['login']) {
  const state: AuthState = {
    principal: null,
    loading: false,
    login,
    register: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects" element={<p>projects page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@railyard.local' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'railyard-demo-pass' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('signs in and navigates to projects', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    renderWith(login);
    fill();
    await waitFor(() => expect(screen.getByText('projects page')).toBeInTheDocument());
    expect(login).toHaveBeenCalledWith('owner@railyard.local', 'railyard-demo-pass');
  });

  it('shows the server error message', async () => {
    const login = vi.fn().mockRejectedValue(
      new ApiRequestError(401, {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      }),
    );
    renderWith(login);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });
});
