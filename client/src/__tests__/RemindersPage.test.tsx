import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemindersPage } from '../pages/RemindersPage';
import { api } from '../lib/api';
import type { Reminder } from '../hooks/useReminders';
import type { PartnerInfo } from '../lib/types';

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

describe('RemindersPage search-result navigation', () => {
  it('delegates controlled detail dismissal to navigation and follows subsequent Back/Forward props', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder({ id: 2, title: 'תוצאת החיפוש', status: 'sent' })] });
    const onDismissFocusedReminder = vi.fn();
    const props = { ownUserId: 1, ownEmail: 'owner@a.com', partner: null, onDismissFocusedReminder };
    const { rerender } = render(<RemindersPage {...props} focusedReminderId={2} />);
    expect(await screen.findByRole('article', { name: 'תוצאת החיפוש' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לרשימת התזכורות' }));
    expect(onDismissFocusedReminder).toHaveBeenCalledTimes(1);
    rerender(<RemindersPage {...props} />);
    expect(screen.queryByText(/תוצאת החיפוש מסומנת/)).not.toBeInTheDocument();
    rerender(<RemindersPage {...props} focusedReminderId={2} />);
    expect(screen.getByRole('article', { name: 'תוצאת החיפוש' })).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each(['pending', 'sent', 'cancelled'] as const)('reveals and focuses a %s reminder without editing or mutations', async (status) => {
    vi.mocked(api.get).mockResolvedValue({
      reminders: [makeReminder({ id: 1, title: 'תזכורת אחרת' }), makeReminder({ id: 2, title: 'תוצאת החיפוש', status })],
    });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} focusedReminderId={2} />);
    const article = await screen.findByRole('article', { name: 'תוצאת החיפוש' });
    expect(article).toHaveFocus();
    expect(screen.getByRole('article', { name: 'תזכורת אחרת' })).toBeInTheDocument();
    expect(screen.getByLabelText('כותרת')).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'עריכת תזכורת' })).not.toBeInTheDocument();
    if (status !== 'pending') expect(within(article).queryByRole('button')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('moves focus when a different result is requested and keeps Back dismissed for an unchanged selection', async () => {
    vi.mocked(api.get).mockResolvedValue({
      reminders: [makeReminder({ id: 1, title: 'ראשונה' }), makeReminder({ id: 2, title: 'שנייה', status: 'sent' })],
    });
    const props = { ownUserId: 1, ownEmail: 'owner@a.com', partner: null };
    const { rerender } = render(<RemindersPage {...props} focusedReminderId={1} />);
    expect(await screen.findByRole('article', { name: 'ראשונה' })).toHaveFocus();
    rerender(<RemindersPage {...props} focusedReminderId={2} />);
    expect(screen.getByRole('article', { name: 'שנייה' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לרשימת התזכורות' }));
    expect(screen.getByRole('region', { name: 'רשימת התזכורות' })).toHaveFocus();
    rerender(<RemindersPage {...props} focusedReminderId={2} />);
    expect(screen.queryByText(/תוצאת החיפוש מסומנת/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'רשימת התזכורות' })).toHaveFocus();
    rerender(<RemindersPage {...props} />);
    rerender(<RemindersPage {...props} focusedReminderId={2} />);
    expect(screen.getByRole('article', { name: 'שנייה' })).toHaveFocus();
  });

  it('offers retry/back for an unavailable or unauthorized ID without fetching an unscoped detail endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} focusedReminderId={99} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('התזכורת המבוקשת אינה זמינה');
    expect(api.get).toHaveBeenCalledWith('/reminders');
    expect(api.get).not.toHaveBeenCalledWith('/reminders/99');
    vi.mocked(api.get).mockResolvedValueOnce({ reminders: [makeReminder({ id: 99, title: 'נמצאה מחדש', status: 'cancelled' })] });
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('article', { name: 'נמצאה מחדש' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('makes initial list failures retryable and focuses the result after recovery', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} focusedReminderId={1} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('שגיאה בטעינת התזכורות');
    vi.mocked(api.get).mockResolvedValueOnce({ reminders: [makeReminder()] });
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('article', { name: 'לזכור לרוץ' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never displays a late previous-account list after switching accounts', async () => {
    let resolveOld!: (value: { reminders: Reminder[] }) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ reminders: [makeReminder({ id: 2, title: 'החשבון הנוכחי' })] });
    const { rerender } = render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} focusedReminderId={1} />);
    rerender(<RemindersPage ownUserId={2} ownEmail="other@a.com" partner={null} focusedReminderId={2} />);
    expect(await screen.findByRole('article', { name: 'החשבון הנוכחי' })).toHaveFocus();
    await act(async () => resolveOld({ reminders: [makeReminder({ title: 'חשבון קודם' })] }));
    expect(screen.queryByText('חשבון קודם')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'החשבון הנוכחי' })).toHaveFocus();
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Cancelling is destructive and now asks first; tests that cancel opt into "yes". */
function confirmCancellation(answer = true) {
  const confirmSpy = vi.fn(() => answer);
  vi.stubGlobal('confirm', confirmSpy);
  return confirmSpy;
}

const PARTNER: PartnerInfo = { id: 2, email: 'partner@a.com', displayName: '', partnershipId: 1 };

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    title: 'לזכור לרוץ',
    body: 'לפני העבודה',
    scheduledFor: '2099-06-15T07:00:00.000Z',
    scheduledForIsraelWallTime: '2099-06-15T10:00',
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    sentAt: null,
    recipient: { id: 1, email: 'owner@a.com', isSelf: true },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RemindersPage', () => {
  it('shows a loading state, then an empty-state message when there are no reminders', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);

    expect(screen.getByText('טוען תזכורות...')).toBeInTheDocument();
    expect(await screen.findByText(/עדיין לא נקבעו תזכורות/)).toBeInTheDocument();
  });

  it('offers only self without a partner, and self/partner/both with an accepted partner', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    const { rerender } = render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);
    expect(screen.getByRole('option', { name: /אליי/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^אל / })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'לשנינו' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    rerender(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    expect(screen.getByRole('option', { name: 'אל partner@a.com' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'לשנינו' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByLabelText('נמען/ת')).toHaveValue('1');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects an empty title client-side without calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(await screen.findByText('כותרת התזכורת לא יכולה להיות ריקה')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  // An empty datetime-local shows the browser's own untranslatable "dd/mm/yyyy, --:--", the
  // only English left on this Hebrew screen, so the field now opens on a sensible default.
  it('opens with a future date/time already filled in, never a blank field', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    const when = screen.getByLabelText('מתי לשלוח (שעון ישראל)') as HTMLInputElement;
    expect(when.value).not.toBe('');
    expect(when.value >= when.min).toBe(true);
  });

  it('still rejects a cleared date/time client-side without calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'כותרת' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(await screen.findByText('יש לבחור תאריך ושעה לתזכורת')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects a past date/time client-side without calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'כותרת' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2020-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(await screen.findByText('מועד התזכורת חייב להיות בעתיד')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent Israel wall-clock time (DST spring-forward gap) client-side', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'כותרת' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2026-03-27T02:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(await screen.findByText(/מועד לא תקין/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates a reminder with the trimmed form values, sending the raw Israel wall-time string (not pre-converted)', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    vi.mocked(api.post).mockResolvedValue(makeReminder());
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: '  לזכור לרוץ  ' } });
    fireEvent.change(screen.getByLabelText('תוכן (אופציונלי)'), { target: { value: '  לפני העבודה  ' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2099-06-15T10:00' } });
    fireEvent.change(screen.getByLabelText('נמען/ת'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reminders', {
        title: 'לזכור לרוץ',
        body: 'לפני העבודה',
        scheduledFor: '2099-06-15T10:00',
        recipientUserId: 2,
      })
    );
  });

  it('renders a pending reminder as a status card with edit/cancel controls', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder()] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);

    expect(await screen.findByText('לזכור לרוץ')).toBeInTheDocument();
    expect(screen.getByText('ממתינה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עריכה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ביטול התזכורת' })).toBeInTheDocument();
  });

  it('editing a reminder prefills the form and submits via PATCH', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder()] });
    vi.mocked(api.patch).mockResolvedValue(makeReminder({ title: 'כותרת חדשה' }));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('לזכור לרוץ');

    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    expect((screen.getByLabelText('כותרת') as HTMLInputElement).value).toBe('לזכור לרוץ');
    expect(screen.getByRole('button', { name: 'שמירת שינויים' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'כותרת חדשה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/reminders/1', {
        title: 'כותרת חדשה',
        body: 'לפני העבודה',
        scheduledFor: '2099-06-15T10:00',
        recipientUserId: 1,
      })
    );
  });

  it('editing a failed reminder whose original schedule has already passed prefills a new future time (never the stale past one) and explains why', async () => {
    const pastFailed = makeReminder({
      id: 5,
      status: 'failed',
      scheduledFor: '2020-01-01T08:00:00.000Z',
      scheduledForIsraelWallTime: '2020-01-01T10:00',
    });
    vi.mocked(api.get).mockResolvedValue({ reminders: [pastFailed] });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('נכשלה');

    fireEvent.click(screen.getByRole('button', { name: 'עריכה / ניסיון חוזר' }));

    const dateInput = screen.getByLabelText('מתי לשלוח (שעון ישראל)') as HTMLInputElement;
    expect(dateInput.value).not.toBe('2020-01-01T10:00'); // never silently prefills the expired time
    expect(dateInput.value.startsWith('20')).toBe(true);
    expect(dateInput.value.startsWith('2020-')).toBe(false); // a genuinely new (non-2020) year was suggested
    expect(screen.getByText(/המועד המקורי .* כבר עבר/)).toBeInTheDocument();
  });

  it('editing a still-pending reminder whose schedule is still in the future keeps the original time and shows no "expired" notice', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder()] }); // scheduledFor is far in the future
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('לזכור לרוץ');

    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));

    expect((screen.getByLabelText('מתי לשלוח (שעון ישראל)') as HTMLInputElement).value).toBe('2099-06-15T10:00');
    expect(screen.queryByText(/המועד המקורי/)).not.toBeInTheDocument();
  });

  it('cancelling a reminder calls the cancel endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder()] });
    vi.mocked(api.post).mockResolvedValue(makeReminder({ status: 'cancelled' }));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('לזכור לרוץ');

    const confirmSpy = confirmCancellation();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול התזכורת' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reminders/1/cancel'));
  });

  it('shows a failed reminder\'s last error and offers an "edit / retry" action, but no edit/cancel controls for a sent or cancelled one', async () => {
    vi.mocked(api.get).mockResolvedValue({
      reminders: [
        makeReminder({ id: 2, status: 'failed', lastError: 'ACS outage' }),
        makeReminder({ id: 3, status: 'sent', sentAt: '2026-01-02T00:00:00.000Z' }),
        makeReminder({ id: 4, status: 'cancelled' }),
      ],
    });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('נכשלה');

    expect(screen.getByText(/שגיאת שליחה אחרונה: ACS outage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עריכה / ניסיון חוזר' })).toBeInTheDocument();

    expect(screen.getByText('נשלחה ✓')).toBeInTheDocument();
    expect(screen.getByText('בוטלה')).toBeInTheDocument();
    // Only the failed reminder should have edit/cancel buttons — the sent/cancelled ones must not.
    expect(screen.getAllByRole('button', { name: 'ביטול התזכורת' })).toHaveLength(1);
  });

  it('surfaces a server-side validation error (e.g. invalid recipient) without crashing', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValue(new ApiError('ניתן לשלוח תזכורת רק לעצמך או לשותף/ה המחובר/ת כרגע', 400));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'כותרת' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2099-06-15T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));

    expect(await screen.findByText('ניתן לשלוח תזכורת רק לעצמך או לשותף/ה המחובר/ת כרגע')).toBeInTheDocument();
  });

  it('never shows the full-page "loading" state again after a mutation — the list and status badge stay visible throughout', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder()] });
    let resolveCreate!: (value: Reminder) => void;
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={null} />);
    await screen.findByText('לזכור לרוץ');

    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'תזכורת שנייה' } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2099-08-01T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));

    // While the create request is still in flight, the existing list (and its content) must
    // remain visible — never replaced by the full-page loading message.
    expect(screen.queryByText('טוען תזכורות...')).not.toBeInTheDocument();
    expect(screen.getByText('לזכור לרוץ')).toBeInTheDocument();
    expect(screen.getByText('שומר...')).toBeInTheDocument(); // the mutating control's own status badge is visible

    resolveCreate(makeReminder({ id: 99, title: 'תזכורת שנייה', scheduledForIsraelWallTime: '2099-08-01T09:00' }));
    await screen.findByText('תזכורת שנייה');

    expect(screen.queryByText('טוען תזכורות...')).not.toBeInTheDocument();
    expect(screen.getByText('לזכור לרוץ')).toBeInTheDocument(); // the original reminder is still there too
  });
});

describe('RemindersPage both recipients', () => {
  const shared = { title: 'תזכורת לשנינו', body: 'לצאת לריצה' };
  const selfReminder = makeReminder({ ...shared, id: 10 });
  const partnerReminder = makeReminder({
    ...shared, id: 11, recipient: { id: PARTNER.id, email: PARTNER.email, isSelf: false },
  });

  function fillBothForm() {
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: `  ${shared.title}  ` } });
    fireEvent.change(screen.getByLabelText('תוכן (אופציונלי)'), { target: { value: `  ${shared.body}  ` } });
    fireEvent.change(screen.getByLabelText('מתי לשלוח (שעון ישראל)'), { target: { value: '2099-06-15T10:00' } });
    fireEvent.change(screen.getByLabelText('נמען/ת'), { target: { value: 'both' } });
  }

  it('schedules both with one explicit request and upserts both returned status cards without losing history', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [makeReminder({ id: 90, title: 'תזכורת ישנה', status: 'sent' })] });
    let resolveBatch!: (value: { reminders: Reminder[] }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { resolveBatch = resolve; }));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    await screen.findByRole('article', { name: 'תזכורת ישנה' });
    fillBothForm();
    expect(screen.getByText(/לכל אחד מאיתנו תיווצר תזכורת נפרדת/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    const submit = screen.getByRole('button', { name: 'קביעת תזכורת' });
    fireEvent.click(submit);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/reminders', {
      ...shared, scheduledFor: '2099-06-15T10:00', recipientUserIds: [1, 2],
    });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('article', { name: 'תזכורת ישנה' })).toBeInTheDocument();
    expect(screen.getByText('שומר...')).toBeInTheDocument();
    expect(screen.queryByText('טוען תזכורות...')).not.toBeInTheDocument();

    await act(async () => resolveBatch({ reminders: [selfReminder, partnerReminder] }));
    const cards = await screen.findAllByRole('article', { name: shared.title });
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText(/אליי/)).toBeInTheDocument();
    expect(within(cards[1]).getByText(/אל partner@a\.com/)).toBeInTheDocument();
    for (const card of cards) expect(within(card).getByText('ממתינה')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'תזכורת ישנה' })).toBeInTheDocument();
    expect(screen.getByLabelText('כותרת')).toHaveValue('');
    expect(screen.getByLabelText('נמען/ת')).toHaveValue('1');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('cancels only the chosen recipient row and leaves the other pending', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [selfReminder, partnerReminder] });
    vi.mocked(api.post).mockResolvedValueOnce({ ...selfReminder, status: 'cancelled' });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    const cards = await screen.findAllByRole('article', { name: shared.title });
    confirmCancellation();
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'ביטול התזכורת' }));
    await waitFor(() => expect(within(cards[0]).getByText('בוטלה')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/reminders/10/cancel');
    expect(within(cards[0]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(cards[1]).getByText('ממתינה')).toBeInTheDocument();
    expect(within(cards[1]).getByRole('button', { name: 'עריכה' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('edits/retries one recipient only, never offering both while editing or changing a sent row', async () => {
    vi.mocked(api.get).mockResolvedValue({
      reminders: [
        { ...selfReminder, status: 'sent', sentAt: '2026-01-02T00:00:00.000Z' },
        { ...partnerReminder, status: 'failed', lastError: 'synthetic delivery failure' },
      ],
    });
    vi.mocked(api.patch).mockResolvedValueOnce({ ...partnerReminder, title: 'רק לשותף' });
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    await screen.findAllByRole('article', { name: shared.title });
    expect(screen.getByText('נשלחה ✓')).toBeInTheDocument();
    expect(screen.getByText('נכשלה')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'עריכה / ניסיון חוזר' }));
    expect(screen.queryByRole('option', { name: 'לשנינו' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('נמען/ת')).toHaveValue('2');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'רק לשותף' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));
    expect(await screen.findByRole('article', { name: 'רק לשותף' })).toHaveTextContent('ממתינה');
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/reminders/11', {
      title: 'רק לשותף', body: shared.body, scheduledFor: '2099-06-15T10:00', recipientUserId: 2,
    });
    const sentCard = screen.getByRole('article', { name: shared.title });
    expect(within(sentCard).getByText('נשלחה ✓')).toBeInTheDocument();
    expect(within(sentCard).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'לשנינו' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    { change: 'removed', nextPartner: null },
    { change: 'replaced', nextPartner: { id: 3, email: 'new-partner@a.com', displayName: '', partnershipId: 2 } },
    { change: 're-paired', nextPartner: { ...PARTNER, partnershipId: 2 } },
  ])('requires explicit reselection when the chosen partnership is $change', async ({ nextPartner }) => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    const { rerender } = render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);
    fillBothForm();
    rerender(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={nextPartner} />);

    expect(screen.getByLabelText('נמען/ת')).toHaveValue('unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('השותפות השתנתה. יש לבחור נמען/ת מחדש');
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('כותרת')).toHaveValue(`  ${shared.title}  `);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    if (nextPartner) {
      vi.mocked(api.post).mockResolvedValueOnce({
        reminders: [selfReminder, { ...partnerReminder, recipient: { ...nextPartner, isSelf: false } }],
      });
      fireEvent.change(screen.getByLabelText('נמען/ת'), { target: { value: 'both' } });
    } else {
      expect(screen.queryByRole('option', { name: 'לשנינו' })).not.toBeInTheDocument();
      vi.mocked(api.post).mockResolvedValueOnce(selfReminder);
      fireEvent.change(screen.getByLabelText('נמען/ת'), { target: { value: '1' } });
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reminders', {
      ...shared,
      scheduledFor: '2099-06-15T10:00',
      ...(nextPartner ? { recipientUserIds: [1, nextPartner.id] } : { recipientUserId: 1 }),
    }));
    expect(api.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('כותרת')).toHaveValue(''));
  });

  it('surfaces a stale-partner API rejection without a self-only fallback or partial local cards', async () => {
    vi.mocked(api.get).mockResolvedValue({ reminders: [] });
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError('ניתן לשלוח תזכורת רק לעצמך או לשותף/ה המחובר/ת כרגע', 400));
    render(<RemindersPage ownUserId={1} ownEmail="owner@a.com" partner={PARTNER} />);
    await screen.findByText(/עדיין לא נקבעו תזכורות/);
    fillBothForm();
    fireEvent.click(screen.getByRole('button', { name: 'קביעת תזכורת' }));
    expect(await screen.findByText('ניתן לשלוח תזכורת רק לעצמך או לשותף/ה המחובר/ת כרגע')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/reminders', {
      ...shared, scheduledFor: '2099-06-15T10:00', recipientUserIds: [1, 2],
    });
    expect(screen.getByLabelText('נמען/ת')).toHaveValue('both');
    expect(screen.getByLabelText('כותרת')).toHaveValue(`  ${shared.title}  `);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'קביעת תזכורת' })).toBeEnabled();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
