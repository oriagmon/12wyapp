import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboard } from '../hooks/useDashboard';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../lib/api';
import type { AuthUser } from '../context/AuthContext';
import type { DashboardBundle } from '../lib/types';
import { subscribeSuccess } from '../lib/celebrations';

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

function executionBundle(): DashboardBundle {
  return makeBundle({
    goals: [{
      id: 1, title: 'מטרה', color: 'emerald',
      tactics: [{ id: 10, title: 'צעד', weekdays: [0, 1], startWeek: 1, endWeek: 12, completions: [] }],
    }],
    weekScores: [{ week: 1, score: 0, scheduled: 2, completed: 0 }],
  });
}

describe('useDashboard confirmed-owner success events', () => {
  it('emits only after a successful meaningful completion, never after load or before response', async () => {
    setupGetMock({ 1: executionBundle() });
    let resolve!: () => void;
    vi.mocked(api.post).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result } = renderHook(() => useDashboard(1), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      expect(listener).not.toHaveBeenCalled();
      let mutation!: Promise<void>;
      act(() => { mutation = result.current.toggleCompletion(10, 1, 0, true); });
      expect(listener).not.toHaveBeenCalled();
      await act(async () => { resolve(); await mutation; });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 1, owner: true, success: true, completed: true, firstStep: true,
        occurrenceId: 'completion:1:10:1:0',
      }));
    } finally { unsubscribe(); }
  });

  it('does not emit for errors, unchecking, unchanged completions or unscheduled cells', async () => {
    const bundle = executionBundle();
    bundle.goals[0].tactics[0].completions.push({ week: 1, weekday: 0, done: true });
    setupGetMock({ 1: bundle });
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result } = renderHook(() => useDashboard(1), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      vi.mocked(api.post).mockRejectedValueOnce(new Error('save failed'));
      await act(async () => { await expect(result.current.toggleCompletion(10, 1, 1, true)).rejects.toThrow('save failed'); });
      vi.mocked(api.post).mockResolvedValue(undefined);
      await act(async () => {
        await result.current.toggleCompletion(10, 1, 0, false);
        await result.current.toggleCompletion(10, 1, 0, true);
        await result.current.toggleCompletion(10, 1, 6, true);
      });
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('never emits for a read-only partner even if a mocked server accepts the save', async () => {
    setupGetMock({ 2: { ...executionBundle(), access: 'partner' } });
    vi.mocked(api.post).mockResolvedValue(undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result } = renderHook(() => useDashboard(2), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      await act(async () => { await result.current.toggleCompletion(10, 1, 0, true); });
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('derives a milestone only from a confirmed score crossing, not a GET alone', async () => {
    const before = executionBundle();
    before.weekScores = [{ week: 1, score: 80, completed: 8, scheduled: 10 }];
    const after = { ...before, weekScores: [{ week: 1, score: 90, completed: 9, scheduled: 10 }] };
    setupGetMock({ 1: before });
    vi.mocked(api.post).mockImplementation(async () => { setupGetMock({ 1: after }); });
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result } = renderHook(() => useDashboard(1), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      await act(async () => { await result.current.toggleCompletion(10, 1, 0, true); });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: 'milestone' }));
    } finally { unsubscribe(); }
  });

  it('gives each genuine re-crossing a fresh milestone identity, without rerolling ordinary completions', async () => {
    const before = executionBundle();
    before.weekScores = [{ week: 1, score: 80, completed: 8, scheduled: 10 }];
    const after = structuredClone(before);
    after.goals[0].tactics[0].completions = [{ week: 1, weekday: 0, done: true }];
    after.weekScores = [{ week: 1, score: 90, completed: 9, scheduled: 10 }];
    setupGetMock({ 1: before });
    vi.mocked(api.post).mockImplementation(async (_url, body) => {
      setupGetMock({ 1: (body as { done: boolean }).done ? after : before });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result } = renderHook(() => useDashboard(1), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      await act(async () => { await result.current.toggleCompletion(10, 1, 0, true); });
      await act(async () => { await result.current.toggleCompletion(10, 1, 0, false); });
      await act(async () => { await result.current.toggleCompletion(10, 1, 0, true); });
      expect(listener).toHaveBeenCalledTimes(2);
      const first = listener.mock.calls[0][0];
      const second = listener.mock.calls[1][0];
      expect(first.kind).toBe('milestone');
      expect(second.kind).toBe('milestone');
      expect(first.occurrenceId).not.toBe(second.occurrenceId);
    } finally { unsubscribe(); }
  });

  it('drops late mutation success after switching target user', async () => {
    setupGetMock({ 1: executionBundle(), 2: { ...executionBundle(), access: 'partner' } });
    let resolve!: () => void;
    vi.mocked(api.post).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result, rerender } = renderHook(({ target }) => useDashboard(target), { initialProps: { target: 1 }, wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      let mutation!: Promise<void>;
      act(() => { mutation = result.current.toggleCompletion(10, 1, 0, true); });
      rerender({ target: 2 });
      await waitFor(() => expect(result.current.bundle?.access).toBe('partner'));
      await act(async () => { resolve(); await mutation; });
      expect(listener).not.toHaveBeenCalled();
      expect(result.current.bundle?.access).toBe('partner');
    } finally { unsubscribe(); }
  });

  it('drops late success after unmount and does not refresh or replay', async () => {
    setupGetMock({ 1: executionBundle() });
    let resolve!: () => void;
    vi.mocked(api.post).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const listener = vi.fn();
    const unsubscribe = subscribeSuccess(listener);
    try {
      const { result, unmount } = renderHook(() => useDashboard(1), { wrapper });
      await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
      const calls = vi.mocked(api.get).mock.calls.length;
      let mutation!: Promise<void>;
      act(() => { mutation = result.current.toggleCompletion(10, 1, 0, true); });
      unmount();
      await act(async () => { resolve(); await mutation; });
      expect(listener).not.toHaveBeenCalled();
      expect(vi.mocked(api.get).mock.calls).toHaveLength(calls);
    } finally { unsubscribe(); }
  });
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

function makeBundle(overrides: Partial<DashboardBundle> = {}): DashboardBundle {
  return {
    access: 'owner',
    targetEmail: 'owner@a.com',
    cycle: {
      id: 1,
      name: 'C1',
      currentWeek: 2,
      isActive: true,
      vision: '',
      successDefinition: '',
      whyItMatters: '',
      blockers: '',
      risks: '',
      lagMeasures: '',
      leadMeasures: '',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    goals: [],
    weekScores: [],
    averageScore: null,
    ...overrides,
  };
}

/** Routes GET calls to the right fixture by path, so /auth/me and /dashboard/:id can be
 *  told apart and their call counts tracked independently. */
function setupGetMock(bundlesByUserId: Record<number, DashboardBundle>) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/auth/me') return AUTH_USER;
    const match = /^\/dashboard\/(\d+)$/.exec(path);
    if (match) {
      const userId = Number(match[1]);
      return bundlesByUserId[userId];
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

function authMeCallCount() {
  return vi.mocked(api.get).mock.calls.filter(([path]) => path === '/auth/me').length;
}

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('useDashboard: refreshUser is triggered after own-user mutations only', () => {
  it('a successful completion toggle on the OWN dashboard triggers a refreshUser() call', async () => {
    setupGetMock({ 1: makeBundle() });
    vi.mocked(api.post).mockResolvedValue(undefined);

    const { result } = renderHook(() => useDashboard(1), { wrapper });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const callsBefore = authMeCallCount();
    expect(callsBefore).toBeGreaterThan(0); // AuthProvider's mount fetch already happened

    await act(async () => {
      await result.current.toggleCompletion(10, 1, 0, true);
    });

    describe('useDashboard URL-controlled viewed weeks', () => {
      it('restores the explicit URL week before async data and preserves it across reloads', async () => {
        const bundles = { 1: makeBundle() };
        setupGetMock(bundles);
        const onViewedWeekChange = vi.fn();
        const { result, rerender } = renderHook(({ week }) =>
          useDashboard(1, { viewedWeek: week, onViewedWeekChange }),
        { initialProps: { week: 9 as number | null }, wrapper });
        expect(result.current.viewedWeek).toBe(9);
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.viewedWeek).toBe(9);
        bundles[1] = makeBundle({ cycle: { ...makeBundle().cycle!, currentWeek: 7 } });
        await act(async () => { await result.current.reload(); });
        expect(result.current.viewedWeek).toBe(9);
        expect(onViewedWeekChange).not.toHaveBeenCalled();
        rerender({ week: 3 });
        expect(result.current.viewedWeek).toBe(3);
      });

      it('uses current cycle week only when a URL week is absent, without writing navigation', async () => {
        setupGetMock({ 1: makeBundle({ cycle: { ...makeBundle().cycle!, currentWeek: 6 } }) });
        const onViewedWeekChange = vi.fn();
        const { result } = renderHook(() => useDashboard(1, { viewedWeek: null, onViewedWeekChange }), { wrapper });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.viewedWeek).toBe(6);
        expect(onViewedWeekChange).not.toHaveBeenCalled();
      });

      it('sends valid user-selected weeks to the URL owner, without locally overriding the controlled week', async () => {
        setupGetMock({ 1: makeBundle() });
        const onViewedWeekChange = vi.fn();
        const { result } = renderHook(() => useDashboard(1, { viewedWeek: 4, onViewedWeekChange }), { wrapper });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        act(() => {
          result.current.setViewedWeek(8);
          result.current.setViewedWeek(0);
          result.current.setViewedWeek(13);
          result.current.setViewedWeek(1.5);
          result.current.setViewedWeek(4);
        });
        expect(onViewedWeekChange).toHaveBeenCalledTimes(1);
        expect(onViewedWeekChange).toHaveBeenCalledWith(8);
        expect(result.current.viewedWeek).toBe(4);
      });

      it('never loads an own fallback while a partner URL is unresolved', async () => {
        setupGetMock({ 2: makeBundle({ access: 'partner' }) });
        const navigation = { viewedWeek: 10, onViewedWeekChange: vi.fn() };
        const { result, rerender } = renderHook(({ target }) => useDashboard(target, navigation), {
          initialProps: { target: null as number | null }, wrapper,
        });
        await waitFor(() => expect(authMeCallCount()).toBeGreaterThan(0));
        expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/dashboard/'))).toBe(false);
        expect(result.current.bundle).toBeNull();
        rerender({ target: 2 });
        await waitFor(() => expect(result.current.bundle?.access).toBe('partner'));
        expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.startsWith('/dashboard/'))).toEqual([['/dashboard/2']]);
        expect(result.current.viewedWeek).toBe(10);
      });

      it('hides the previous board immediately when the resolved board becomes unavailable', async () => {
        setupGetMock({ 2: makeBundle({ access: 'partner' }) });
        const { result, rerender } = renderHook(({ target }) => useDashboard(target), {
          initialProps: { target: 2 as number | null }, wrapper,
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        rerender({ target: null });
        expect(result.current.bundle).toBeNull();
        expect(result.current.loadStatus).toBe('loading');
      });
    });

    expect(authMeCallCount()).toBeGreaterThan(callsBefore);
  });

  it('a successful cycle update (current-week change) on the OWN dashboard triggers a refreshUser() call', async () => {
    setupGetMock({ 1: makeBundle() });
    vi.mocked(api.patch).mockResolvedValue(makeBundle().cycle);

    const { result } = renderHook(() => useDashboard(1), { wrapper });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const callsBefore = authMeCallCount();

    await act(async () => {
      await result.current.updateCycle({ currentWeek: 3 });
    });

    expect(authMeCallCount()).toBeGreaterThan(callsBefore);
  });

  it('a successful cycle reset (archive + new cycle) on the OWN dashboard triggers a refreshUser() call', async () => {
    setupGetMock({ 1: makeBundle() });
    vi.mocked(api.post).mockResolvedValue({ id: 2, name: 'New', current_week: 1 });

    const { result } = renderHook(() => useDashboard(1), { wrapper });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const callsBefore = authMeCallCount();

    await act(async () => {
      await result.current.resetCycle('New cycle');
    });

    expect(authMeCallCount()).toBeGreaterThan(callsBefore);
  });

  it('a FAILED completion toggle never triggers refreshUser, and the original error still propagates', async () => {
    setupGetMock({ 1: makeBundle() });
    vi.mocked(api.post).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDashboard(1), { wrapper });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const callsBefore = authMeCallCount();

    await expect(
      act(async () => {
        await result.current.toggleCompletion(10, 1, 0, true);
      })
    ).rejects.toThrow('boom');

    expect(authMeCallCount()).toBe(callsBefore); // no refresh after a failed mutation
  });

  it('a mutation on a dashboard pointed at a DIFFERENT (partner) user id never triggers refreshUser', async () => {
    setupGetMock({ 1: makeBundle(), 2: makeBundle({ access: 'partner' }) });
    vi.mocked(api.post).mockResolvedValue(undefined);

    // authUser.id is 1, but this dashboard instance targets userId 2 (a partner) — read-only
    // in practice (server-enforced), but even if invoked it must never refresh the viewer's
    // own streak, since it's not their own data.
    const { result } = renderHook(() => useDashboard(2), { wrapper });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const callsBefore = authMeCallCount();

    await act(async () => {
      await result.current.toggleCompletion(10, 1, 0, true);
    });

    expect(authMeCallCount()).toBe(callsBefore);
  });
});
