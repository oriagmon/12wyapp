import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from '../lib/api';
import type { AuthUser } from '../context/AuthContext';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      putBinary: vi.fn(),
    },
  };
});

const AUTH_USER: AuthUser = {
  id: 1,
  email: 'owner@a.com',
  displayName: '',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  successStreak: 0,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('App: reset-token handling is hoisted above the logged-in gate', () => {
  it('a logged-in user opening a fragment-based reset link sees the reset UI (not the dashboard), with a cleaned-up URL', async () => {
    window.history.replaceState(null, '', '/#resetToken=abc123XYZ');
    vi.mocked(api.get).mockResolvedValue(AUTH_USER); // simulates an already-logged-in session

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'קביעת סיסמה חדשה' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'ניווט ראשי' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('abc123XYZ');
  });

  it('after a successful reset while logged in, stale auth state is cleared and the login screen is shown', async () => {
    window.history.replaceState(null, '', '/#resetToken=abc123XYZ');
    vi.mocked(api.get).mockResolvedValue(AUTH_USER);
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === '/auth/reset-password') return { ok: true };
      if (path === '/auth/logout') return undefined;
      throw new Error(`unexpected POST ${path}`);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'קביעת סיסמה חדשה' });

    const passwordInput = screen.getByLabelText('סיסמה חדשה');
    const confirmInput = screen.getByLabelText('אימות סיסמה חדשה');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(passwordInput, { target: { value: 'newpassword123' } });
    fireEvent.change(confirmInput, { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/logout'));
    expect(await screen.findByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
  });

  it('with no reset token present, a logged-out user simply sees the normal login screen', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('not logged in'));
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
  });
});
