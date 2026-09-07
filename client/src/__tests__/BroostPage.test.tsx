import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroostPage } from '../pages/BroostPage';
import { api } from '../lib/api';
import type { PartnerInfo } from '../lib/types';
import type { Broost } from '../hooks/useBroosts';
import { publishSuccess } from '../lib/celebrations';

const authState = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../lib/celebrations', () => ({ publishSuccess: vi.fn() }));

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
  authState.user = { id: 1 };
});

const PARTNER: PartnerInfo = { id: 2, email: 'partner@a.com', displayName: '', partnershipId: 1 };

const PRESETS = [
  { key: 'great_job', message: 'יש ביצועים ויש את זה. ריספקט 🫡' },
  { key: 'crushing_it', message: 'הטבלה ירוקה. מישהו פה הגיע לעבוד 🟩' },
  { key: 'keep_going', message: 'הקאמבק של השבוע מתחיל עכשיו 🎬' },
  { key: 'proud_of_you', message: '85%? יש קבלות 🧾' },
  { key: 'daily_boost', message: 'קפה, פלייליסט, וי. זה הסדר ☕' },
  { key: 'you_got_this', message: 'עוד וי אחד. בשביל העלילה 🎯' },
  { key: 'king_queen', message: 'הביצוע הזה שווה שידור חוזר 🔁' },
  { key: 'sending_love', message: 'גם ביום בלי וי — יש פה גב 🤝' },
];

function sampleBroost(overrides: Partial<Broost> = {}): Broost {
  return {
    id: 1,
    direction: 'received',
    presetKey: 'great_job',
    message: 'כל הכבוד! את/ה עושה עבודה מעולה השבוע 💪',
    createdAt: '2026-01-01T10:00:00.000Z',
    readAt: null,
    isRead: false,
    emailStatus: 'sent',
    emailHasError: false,
    emailWillRetry: false,
    sender: { id: overrides.direction === 'sent' ? 1 : 2, label: 'שולח', hasAvatar: false, avatarVersion: 0 },
    recipient: { id: overrides.direction === 'sent' ? 2 : 1, label: 'אני', hasAvatar: false, avatarVersion: 0 },
    ...overrides,
  };
}

function setupApiMocks(historyItems: Broost[] = []) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/broosts/presets') return { presets: PRESETS };
    if (path.startsWith('/broosts/history')) return { items: historyItems, total: historyItems.length, limit: 20, offset: 0 };
    throw new Error(`unexpected GET ${path}`);
  });
}

describe('BroostPage: composer', () => {
  it('renders preset cards and lets the user pick one, then submits it', async () => {
    setupApiMocks();
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ direction: 'sent' }));
    render(<BroostPage partner={PARTNER} />);

    await screen.findByText(PRESETS[0].message);
    const submitBtn = screen.getByRole('button', { name: 'שליחת BROOST' });
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByText(PRESETS[0].message));
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts', { presetKey: 'great_job' }));
    expect(await screen.findByText('נשלח 🫡')).toBeInTheDocument();
    expect(publishSuccess).toHaveBeenCalledTimes(1);
    expect(publishSuccess).toHaveBeenCalledWith({
      accountId: 1, kind: 'broost', occurrenceId: 'broost:1',
      owner: true, success: true, completed: true,
    });
  });

  it('switches to a custom message and requires non-empty text before submitting', async () => {
    setupApiMocks();
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ direction: 'sent', presetKey: null, message: 'טקסט אישי' }));
    render(<BroostPage partner={PARTNER} />);
    await screen.findByText(PRESETS[0].message);

    fireEvent.click(screen.getByLabelText('במילים שלי'));
    const submitBtn = screen.getByRole('button', { name: 'שליחת BROOST' });
    expect(submitBtn).toBeDisabled();

    const textarea = screen.getByLabelText('הודעה אישית');
    fireEvent.change(textarea, { target: { value: 'טקסט אישי' } });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts', { customMessage: 'טקסט אישי' }));
  });

  it('selecting a preset clears any custom-message mode, and vice versa', async () => {
    setupApiMocks();
    render(<BroostPage partner={PARTNER} />);
    await screen.findByText(PRESETS[0].message);

    fireEvent.click(screen.getByLabelText('במילים שלי'));
    expect(screen.getByLabelText('הודעה אישית')).toBeInTheDocument();

    fireEvent.click(screen.getByText(PRESETS[0].message));
    expect(screen.queryByLabelText('הודעה אישית')).not.toBeInTheDocument();
  });

  it('surfaces an error and does not show the success animation when sending fails', async () => {
    setupApiMocks();
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('שגיאת שרת', 500));
    render(<BroostPage partner={PARTNER} />);
    await screen.findByText(PRESETS[0].message);

    fireEvent.click(screen.getByText(PRESETS[0].message));
    fireEvent.click(screen.getByRole('button', { name: 'שליחת BROOST' }));

    expect(await screen.findByText('שגיאת שרת')).toBeInTheDocument();
    expect(screen.queryByText('נשלח 🫡')).not.toBeInTheDocument();
    expect(publishSuccess).not.toHaveBeenCalled();
  });

  it('disables the send button while a send is in flight, and a rapid double-click sends only once', async () => {
    setupApiMocks();
    let resolvePost: (() => void) | null = null;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = () => resolve(sampleBroost({ direction: 'sent' }));
      })
    );
    render(<BroostPage partner={PARTNER} />);
    await screen.findByText(PRESETS[0].message);
    fireEvent.click(screen.getByText(PRESETS[0].message));

    const submitBtn = screen.getByRole('button', { name: 'שליחת BROOST' });
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    // A second click while the first request is still in flight must not fire a second POST —
    // both the disabled button and the in-handler guard protect against this.
    fireEvent.click(submitBtn);
    expect(api.post).toHaveBeenCalledTimes(1);

    resolvePost!();
    await waitFor(() => expect(submitBtn).toBeDisabled());
  });

  it.each(['account change', 'partner change', 'navigation away'])('does not celebrate a send that finishes after %s', async (change) => {
    setupApiMocks();
    let finish!: (value: Broost) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise<Broost>((resolve) => { finish = resolve; }));
    const view = render(<BroostPage partner={PARTNER} />);
    await screen.findByText(PRESETS[0].message);
    fireEvent.click(screen.getByText(PRESETS[0].message));
    fireEvent.click(screen.getByRole('button', { name: 'שליחת BROOST' }));
    if (change === 'account change') {
      authState.user = { id: 3 };
      view.rerender(<BroostPage partner={PARTNER} />);
    } else if (change === 'partner change') {
      view.rerender(<BroostPage partner={{ ...PARTNER, id: 4, email: 'other@example.test' }} />);
    } else {
      view.unmount();
    }
    await act(async () => { finish(sampleBroost({ direction: 'sent' })); });
    expect(publishSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('נשלח 🫡')).not.toBeInTheDocument();
  });

  // Each card used to carry a hand-written title as well, which was simply the tail of the
  // message repeated ("ריספקט" above "יש ביצועים ויש את זה. ריספקט 🫡"). The card must now show
  // the sentence that will actually be sent, exactly once.
  it('shows each server message once, with no repeated title, and preselects nothing', async () => {
    setupApiMocks();
    render(<BroostPage partner={PARTNER} />);
    const group = await screen.findByRole('group', { name: 'הודעות מוכנות' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(8);
    buttons.forEach((button, index) => {
      const message = PRESETS[index].message;
      expect(button).toHaveAccessibleName(message);
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(within(button).getByText(message)).toBeVisible();
      expect(button.textContent).toBe(message);
    });
    expect(screen.getByText('בוחרים משפט, והוא נשלח כלשונו — גם במייל.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'שליחת BROOST' })).toBeDisabled();
    expect(screen.getByText('בחרו משפט כדי לשלוח')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('explains a disabled send button rather than only greying it out', async () => {
    setupApiMocks();
    render(<BroostPage partner={PARTNER} />);
    const group = await screen.findByRole('group', { name: 'הודעות מוכנות' });
    expect(screen.getByRole('button', { name: 'שליחת BROOST' })).toHaveAccessibleDescription('בחרו משפט כדי לשלוח');
    fireEvent.click(within(group).getAllByRole('button')[0]);
    expect(screen.getByRole('button', { name: 'שליחת BROOST' })).toBeEnabled();
    expect(screen.queryByText('בחרו משפט כדי לשלוח')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('במילים שלי'));
    expect(screen.getByRole('button', { name: 'שליחת BROOST' })).toHaveAccessibleDescription('כתבו משהו קודם');
  });

  it('keeps keyboard-focusable native buttons and announces only the selected preset as pressed', async () => {
    setupApiMocks();
    render(<BroostPage partner={PARTNER} />);
    const group = await screen.findByRole('group', { name: 'הודעות מוכנות' });
    const buttons = within(group).getAllByRole('button');
    act(() => buttons[3].focus());
    expect(buttons[3]).toHaveFocus();
    expect((buttons[3] as HTMLButtonElement).tabIndex).toBe(0);
    fireEvent.click(buttons[3], { detail: 0 });
    expect(buttons[3]).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(buttons[3]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('במילים שלי'));
    expect(within(group).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('separates a long recipient address from the RTL heading using bdi', async () => {
    setupApiMocks();
    const address = 'a-very-long.synthetic-recipient+tag@example.test';
    render(<BroostPage partner={{ ...PARTNER, email: address }} />);
    await screen.findByRole('group', { name: 'הודעות מוכנות' });
    const heading = screen.getByRole('heading', { name: 'איזה BROOST שולחים?' });
    expect(heading).not.toHaveTextContent(address);
    const recipient = screen.getByText(address);
    expect(recipient.tagName).toBe('BDI');
    expect(recipient).toHaveAttribute('dir', 'auto');
    expect(recipient.parentElement).toHaveTextContent(`אל${address}`);
    expect(screen.queryByText(/שותף\/ה/)).not.toBeInTheDocument();
  });

  it('preserves the 500-character custom-message limit and exposes its count accessibly', async () => {
    setupApiMocks();
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ direction: 'sent', presetKey: null }));
    render(<BroostPage partner={PARTNER} />);
    await screen.findByRole('group', { name: 'הודעות מוכנות' });
    fireEvent.click(screen.getByLabelText('במילים שלי'));
    const textarea = screen.getByLabelText('הודעה אישית');
    expect(textarea).toHaveAttribute('maxlength', '500');
    expect(textarea).toHaveAccessibleDescription('0 מתוך 500 תווים');
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'שליחת BROOST' })).toBeDisabled();
    const message = 'א'.repeat(500);
    fireEvent.change(textarea, { target: { value: message } });
    expect(textarea).toHaveAccessibleDescription('500 מתוך 500 תווים');
    fireEvent.click(screen.getByRole('button', { name: 'שליחת BROOST' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts', { customMessage: message }));
  });

  it('renders unknown future catalog keys with their real server preview, never substituted copy', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/broosts/presets') return { presets: [{ key: 'future_preset', message: 'משפט מהשרת <בלי HTML>' }] };
      return { items: [], total: 0, limit: 20, offset: 0 };
    });
    render(<BroostPage partner={PARTNER} />);
    const button = await screen.findByRole('button', { name: 'משפט מהשרת <בלי HTML>' });
    expect(button).toHaveTextContent('משפט מהשרת <בלי HTML>');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps custom composing available when loading the preset catalog fails', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/broosts/presets') throw new Error('offline');
      return { items: [], total: 0, limit: 20, offset: 0 };
    });
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('המשפטים לא נטענו');
    fireEvent.click(screen.getByLabelText('במילים שלי'));
    expect(screen.getByLabelText('הודעה אישית')).toBeVisible();
  });
});

describe('BroostPage: history', () => {
  it('shows an old saved preset message verbatim instead of rewriting it from the new catalog', async () => {
    const oldMessage = 'כל הכבוד! את/ה עושה עבודה מעולה השבוע 💪';
    setupApiMocks([sampleBroost({ message: oldMessage })]);
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByText(oldMessage)).toBeVisible();
    expect(screen.getByText(PRESETS[0].message)).toBeVisible();
  });

  it('shows an empty state when there is no history yet', async () => {
    setupApiMocks([]);
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByText('עדיין לא נשלח BROOST. הראשון תמיד הכי שווה.')).toBeInTheDocument();
    expect(publishSuccess).not.toHaveBeenCalled();
  });

  it('renders sent and received items with correct direction labeling', async () => {
    setupApiMocks([
      sampleBroost({ id: 1, direction: 'received', sender: { id: 2, label: 'שותף', hasAvatar: false, avatarVersion: 0 } }),
      sampleBroost({ id: 2, direction: 'sent', recipient: { id: 2, label: 'שותף', hasAvatar: false, avatarVersion: 0 } }),
    ]);
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByText(/התקבל משותף/)).toBeInTheDocument();
    expect(screen.getByText(/נשלח לשותף/)).toBeInTheDocument();
  });

  it('shows a "mark read" control only for unread received items, and calls the API on click', async () => {
    setupApiMocks([sampleBroost({ id: 5, direction: 'received', isRead: false })]);
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ id: 5, direction: 'received', isRead: true, readAt: '2026-01-01T10:05:00.000Z' }));
    render(<BroostPage partner={PARTNER} />);

    const markReadBtn = await screen.findByRole('button', { name: 'סימון כנקרא' });
    fireEvent.click(markReadBtn);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/broosts/5/read'));
    expect(publishSuccess).not.toHaveBeenCalled();
  });

  it('does not show a "mark read" control for a sent item or an already-read item', async () => {
    setupApiMocks([
      sampleBroost({ id: 1, direction: 'sent' }),
      sampleBroost({ id: 2, direction: 'received', isRead: true, readAt: '2026-01-01T10:05:00.000Z' }),
    ]);
    render(<BroostPage partner={PARTNER} />);
    await screen.findByText(/נשלח ל/);
    expect(screen.queryByRole('button', { name: 'סימון כנקרא' })).not.toBeInTheDocument();
  });

  it('shows a load-more control when more history is available, requesting the next page', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/broosts/presets') return { presets: PRESETS };
      if (path === '/broosts/history?limit=20&offset=0') {
        return { items: [sampleBroost()], total: 25, limit: 20, offset: 0 };
      }
      if (path === '/broosts/history?limit=20&offset=20') {
        return { items: [sampleBroost({ id: 99 })], total: 25, limit: 20, offset: 20 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    render(<BroostPage partner={PARTNER} />);
    const loadMoreBtn = await screen.findByRole('button', { name: 'טעינת עוד' });
    fireEvent.click(loadMoreBtn);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/broosts/history?limit=20&offset=20'));
  });

  it('surfaces a history load error inline', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/broosts/presets') return { presets: PRESETS };
      if (path.startsWith('/broosts/history')) throw new Error('network down');
      throw new Error(`unexpected GET ${path}`);
    });
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('disables mark-all-read while in flight and surfaces a visible error on failure (no bare rejected promise)', async () => {
    setupApiMocks([sampleBroost({ id: 1, direction: 'received', isRead: false })]);
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('שגיאת שרת', 500));
    render(<BroostPage partner={PARTNER} />);

    const markAllBtn = await screen.findByRole('button', { name: 'סימון הכל כנקרא' });
    fireEvent.click(markAllBtn);
    expect(await screen.findByText('שגיאת שרת')).toBeInTheDocument();
  });

  it('distinguishes a retryable email failure from a terminal one, without exposing the raw error', async () => {
    setupApiMocks([
      sampleBroost({ id: 1, direction: 'sent', emailStatus: 'failed', emailHasError: true, emailWillRetry: true }),
      sampleBroost({ id: 2, direction: 'sent', emailStatus: 'failed', emailHasError: true, emailWillRetry: false }),
    ]);
    render(<BroostPage partner={PARTNER} />);
    expect(await screen.findByText(/ינסה שוב אוטומטית/)).toBeInTheDocument();
    expect(screen.getByText(/שליחת האימייל נכשלה סופית/)).toBeInTheDocument();
  });
});
