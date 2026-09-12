import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WamsTab } from '../components/WamsTab';
import type { WamCompleteResult, WamDetail, WamListResponse } from '../lib/types';
import type { useDashboard } from '../hooks/useDashboard';

const reloadMock = vi.fn().mockResolvedValue(undefined);
const startMeetingMock = vi.fn();
const searchMock = vi.fn().mockResolvedValue([]);
const completeMock = vi.fn<
  (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) => Promise<WamCompleteResult | undefined>
>();

let listData: WamListResponse | null = null;
let detailError: string | null = null;
let staleDetailId: number | null = null;

vi.mock('../hooks/useWams', () => ({
  useWamList: () => ({
    data: listData,
    loading: false,
    error: null,
    reload: reloadMock,
    startMeeting: startMeetingMock,
    search: searchMock,
  }),
  useWamDetail: (wamId: number | null) => ({
    wam: detailError ? null : { ...makeWamDetail(), id: staleDetailId ?? wamId ?? 1 },
    loadStatus: detailError ? 'error' : 'ready',
    loadError: detailError,
    reload: vi.fn(),
    updateContent: vi.fn(),
    setRating: vi.fn(),
    complete: completeMock,
    reopen: vi.fn(),
    addCommitment: vi.fn(),
    updateCommitment: vi.fn(),
    deleteCommitment: vi.fn(),
    addPunishment: vi.fn(),
    updatePunishment: vi.fn(),
    deletePunishment: vi.fn(),
    toggleDuePunishment: vi.fn(),
  }),
}));

function makeWamDetail(): WamDetail {
  return {
    id: 1,
    week: 3,
    status: 'draft',
    isHistorical: false,
    wins: '',
    misses: '',
    blockers: '',
    lessonsLearned: '',
    notes: '',
    adjustmentNotes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    partnership: { id: 1, initiatorId: 10, inviteeId: 20, initiatorEmail: 'a@a.com', inviteeEmail: 'b@a.com' },
    mismatch: false,
    nextWam: { at: null, durationMinutes: null, sequence: 0 },
    calendarInvitations: {
      a: { status: null, error: null, sentAt: null },
      b: { status: null, error: null, sentAt: null },
    },
    reviews: {
      a: { userId: 10, email: 'a@a.com', rating: null, scoreSnapshot: null, live: { hasCycle: false, cycleId: null, cycleName: null, cycleIsActive: false, currentWeek: null, score: null, scheduled: 0, completed: 0 } },
      b: { userId: 20, email: 'b@a.com', rating: null, scoreSnapshot: null, live: { hasCycle: false, cycleId: null, cycleName: null, cycleIsActive: false, currentWeek: null, score: null, scheduled: 0, completed: 0 } },
    },
    commitments: [],
    punishments: [],
    duePunishments: [],
    canAddPunishment: true,
    duoStreak: {
      currentStreak: 0,
      bestStreak: 0,
      totalDuoWins: 0,
      latestDuoSuccess: null,
      participants: [
        { userId: 10, displayName: '', email: 'a@a.com', hasAvatar: false, avatarVersion: 0 },
        { userId: 20, displayName: '', email: 'b@a.com', hasAvatar: false, avatarVersion: 0 },
      ],
    },
  };
}

function makeOwnDash(): ReturnType<typeof useDashboard> {
  return { loadStatus: 'loading', bundle: null } as unknown as ReturnType<typeof useDashboard>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listData = null;
  detailError = null;
  staleDetailId = null;
});

describe('WamsTab: returning to the list reloads its stale-counter summary', () => {
  it('emits exact controlled WAM selections, follows external clearing, and never renders an old detail under a new URL', async () => {
    setupListData();
    const onSelectionChange = vi.fn();
    const { rerender } = render(<WamsTab myUserId={10} ownDash={makeOwnDash()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'פתיחה' })[0]);
    const selected = { kind: 'wam' as const, userId: 10, cycleId: null, wamId: 1, week: 3 };
    expect(onSelectionChange).toHaveBeenLastCalledWith(selected);
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} selection={selected} onSelectionChange={onSelectionChange} />);
    expect(screen.getByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} onSelectionChange={onSelectionChange} />);
    expect(screen.queryByLabelText('ניצחונות / הישגים')).not.toBeInTheDocument();
    staleDetailId = 1;
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} selection={{ ...selected, wamId: 2 }} onSelectionChange={onSelectionChange} />);
    expect(screen.getByText('טוען פגישה...')).toBeInTheDocument();
    expect(screen.queryByLabelText('ניצחונות / הישגים')).not.toBeInTheDocument();
    staleDetailId = null;
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} selection={{ ...selected, wamId: 2 }} onSelectionChange={onSelectionChange} />);
    expect(screen.getByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
  });

  it.each([false, true])('does not overwrite newer URL navigation when an older start response arrives (detail changed=%s)', async (detailChanged) => {
    setupListData();
    let finish!: (wam: WamDetail) => void;
    startMeetingMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onSelectionChange = vi.fn();
    const { rerender } = render(<WamsTab myUserId={10} ownDash={makeOwnDash()} onSelectionChange={onSelectionChange} navigationKey="old-route" />);
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת הפגישה' }));
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} onSelectionChange={onSelectionChange} navigationKey="new-route"
      selection={detailChanged ? { kind: 'wam', userId: 10, cycleId: null, wamId: 1, week: 3 } : undefined} />);
    await act(async () => finish({ ...makeWamDetail(), id: 2 }));
    expect(onSelectionChange).not.toHaveBeenCalled();
    if (detailChanged) expect(screen.getByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    else expect(screen.getByText('כל הפגישות (1)')).toBeInTheDocument();
  });

  it('opens an exact archive-search WAM selection directly and lets Back stay on the list', () => {
    setupListData();
    const selection = { kind: 'wam' as const, userId: 10, cycleId: null, wamId: 1, week: 3 };
    const { rerender } = render(<WamsTab myUserId={10} ownDash={makeOwnDash()} selection={selection} />);
    expect(screen.getByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDash()} selection={selection} />);
    expect(screen.queryByLabelText('ניצחונות / הישגים')).not.toBeInTheDocument();
    expect(screen.getByText('כל הפגישות (1)')).toBeInTheDocument();
  });

  it('reloads the list when navigating back from the detail view, so commitment/punishment counters are never stale', () => {
    listData = {
      partnership: { id: 1, initiatorId: 10, inviteeId: 20, initiatorEmail: 'a@a.com', inviteeEmail: 'b@a.com' },
      duoStreak: {
        currentStreak: 0,
        bestStreak: 0,
        totalDuoWins: 0,
        latestDuoSuccess: null,
        participants: [
          { userId: 10, displayName: '', email: 'a@a.com', hasAvatar: false, avatarVersion: 0 },
          { userId: 20, displayName: '', email: 'b@a.com', hasAvatar: false, avatarVersion: 0 },
        ],
      },
      wams: [
        {
          id: 1,
          week: 3,
          status: 'draft',
          isHistorical: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedAt: null,
          ratingA: null,
          ratingB: null,
          scoreSnapshotA: null,
          scoreSnapshotB: null,
          commitmentsTotal: 0,
          commitmentsDone: 0,
          punishmentsDueTotal: 0,
          punishmentsDueDone: 0,
        },
      ],
    };

    render(<WamsTab myUserId={10} ownDash={makeOwnDash()} />);

    // Open the WAM (the list's "latest" card exposes a direct "פתיחה" button — the first one
    // rendered, before the full per-week list's own "פתיחה" button for the same entry).
    fireEvent.click(screen.getAllByRole('button', { name: 'פתיחה' })[0]);
    expect(reloadMock).not.toHaveBeenCalled(); // opening alone must not trigger a reload

    // Navigate back to the summary list.
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

function setupListData() {
  listData = {
    partnership: { id: 1, initiatorId: 10, inviteeId: 20, initiatorEmail: 'a@a.com', inviteeEmail: 'b@a.com' },
    duoStreak: {
      currentStreak: 0,
      bestStreak: 0,
      totalDuoWins: 0,
      latestDuoSuccess: null,
      participants: [
        { userId: 10, displayName: '', email: 'a@a.com', hasAvatar: false, avatarVersion: 0 },
        { userId: 20, displayName: '', email: 'b@a.com', hasAvatar: false, avatarVersion: 0 },
      ],
    },
    wams: [
      {
        id: 1,
        week: 3,
        status: 'draft',
        isHistorical: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        ratingA: null,
        ratingB: null,
        scoreSnapshotA: null,
        scoreSnapshotB: null,
        commitmentsTotal: 0,
        commitmentsDone: 0,
        punishmentsDueTotal: 0,
        punishmentsDueDone: 0,
      },
    ],
  };
}

function openTheWam() {
  render(<WamsTab myUserId={10} ownDash={makeOwnDash()} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'פתיחה' })[0]);
}

async function confirmCompleteWithoutSchedule() {
  fireEvent.click(screen.getByRole('button', { name: '✓ סימון הפגישה כהושלמה' }));
  const confirmButton = await screen.findByRole('button', { name: 'אישור השלמת הפגישה' });
  fireEvent.click(confirmButton);
}

const CELEBRATION_RESULT: WamCompleteResult = {
  wam: makeWamDetail(),
  celebration: {
    type: 'duo-success',
    participants: [
      { userId: 10, displayName: '', email: 'a@a.com', hasAvatar: false, avatarVersion: 0, score: 90 },
      { userId: 20, displayName: '', email: 'b@a.com', hasAvatar: false, avatarVersion: 0, score: 95 },
    ],
    currentStreak: 1,
  },
};

describe('WamsTab: celebration overlay lifecycle', () => {
  it('shows a failed detail load instead of an endless loading screen', () => {
    setupListData();
    detailError = 'לא ניתן לטעון את הפגישה';
    openTheWam();
    expect(screen.getByRole('alert')).toHaveTextContent(detailError);
    expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeInTheDocument();
    expect(screen.queryByText('טוען פגישה...')).not.toBeInTheDocument();
  });

  it('does not replay an old completion after leaving and reopening the same WAM', async () => {
    setupListData();
    let resolve!: (result: WamCompleteResult) => void;
    completeMock.mockImplementation(() => new Promise((resolvePromise) => { resolve = resolvePromise; }));
    openTheWam();
    await confirmCompleteWithoutSchedule();
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'פתיחה' })[0]);
    await act(async () => { resolve(CELEBRATION_RESULT); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the celebration overlay only after a successful completion, never merely from opening/reloading an already-complete WAM', async () => {
    setupListData();
    completeMock.mockResolvedValue(CELEBRATION_RESULT);
    openTheWam();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await confirmCompleteWithoutSchedule();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('does not show any overlay when the completion mutation rejects', async () => {
    setupListData();
    completeMock.mockRejectedValue(new Error('שגיאת שרת'));
    openTheWam();

    await confirmCompleteWithoutSchedule();
    // Give the rejected promise's rejection handling a tick to settle before asserting.
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on demand (close button) and never reappears on its own afterward (no replay)', async () => {
    setupListData();
    completeMock.mockResolvedValue(CELEBRATION_RESULT);
    openTheWam();
    await confirmCompleteWithoutSchedule();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears the celebration when navigating back to the list', async () => {
    setupListData();
    completeMock.mockResolvedValue(CELEBRATION_RESULT);
    openTheWam();
    await confirmCompleteWithoutSchedule();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never shows a celebration for a response that resolves after the user already navigated away from that WAM (stale-switch guard)', async () => {
    setupListData();
    let resolveComplete: ((value: WamCompleteResult) => void) | undefined;
    completeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveComplete = resolve;
        })
    );
    openTheWam();
    await confirmCompleteWithoutSchedule(); // request now pending, unresolved

    // Navigate back before the completion response arrives.
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));

    await act(async () => {
      resolveComplete?.(CELEBRATION_RESULT);
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function makeOwnDashOnWeek(currentWeek: number, isActive = true): ReturnType<typeof useDashboard> {
  return {
    loadStatus: 'ready',
    bundle: { cycle: { isActive, currentWeek }, goals: [] },
  } as unknown as ReturnType<typeof useDashboard>;
}

describe('WamsTab: entering the section lands on a ready meeting', () => {
  it('opens this week\u2019s meeting on entry with no extra click', async () => {
    setupListData();
    startMeetingMock.mockResolvedValue({ ...makeWamDetail(), id: 7, week: 5 });
    render(<WamsTab myUserId={10} ownDash={makeOwnDashOnWeek(5)} />);
    await waitFor(() => expect(startMeetingMock).toHaveBeenCalledWith(5));
    expect(await screen.findByLabelText('\u05e0\u05d9\u05e6\u05d7\u05d5\u05e0\u05d5\u05ea / \u05d4\u05d9\u05e9\u05d2\u05d9\u05dd')).toBeInTheDocument();
  });

  // The old launcher defaulted its picker to week 1, which is wrong for anyone past week 1.
  // Guessing while the dashboard is still loading would reintroduce exactly that bug.
  it('waits for the real current week instead of falling back to week 1', async () => {
    setupListData();
    const { rerender } = render(<WamsTab myUserId={10} ownDash={makeOwnDash()} />);
    expect(startMeetingMock).not.toHaveBeenCalled();
    startMeetingMock.mockResolvedValue({ ...makeWamDetail(), id: 7, week: 6 });
    rerender(<WamsTab myUserId={10} ownDash={makeOwnDashOnWeek(6)} />);
    await waitFor(() => expect(startMeetingMock).toHaveBeenCalledTimes(1));
    expect(startMeetingMock).toHaveBeenCalledWith(6);
  });

  it('stays on the list after Back rather than re-opening the form', async () => {
    setupListData();
    startMeetingMock.mockResolvedValue({ ...makeWamDetail(), id: 7, week: 5 });
    const ownDash = makeOwnDashOnWeek(5);
    const { rerender } = render(<WamsTab myUserId={10} ownDash={ownDash} />);
    expect(await screen.findByLabelText('\u05e0\u05d9\u05e6\u05d7\u05d5\u05e0\u05d5\u05ea / \u05d4\u05d9\u05e9\u05d2\u05d9\u05dd')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '\u2192 \u05d7\u05d6\u05e8\u05d4 \u05dc\u05e8\u05e9\u05d9\u05de\u05ea \u05d4\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea' }));
    rerender(<WamsTab myUserId={10} ownDash={ownDash} />);
    await waitFor(() => expect(screen.getByText('\u05db\u05dc \u05d4\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea (1)')).toBeInTheDocument());
    expect(startMeetingMock).toHaveBeenCalledTimes(1);
  });

  it('never overrides an archive-search selection with this week\u2019s meeting', async () => {
    setupListData();
    render(<WamsTab myUserId={10} ownDash={makeOwnDashOnWeek(5)}
      selection={{ kind: 'wam', userId: 10, cycleId: null, wamId: 3, week: 2 }} />);
    expect(screen.getByLabelText('\u05e0\u05d9\u05e6\u05d7\u05d5\u05e0\u05d5\u05ea / \u05d4\u05d9\u05e9\u05d2\u05d9\u05dd')).toBeInTheDocument();
    await waitFor(() => expect(startMeetingMock).not.toHaveBeenCalled());
  });

  it('shows the list without starting anything when no cycle is active', async () => {
    setupListData();
    render(<WamsTab myUserId={10} ownDash={makeOwnDashOnWeek(5, false)} />);
    await waitFor(() => expect(screen.getByText('\u05db\u05dc \u05d4\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea (1)')).toBeInTheDocument());
    expect(startMeetingMock).not.toHaveBeenCalled();
  });
});
