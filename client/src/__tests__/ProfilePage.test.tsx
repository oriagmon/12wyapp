import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../pages/ProfilePage';
import { api } from '../lib/api';
import type { ProfileData } from '../hooks/useProfile';

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
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      putBinary: vi.fn(),
    },
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ refreshUser: vi.fn().mockResolvedValue(undefined) }),
}));

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    id: 1,
    email: 'owner@a.com',
    displayName: '',
    bio: '',
    hasAvatar: false,
    avatarVersion: 0,
    successStreak: 3,
    ...overrides,
  };
}

describe('ProfilePage', () => {
  it('shows a loading state, then the loaded profile with the streak explanation', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile({ displayName: 'אורי', successStreak: 5 }));
    render(<ProfilePage />);

    expect(screen.getByText('טוען פרופיל...')).toBeInTheDocument();
    await screen.findByDisplayValue('אורי');

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/רצף ההצלחות האישי שלך/)).toBeInTheDocument();
  });

  it('shows the fallback avatar (no image) and no "remove image" button when there is no avatar yet', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile({ hasAvatar: false }));
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    expect(screen.queryByRole('img', { name: 'owner@a.com' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הסרת תמונה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'בחירת תמונה' })).toBeInTheDocument();
  });

  it('shows a "remove image" button once an avatar exists, and removing it calls the API', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile({ hasAvatar: true, avatarVersion: 2 }));
    vi.mocked(api.delete).mockResolvedValue(makeProfile({ hasAvatar: false, avatarVersion: 3 }));
    render(<ProfilePage />);
    await screen.findByRole('img', { name: 'owner@a.com' });

    fireEvent.click(screen.getByRole('button', { name: 'הסרת תמונה' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/profile/avatar'));
  });

  it('saves display name and bio via PATCH, trimming is left to the server but the button is disabled while empty', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    vi.mocked(api.patch).mockResolvedValue(makeProfile({ displayName: 'אורי', bio: 'ביו' }));
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    const saveButton = screen.getByRole('button', { name: 'שמירת פרטים' });
    expect(saveButton).toBeDisabled(); // empty display name

    fireEvent.change(screen.getByLabelText('שם תצוגה'), { target: { value: 'אורי' } });
    fireEvent.change(screen.getByLabelText('ביוגרפיה'), { target: { value: 'ביו' } });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/profile', { displayName: 'אורי', bio: 'ביו' }));
    await screen.findByText('נשמר ✓');
  });

  it('rejects an oversized file client-side without ever calling the upload API', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    const input = screen.getByLabelText('בחירת תמונת פרופיל') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(await screen.findByText(/התמונה גדולה מדי/)).toBeInTheDocument();
    expect(api.putBinary).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type client-side (e.g. GIF) without calling the upload API', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    const gifFile = new File(['GIF89a'], 'a.gif', { type: 'image/gif' });
    const input = screen.getByLabelText('בחירת תמונת פרופיל') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [gifFile] } });

    expect(await screen.findByText(/PNG, JPEG או WebP בלבד/)).toBeInTheDocument();
    expect(api.putBinary).not.toHaveBeenCalled();
  });

  it('uploads a valid image file via putBinary with its content type', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    vi.mocked(api.putBinary).mockResolvedValue(makeProfile({ hasAvatar: true, avatarVersion: 1 }));
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    const pngFile = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const input = screen.getByLabelText('בחירת תמונת פרופיל') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile] } });

    await waitFor(() => expect(api.putBinary).toHaveBeenCalledWith('/profile/avatar', pngFile, 'image/png'));
  });

  it('blocks a password change client-side when confirmation does not match, without calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'oldpassword123' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'mismatch123' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));

    expect(await screen.findByText('אימות הסיסמה החדשה אינו תואם')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('submits a matching password change via PATCH /profile/password and clears the fields', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    vi.mocked(api.patch).mockResolvedValue({ ok: true });
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'oldpassword123' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/profile/password', {
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      })
    );
    await waitFor(() => expect((screen.getByLabelText('סיסמה נוכחית') as HTMLInputElement).value).toBe(''));
  });

  it('surfaces a server error (e.g. wrong current password) without clearing the typed fields', async () => {
    vi.mocked(api.get).mockResolvedValue(makeProfile());
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.patch).mockRejectedValue(new ApiError('הסיסמה הנוכחית שגויה', 401));
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'wrongpassword' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));

    expect(await screen.findByText('הסיסמה הנוכחית שגויה')).toBeInTheDocument();
    expect((screen.getByLabelText('סיסמה נוכחית') as HTMLInputElement).value).toBe('wrongpassword');
  });

  it('a failed password change never publishes its error to the global (TopBar) save-status bus', async () => {
    const { subscribeSaveStatus } = await import('../lib/saveStatusBus');
    const { ApiError } = await import('../lib/api');
    const seen: { status: string; error: string | null }[] = [];
    const unsubscribe = subscribeSaveStatus((status, error) => seen.push({ status, error }));

    vi.mocked(api.get).mockResolvedValue(makeProfile());
    vi.mocked(api.patch).mockRejectedValue(new ApiError('הסיסמה הנוכחית שגויה', 401));
    render(<ProfilePage />);
    await screen.findByText('הפרופיל שלי');

    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'wrongpassword' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText('אימות סיסמה חדשה'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));
    await screen.findByText('הסיסמה הנוכחית שגויה');

    unsubscribe();
    // The initial subscribe call always replays the bus's current (idle) state once; nothing
    // beyond that — in particular no 'error' entry — must ever have been published.
    expect(seen.some((entry) => entry.status === 'error')).toBe(false);
    expect(seen.every((entry) => entry.error === null)).toBe(true);
  });
});
