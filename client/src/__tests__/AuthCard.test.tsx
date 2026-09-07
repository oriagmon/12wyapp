import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import { AuthCard } from '../components/AuthCard';
import { api } from '../lib/api';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAuthCard(
  props?: { initialMode?: 'login' | 'register' | 'forgot' | 'reset'; resetToken?: string | null; onResetHandled?: () => void },
  policy: unknown = { registrationOpen: true },
) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path !== '/auth/policy') throw new Error('not logged in');
    if (policy instanceof Error) throw policy;
    return policy;
  });
  return render(
    <AuthProvider>
      <AuthCard {...props} />
    </AuthProvider>
  );
}

describe('AuthCard', () => {
  it('renders the app title and enables signup only after a positive server policy', async () => {
    renderAuthCard();
    expect(screen.getByRole('heading', { name: '12wyapp' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'הרשמה' })).toBeInTheDocument();
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument();
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument();
  });
});

describe('AuthCard: operator registration policy', () => {
  it('hides signup when closed, explains how to request access, and still permits login/forgot-password', async () => {
    renderAuthCard({ initialMode: 'register' }, { registrationOpen: false });
    expect(await screen.findByText('ההרשמה הציבורית סגורה. לקבלת גישה יש לפנות למפעיל/ת המערכת.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הרשמה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'התחברות' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }));
    expect(screen.getByRole('heading', { name: 'איפוס סיסמה' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('never displays signup while policy is still loading', () => {
    renderAuthCard(undefined, new Promise(() => {}));
    expect(screen.getByText('בודק את מדיניות ההרשמה...')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
  });

  it.each([null, {}, { registrationOpen: 'true' }, new Error('policy unavailable')])(
    'fails closed on malformed/unavailable policy, with an actionable retry: %s', async (policy) => {
      renderAuthCard(undefined, policy);
      expect(await screen.findByText(/לא ניתן לבדוק אם ההרשמה פתוחה/)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
      vi.mocked(api.get).mockResolvedValue({ registrationOpen: true });
      fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
      expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
      expect(await screen.findByRole('tab', { name: 'הרשמה' })).toBeInTheDocument();
    }
  );

  it('preserves the token-driven reset flow even with registration closed', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    renderAuthCard({ initialMode: 'reset', resetToken: 'captured-token' }, { registrationOpen: false });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'captured-token', newPassword: 'newpassword123',
    }));
    expect(await screen.findByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'הרשמה' })).not.toBeInTheDocument();
  });
});

describe('AuthCard: forgot-password request mode', () => {
  it('switches to the forgot-password form via the "שכחת סיסמה?" link, hiding the login/register tabs', () => {
    renderAuthCard();
    fireEvent.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }));

    expect(screen.queryByRole('tab', { name: 'התחברות' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'איפוס סיסמה' })).toBeInTheDocument();
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument();
  });

  it('always shows the generic success message returned by the server after submitting, regardless of whether the account exists', async () => {
    vi.mocked(api.post).mockResolvedValue({ message: 'אם קיים חשבון המשויך לכתובת האימייל הזו, נשלח אליו קישור לאיפוס הסיסמה' });
    renderAuthCard();
    fireEvent.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }));

    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'anyone@a.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת קישור לאיפוס' }));

    expect(
      await screen.findByText('אם קיים חשבון המשויך לכתובת האימייל הזו, נשלח אליו קישור לאיפוס הסיסמה')
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'anyone@a.com' });
    // The form itself disappears once the generic success message is shown (nothing left to submit).
    expect(screen.queryByRole('button', { name: 'שליחת קישור לאיפוס' })).not.toBeInTheDocument();
  });

  it('surfaces a genuine network/server error without ever implying the account does/doesn\'t exist', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('שגיאת שרת (500)', 500));
    renderAuthCard();
    fireEvent.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }));

    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'anyone@a.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת קישור לאיפוס' }));

    expect(await screen.findByText('שגיאת שרת (500)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שליחת קישור לאיפוס' })).toBeInTheDocument(); // can retry
  });

  it('returns to the login tabs via "חזרה להתחברות"', () => {
    renderAuthCard();
    fireEvent.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }));
    fireEvent.click(screen.getByRole('button', { name: 'חזרה להתחברות' }));
    expect(screen.getByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
  });
});

describe('AuthCard: reset-password mode (props-driven — App.tsx owns URL/token capture)', () => {
  it('renders the reset form when given initialMode="reset" + resetToken, with no login/register tabs', () => {
    renderAuthCard({ initialMode: 'reset', resetToken: 'abc123XYZ' });

    expect(screen.getByRole('heading', { name: 'קביעת סיסמה חדשה' })).toBeInTheDocument();
    expect(screen.getByLabelText('סיסמה חדשה')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'התחברות' })).not.toBeInTheDocument();
  });

  it('defaults to the login tabs when rendered with no props at all', () => {
    renderAuthCard();
    expect(screen.queryByRole('heading', { name: 'קביעת סיסמה חדשה' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation client-side, without ever calling the API', () => {
    renderAuthCard({ initialMode: 'reset', resetToken: 'abc123' });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'different1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    expect(screen.getByText('אימות הסיסמה החדשה אינו תואם')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits the token given as a prop (never reading window.location itself) and transitions to login with a success notice', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    renderAuthCard({ initialMode: 'reset', resetToken: 'the-captured-token' });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'the-captured-token',
        newPassword: 'newpassword123',
      })
    );

    expect(await screen.findByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.getByText('הסיסמה אופסה בהצלחה — ניתן להתחבר כעת עם הסיסמה החדשה.')).toBeInTheDocument();
    // A successful reset revokes every session server-side, including the caller's own if
    // they happened to be logged in — the client must clear its own stale state too.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/logout'));
  });

  it('calls onResetHandled exactly once a successful reset concludes', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const onResetHandled = vi.fn();
    renderAuthCard({ initialMode: 'reset', resetToken: 'the-captured-token', onResetHandled });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    await waitFor(() => expect(onResetHandled).toHaveBeenCalledTimes(1));
  });

  it('does not call onResetHandled when the confirmation mismatch prevents submission', () => {
    const onResetHandled = vi.fn();
    renderAuthCard({ initialMode: 'reset', resetToken: 'abc123', onResetHandled });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'different1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    expect(onResetHandled).not.toHaveBeenCalled();
  });

  it('surfaces a generic invalid/expired token error from the server without crashing, and lets the user retry', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('קישור האיפוס אינו תקין או שפג תוקפו. יש לבקש קישור חדש', 400));
    renderAuthCard({ initialMode: 'reset', resetToken: 'expired-token' });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));

    expect(await screen.findByText('קישור האיפוס אינו תקין או שפג תוקפו. יש לבקש קישור חדש')).toBeInTheDocument();
    // Still on the reset form, can try again.
    expect(screen.getByRole('button', { name: 'איפוס הסיסמה' })).toBeInTheDocument();
  });

  it('never persists the token to localStorage or sessionStorage at any point', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    renderAuthCard({ initialMode: 'reset', resetToken: 'never-persisted-token' });

    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'איפוס הסיסמה' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key)).not.toContain('never-persisted-token');
    }
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)!;
      expect(window.sessionStorage.getItem(key)).not.toContain('never-persisted-token');
    }
  });

  it('can return to the login tabs manually via "חזרה להתחברות" without submitting, notifying the parent via onResetHandled', () => {
    const onResetHandled = vi.fn();
    renderAuthCard({ initialMode: 'reset', resetToken: 'abc123', onResetHandled });
    fireEvent.click(screen.getByRole('button', { name: 'חזרה להתחברות' }));
    expect(screen.getByRole('tab', { name: 'התחברות' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(onResetHandled).toHaveBeenCalledTimes(1);
  });
});
