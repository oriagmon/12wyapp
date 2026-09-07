import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  ApiError: Error,
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('../components/TopBar', () => ({ TopBar: () => null }));
vi.mock('../pages/DashboardPage', async () => {
  const { useState } = await import('react');
  const { useAuth } = await import('../context/AuthContext');
  return {
    DashboardPage: function PrivateDashboard() {
      const { user, refreshUser } = useAuth();
      const [draft, setDraft] = useState('');
      return (
        <div>
          <span>account:{user?.id}</span>
          <input aria-label="טיוטה פרטית" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button onClick={() => void refreshUser()}>רענון חשבון</button>
        </div>
      );
    },
  };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('App account boundary', () => {
  it('remounts the private dashboard when the authenticated account changes', async () => {
    let accountId = 1;
    vi.mocked(api.get).mockImplementation(async (path) =>
      path === '/settings' ? { theme: 'dark' } : {
        id: accountId, email: `test${accountId}@example.test`, displayName: '',
        bio: '', hasAvatar: false, avatarVersion: 0, successStreak: 0,
      },
    );
    render(<App />);
    const draft = await screen.findByRole('textbox', { name: 'טיוטה פרטית' });
    fireEvent.change(draft, { target: { value: 'draft belonging to account 1' } });
    accountId = 2;
    fireEvent.click(screen.getByRole('button', { name: 'רענון חשבון' }));
    await screen.findByText('account:2');
    expect(screen.getByRole('textbox', { name: 'טיוטה פרטית' })).toHaveValue('');
  });

  it('keeps private UI state when refreshing the same authenticated account', async () => {
    vi.mocked(api.get).mockImplementation(async (path) =>
      path === '/settings' ? { theme: 'dark' } : {
        id: 1, email: 'test1@example.test', displayName: '',
        bio: '', hasAvatar: false, avatarVersion: 0, successStreak: 0,
      },
    );
    render(<App />);
    const draft = await screen.findByRole('textbox', { name: 'טיוטה פרטית' });
    fireEvent.change(draft, { target: { value: 'current draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'רענון חשבון' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/auth/me')).toHaveLength(2));
    expect(screen.getByRole('textbox', { name: 'טיוטה פרטית' })).toHaveValue('current draft');
  });
});
