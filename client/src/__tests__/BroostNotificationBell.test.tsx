import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroostNotificationBell } from '../components/BroostNotificationBell';
import { api } from '../lib/api';
import type { Broost } from '../hooks/useBroosts';

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
  vi.restoreAllMocks();
});

function sampleBroost(overrides: Partial<Broost> = {}): Broost {
  return {
    id: 1,
    direction: 'received',
    presetKey: 'great_job',
    message: 'כל הכבוד!',
    createdAt: '2026-01-01T10:00:00.000Z',
    readAt: null,
    isRead: false,
    emailStatus: 'sent',
    emailHasError: false,
    emailWillRetry: false,
    sender: { id: 2, label: 'שותף', hasAvatar: false, avatarVersion: 0 },
    recipient: { id: 1, label: 'אני', hasAvatar: false, avatarVersion: 0 },
    ...overrides,
  };
}

describe('BroostNotificationBell', () => {
  it('portals a viewport-clamped popover and keeps clicks inside it from dismissing it', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    const view = render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(284, 20, 32, 32));
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog');
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog).toHaveStyle({ left: '12px', width: '296px' });
    expect(button).toHaveAttribute('aria-controls', dialog.id);
    fireEvent.mouseDown(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('shows a badge with the unread count once loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 3, recent: [sampleBroost()] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: 'BROOST — 3 התראות שלא נקראו' });
    expect(button).toHaveTextContent('3');
  });

  it('shows no badge (and an accessible "no notifications" label) when there is nothing unread', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: 'BROOST — אין התראות חדשות' });
    expect(button).not.toHaveTextContent('0');
  });

  it('opens the popover on click and shows recent unread BROOSTs', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost({ message: 'הודעה ספציפית' })] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);

    expect(screen.getByRole('dialog', { name: 'התראות BROOST' })).toBeInTheDocument();
    expect(screen.getByText('הודעה ספציפית')).toBeInTheDocument();
  });

  it('shows an empty-state message in the popover when there are no unread BROOSTs', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(screen.getByText('אין BROOSTs חדשים')).toBeInTheDocument();
  });

  it('marking one BROOST read from the popover calls the API and refreshes', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ count: 1, recent: [sampleBroost()] });
    vi.mocked(api.post).mockResolvedValue({ ...sampleBroost(), isRead: true });
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);

    fireEvent.click(screen.getByRole('button', { name: 'סימון כנקרא' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts/1/read'));
  });

  it('mark-all-read is offered only when there is something unread, and calls the API', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ count: 2, recent: [sampleBroost()] });
    vi.mocked(api.post).mockResolvedValue({ updated: 2 });
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);

    const markAllBtn = screen.getByRole('button', { name: 'סימון הכל כנקרא' });
    fireEvent.click(markAllBtn);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts/read-all'));
  });

  it('shows a compact inline error rather than silently hiding the feature when loading fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('does not render a navigable link out of the popover (decoupled from DashboardPage tab state)', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('לצפייה בהיסטוריה המלאה יש לעבור לטאב BROOST')).toBeInTheDocument();
  });

  it('the preview shows the sender label for each unread BROOST', async () => {
    vi.mocked(api.get).mockResolvedValue({
      count: 1,
      recent: [sampleBroost({ message: 'הודעה', sender: { id: 2, label: 'דני', hasAvatar: false, avatarVersion: 0 } })],
    });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(screen.getByText('דני')).toBeInTheDocument();
  });

  it('closes the popover on Escape', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the popover on an outside click', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables the read-action buttons while a mark-read request is in flight, and surfaces a visible error if it fails (no bare rejected promise)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ count: 1, recent: [sampleBroost()] });
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    let resolvePost: (() => void) | null = null;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = () => resolve({ ...sampleBroost(), isRead: true });
      })
    );
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);

    const markReadBtn = screen.getByRole('button', { name: 'סימון כנקרא' });
    fireEvent.click(markReadBtn);
    expect(markReadBtn).toBeDisabled();
    resolvePost!();
    await waitFor(() => expect(markReadBtn).not.toBeDisabled());
  });

  it('surfaces a visible error (not a silent/bare rejection) when marking read fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('שגיאת שרת', 500));
    render(<BroostNotificationBell />);
    const button = await screen.findByRole('button', { name: /BROOST/ });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'סימון כנקרא' }));
    expect(await screen.findByText('שגיאת שרת')).toBeInTheDocument();
  });

  it('opens and focuses a custom reply inline without navigating or marking the notification read', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    const originalUrl = window.location.href;
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    const input = screen.getByRole('textbox', { name: 'תגובה לשותף' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxlength', '500');
    expect(screen.getByRole('button', { name: 'שליחת תגובה' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'סימון כנקרא' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalUrl);
  });

  it('sends the trimmed reply bound to the original notification and stays in the popover', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost({ id: 17 })] });
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ id: 18, direction: 'sent' }));
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  תודה על העידוד!  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת תגובה' }));
    expect(await screen.findByText('התגובה נשלחה לשותף')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/broosts', { replyToBroostId: 17, customMessage: 'תודה על העידוד!' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סימון כנקרא' })).toBeEnabled();
  });

  it('prevents duplicate submissions and read actions while a reply is in flight', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    let finish!: (value: Broost) => void;
    vi.mocked(api.post).mockReturnValue(new Promise<Broost>((resolve) => { finish = resolve; }));
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'תודה' } });
    const form = input.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'סימון כנקרא' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'סימון הכל כנקרא' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled();
    finish(sampleBroost({ id: 2, direction: 'sent' }));
    await screen.findByText('התגובה נשלחה לשותף');
  });

  it('keeps the draft and shows the server error when a reply fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('השותפות השתנתה', 409));
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'הטיוטה שלי' } });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת תגובה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('השותפות השתנתה');
    expect(screen.getByRole('textbox')).toHaveValue('הטיוטה שלי');
    expect(screen.getByRole('button', { name: 'שליחת תגובה' })).toBeEnabled();
    expect(screen.queryByText('התגובה נשלחה לשותף')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves an active draft across a popover close and an unread-feed refresh', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'לא לאבד את זה' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    fireEvent(window, new Event('focus'));
    await screen.findByRole('button', { name: 'BROOST — אין התראות חדשות' });
    fireEvent.click(screen.getByRole('button', { name: /BROOST/ }));
    expect(screen.getByRole('textbox')).toHaveValue('לא לאבד את זה');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects blank or oversized replies without posting and allows cancellation', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [sampleBroost()] });
    render(<BroostNotificationBell />);
    fireEvent.click(await screen.findByRole('button', { name: /BROOST/ }));
    fireEvent.click(screen.getByRole('button', { name: 'השבה בהודעה' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'שליחת תגובה' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'א'.repeat(501) } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('1–500');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BROOST/ })).toHaveFocus();
  });
});
