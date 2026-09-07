import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWamDetail } from '../hooks/useWams';
import { api } from '../lib/api';
import type { WamDetail } from '../lib/types';

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
  vi.clearAllMocks();
});

function makeWam(overrides: Partial<WamDetail> = {}): WamDetail {
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
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useWamDetail: invitation-only scheduling', () => {
  const schedule = { nextWamAt: '2099-07-15T07:00:00.000Z', nextWamDurationMinutes: 45 };

  it('uses the calendar endpoint for completed WAMs and returns no completion celebration', async () => {
    const completed = makeWam({ status: 'complete', completedAt: '2026-01-01T00:00:00.000Z' });
    const updated = { ...completed, nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 1 } };
    vi.mocked(api.get).mockResolvedValue(completed);
    vi.mocked(api.put).mockResolvedValue({ wam: updated });
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => {
      expect(await result.current.complete(schedule)).toEqual({ wam: updated, celebration: null });
    });
    expect(api.put).toHaveBeenCalledWith('/wams/1/next-wam', schedule);
    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.wam?.completedAt).toBe(completed.completedAt);
    expect(result.current.wam?.nextWam.at).toBe(schedule.nextWamAt);
  });

  it('retains draft completion semantics, including optional no-date completion', async () => {
    vi.mocked(api.get).mockResolvedValue(makeWam());
    const response = { wam: makeWam({ status: 'complete' }), celebration: { type: 'completion' } };
    vi.mocked(api.post).mockResolvedValue(response);
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => { expect(await result.current.complete()).toEqual(response); });
    expect(api.post).toHaveBeenCalledWith('/wams/1/complete', {});
    expect(api.put).not.toHaveBeenCalled();
  });

  it('refreshes persisted partial delivery without hiding the error, then permits retry', async () => {
    const completed = makeWam({ status: 'complete' });
    const failed = makeWam({
      status: 'complete', nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 0 },
      calendarInvitations: {
        a: { status: 'sent', error: null, sentAt: '2026-01-01T00:00:00Z' },
        b: { status: 'failed', error: 'synthetic failure', sentAt: null },
      },
    });
    vi.mocked(api.get).mockResolvedValueOnce(completed).mockResolvedValueOnce(failed);
    vi.mocked(api.put).mockRejectedValueOnce(new Error('שליחה נכשלה')).mockResolvedValueOnce({ wam: failed });
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => { await expect(result.current.complete(schedule)).rejects.toThrow('שליחה נכשלה'); });
    expect(result.current.wam?.calendarInvitations.b.status).toBe('failed');
    expect(result.current.wam?.nextWam.at).toBe(schedule.nextWamAt);
    await act(async () => { await result.current.complete(schedule); });
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('scheduleNextWam schedules a draft without completing it or freezing its scores', async () => {
    const draft = makeWam();
    const updated = { ...draft, nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 1 } };
    vi.mocked(api.get).mockResolvedValue(draft);
    vi.mocked(api.put).mockResolvedValue({ wam: updated });
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => {
      expect(await result.current.scheduleNextWam(schedule)).toEqual({ wam: updated, celebration: null });
    });
    expect(api.put).toHaveBeenCalledWith('/wams/1/next-wam', schedule);
    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.wam?.status).toBe('draft');
    expect(result.current.wam?.completedAt).toBeNull();
    expect(result.current.wam?.nextWam.at).toBe(schedule.nextWamAt);
  });

  it('scheduleNextWam refreshes persisted partial delivery on a draft without hiding the error', async () => {
    const draft = makeWam();
    const failed = makeWam({
      nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 0 },
      calendarInvitations: {
        a: { status: 'sent', error: null, sentAt: '2026-01-01T00:00:00Z' },
        b: { status: 'failed', error: 'synthetic failure', sentAt: null },
      },
    });
    vi.mocked(api.get).mockResolvedValueOnce(draft).mockResolvedValueOnce(failed);
    vi.mocked(api.put).mockRejectedValueOnce(new Error('שליחה נכשלה'));
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => { await expect(result.current.scheduleNextWam(schedule)).rejects.toThrow('שליחה נכשלה'); });
    expect(result.current.wam?.calendarInvitations.b.status).toBe('failed');
    expect(result.current.wam?.status).toBe('draft');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not overwrite another meeting when a calendar update resolves after navigation', async () => {
    const pending = deferred<{ wam: WamDetail }>();
    vi.mocked(api.get).mockResolvedValueOnce(makeWam({ status: 'complete' })).mockResolvedValueOnce(makeWam({ id: 2 }));
    vi.mocked(api.put).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id }) => useWamDetail(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    let call!: ReturnType<typeof result.current.complete>;
    await act(async () => { call = result.current.complete(schedule); await Promise.resolve(); });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.wam?.id).toBe(2));
    await act(async () => { pending.resolve({ wam: makeWam({ status: 'complete' }) }); await call; });
    expect(result.current.wam?.id).toBe(2);
  });
});

describe('useWamDetail: initial load', () => {
  it('ignores a previous WAM load error after navigation and clears errors on recovery', async () => {
    const first = deferred<WamDetail>();
    vi.mocked(api.get).mockReturnValueOnce(first.promise).mockResolvedValueOnce(makeWam({ id: 2 }));
    const { result, rerender } = renderHook(({ id }) => useWamDetail(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.wam?.id).toBe(2));
    await act(async () => { first.reject(new Error('stale failure')); });
    expect(result.current.loadStatus).toBe('ready');
    expect(result.current.loadError).toBeNull();

    vi.mocked(api.get).mockRejectedValueOnce(new Error('current failure'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.loadStatus).toBe('error');
    vi.mocked(api.get).mockResolvedValueOnce(makeWam({ id: 2 }));
    await act(async () => { await result.current.reload(); });
    expect(result.current.loadStatus).toBe('ready');
    expect(result.current.loadError).toBeNull();
  });

  it('loads the WAM and exposes it once ready', async () => {
    vi.mocked(api.get).mockResolvedValue(makeWam());
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.wam?.id).toBe(1);
  });
});

describe('useWamDetail: mutation queue serialization (rapid punishment operations)', () => {
  it('applies two rapid updatePunishment calls in the order they were invoked, never letting the earlier call\'s late-resolving response overwrite the later one\'s result', async () => {
    vi.mocked(api.get).mockResolvedValue(makeWam());
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    const first = deferred<WamDetail>();
    const second = deferred<WamDetail>();
    vi.mocked(api.patch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    let firstResult: WamDetail | undefined;
    let secondResult: WamDetail | undefined;

    // Fire both calls "rapidly" (before either resolves).
    const firstCall = result.current.updatePunishment(1, { label: 'עדכון ראשון' }).then((r) => {
      firstResult = r;
    });
    const secondCall = result.current.updatePunishment(1, { label: 'עדכון שני' }).then((r) => {
      secondResult = r;
    });

    // Even after flushing microtasks, the SECOND call's own network request must not have
    // been issued yet — the FIFO queue holds it back until the first settles. This is the
    // actual guarantee that prevents a reordered/stale response from ever being applied: if
    // the second request is never even in flight while the first still is, there is nothing
    // for the server to reorder against.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patch).toHaveBeenCalledTimes(1);

    // Resolving the (irrelevant, not-yet-awaited) second deferred promise ahead of time must
    // have no effect while the first request is still outstanding.
    second.resolve(makeWam({ punishments: [{ ...blankPunishment(), label: 'עדכון שני' }] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.patch).toHaveBeenCalledTimes(1);

    // Now resolve the first — only then may the second task's own request actually start.
    await act(async () => {
      first.resolve(makeWam({ punishments: [{ ...blankPunishment(), label: 'עדכון ראשון' }] }));
      await firstCall;
      await secondCall;
    });
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(firstResult?.punishments[0].label).toBe('עדכון ראשון');
    expect(secondResult?.punishments[0].label).toBe('עדכון שני');
    // Final displayed state reflects the LAST-invoked mutation, never regressed back to the
    // first one by a late/out-of-order response.
    expect(result.current.wam?.punishments[0].label).toBe('עדכון שני');
  });

  it('preserves the rejection of a failed mutation while still letting subsequent queued mutations run', async () => {
    vi.mocked(api.get).mockResolvedValue(makeWam());
    const { result } = renderHook(() => useWamDetail(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    vi.mocked(api.post).mockRejectedValueOnce(new Error('שגיאת שרת'));
    vi.mocked(api.post).mockResolvedValueOnce({ punishmentId: 5, wam: makeWam({ punishments: [{ ...blankPunishment(), id: 5 }] }) });

    await expect(result.current.addPunishment('עונש שנכשל', 20)).rejects.toThrow('שגיאת שרת');

    const second = await result.current.addPunishment('עונש שהצליח', 20);
    expect(second?.punishments).toHaveLength(1);
  });

  it('does not overwrite the currently-displayed WAM with a stale mutation response after the hook has switched to a different WAM id', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/wams/1') return Promise.resolve(makeWam({ id: 1 }));
      if (path === '/wams/2') return Promise.resolve(makeWam({ id: 2, week: 4 }));
      return Promise.reject(new Error('unexpected path'));
    });
    const { result, rerender } = renderHook(({ wamId }) => useWamDetail(wamId), { initialProps: { wamId: 1 } });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.wam?.id).toBe(1);

    const slowMutation = deferred<WamDetail>();
    vi.mocked(api.patch).mockReturnValueOnce(slowMutation.promise);

    let mutationSettled = false;
    const pending = result.current.updateContent({ wins: 'עדכון על wam 1' }).then(() => {
      mutationSettled = true;
    });

    // Switch to a different WAM before the slow mutation resolves.
    rerender({ wamId: 2 });
    await waitFor(() => expect(result.current.wam?.id).toBe(2));

    // Now the stale mutation (for wam 1) resolves — it must NOT clobber the now-displayed wam 2.
    await act(async () => {
      slowMutation.resolve(makeWam({ id: 1, wins: 'עדכון על wam 1' }));
      await pending;
    });
    expect(mutationSettled).toBe(true);
    expect(result.current.wam?.id).toBe(2); // unchanged — the stale response was discarded
  });
});

function blankPunishment() {
  return {
    id: 1,
    label: '',
    done: false,
    completedAt: null,
    dueWamId: null,
    authorUserId: 10,
    authorLabel: 'a@a.com',
    assignedUserId: 20,
    assigneeLabel: 'b@a.com',
    canEdit: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
