import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBroostUnread, useBroostHistory, useBroostPresets, type Broost } from '../hooks/useBroosts';
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
  vi.useRealTimers();
});

const SAMPLE_BROOST = {
  id: 1,
  direction: 'received' as const,
  presetKey: 'great_job',
  message: 'כל הכבוד!',
  createdAt: '2026-01-01T00:00:00.000Z',
  readAt: null,
  isRead: false,
  emailStatus: 'sent' as const,
  emailHasError: false,
  emailWillRetry: false,
  sender: { id: 2, label: 'שותף', hasAvatar: false, avatarVersion: 0 },
  recipient: { id: 1, label: 'אני', hasAvatar: false, avatarVersion: 0 },
};

function sampleBroost(overrides: Partial<Broost> = {}): Broost {
  return { ...SAMPLE_BROOST, ...overrides };
}

describe('useBroostUnread', () => {
  it('loads the unread count + recent preview on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [SAMPLE_BROOST] });
    const { result } = renderHook(() => useBroostUnread());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.count).toBe(1);
    expect(result.current.recent).toEqual([SAMPLE_BROOST]);
    expect(api.get).toHaveBeenCalledWith('/broosts/unread');
  });

  it('refreshes on window focus', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    renderHook(() => useBroostUnread());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('polls no faster than every 60 seconds, and cleans up the interval + focus listener on unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useBroostUnread());

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(59_000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(1); // not yet — under 60s

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(2); // now past 60s

    unmount();
    const focusRemoved = removeEventListenerSpy.mock.calls.some((call) => call[0] === 'focus');
    expect(focusRemoved).toBe(true);

    // No further polling after unmount, even if a lot of time passes.
    const callsBeforeAdvance = vi.mocked(api.get).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(callsBeforeAdvance);
  });

  it('markRead calls the API then refreshes', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [SAMPLE_BROOST] });
    vi.mocked(api.post).mockResolvedValue({ ...SAMPLE_BROOST, isRead: true, readAt: '2026-01-01T00:01:00.000Z' });
    const { result } = renderHook(() => useBroostUnread());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    vi.mocked(api.get).mockResolvedValue({ count: 0, recent: [] });
    await act(async () => {
      await result.current.markRead(1);
    });
    expect(api.post).toHaveBeenCalledWith('/broosts/1/read');
    expect(result.current.count).toBe(0);
  });

  it('surfaces a load error rather than throwing', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBroostUnread());
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBeTruthy();
  });

  it('replies to a specific notification, updates other history listeners, and does not mark it read', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/broosts/unread') return { count: 1, recent: [SAMPLE_BROOST] };
      if (path === '/broosts/history?limit=20&offset=0') return { items: [], total: 0 };
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue(sampleBroost({ id: 2, direction: 'sent' }));
    const unread = renderHook(() => useBroostUnread());
    const history = renderHook(() => useBroostHistory());
    await waitFor(() => expect(unread.result.current.loadStatus).toBe('ready'));
    await waitFor(() => expect(history.result.current.loadStatus).toBe('ready'));
    vi.mocked(api.get).mockClear();
    await act(async () => { await unread.result.current.reply(1, 'תודה'); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/broosts', { replyToBroostId: 1, customMessage: 'תודה' });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/broosts/history?limit=20&offset=0');
    expect(unread.result.current.count).toBe(1);
  });

  it('propagates a rejected reply without publishing a successful change', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 1, recent: [SAMPLE_BROOST] });
    vi.mocked(api.post).mockRejectedValue(new Error('reply rejected'));
    const { result } = renderHook(() => useBroostUnread());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    vi.mocked(api.get).mockClear();
    await expect(result.current.reply(1, 'תודה')).rejects.toThrow('reply rejected');
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('useBroostPresets', () => {
  it('loads the shared preset catalog', async () => {
    vi.mocked(api.get).mockResolvedValue({ presets: [{ key: 'great_job', message: 'כל הכבוד!' }] });
    const { result } = renderHook(() => useBroostPresets());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.presets).toEqual([{ key: 'great_job', message: 'כל הכבוד!' }]);
  });
});

describe('useBroostHistory', () => {
  it('loads the first page on mount and exposes pagination state', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [SAMPLE_BROOST], total: 1, limit: 20, offset: 0 });
    const { result } = renderHook(() => useBroostHistory());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.items).toEqual([SAMPLE_BROOST]);
    expect(result.current.hasMore).toBe(false);
  });

  it('send() posts to the API and reloads from the first page', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    const { result } = renderHook(() => useBroostHistory());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    vi.mocked(api.post).mockResolvedValue({ ...SAMPLE_BROOST, direction: 'sent' });
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...SAMPLE_BROOST, direction: 'sent' }], total: 1, limit: 20, offset: 0 });
    await act(async () => {
      await result.current.send({ presetKey: 'great_job' });
    });
    expect(api.post).toHaveBeenCalledWith('/broosts', { presetKey: 'great_job' });
    expect(result.current.items[0].direction).toBe('sent');
  });

  it('loadMore() requests the next page using the offset+limit', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [SAMPLE_BROOST], total: 25, limit: 20, offset: 0 });
    const { result } = renderHook(() => useBroostHistory(20));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.hasMore).toBe(true);

    vi.mocked(api.get).mockResolvedValue({ items: [SAMPLE_BROOST], total: 25, limit: 20, offset: 20 });
    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/broosts/history?limit=20&offset=20'));
  });

  it('loadMore() appends and de-duplicates older items rather than replacing the current page', async () => {
    const page1 = sampleBroost({ id: 1 });
    vi.mocked(api.get).mockResolvedValue({ items: [page1], total: 3, limit: 1, offset: 0 });
    const { result } = renderHook(() => useBroostHistory(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.items.map((i) => i.id)).toEqual([1]);

    const page2 = sampleBroost({ id: 2 });
    vi.mocked(api.get).mockResolvedValue({ items: [page2], total: 3, limit: 1, offset: 1 });
    await act(async () => {
      await result.current.loadMore();
    });
    // Both page-1 and page-2 items must now be present — loadMore appended, it did not
    // replace what was already loaded.
    expect(result.current.items.map((i) => i.id)).toEqual([1, 2]);

    // A repeated fetch of the exact same page (dedupe safety net) must not create a duplicate.
    vi.mocked(api.get).mockResolvedValue({ items: [page2], total: 3, limit: 1, offset: 1 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items.filter((i) => i.id === 2)).toHaveLength(1);
  });

  it('a focus-triggered refresh merges fresh newest items into the top while retaining older items already loaded via loadMore (never snaps back to page 1)', async () => {
    const older = sampleBroost({ id: 1 });
    vi.mocked(api.get).mockResolvedValue({ items: [older], total: 2, limit: 1, offset: 0 });
    const { result } = renderHook(() => useBroostHistory(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    const evenOlder = sampleBroost({ id: 2 });
    vi.mocked(api.get).mockResolvedValue({ items: [evenOlder], total: 2, limit: 1, offset: 1 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 2]);

    // A brand-new BROOST (id 3) arrived and now sits above the previously-newest one (id 1)
    // in the top window — the focus refresh must merge it in at the top while item 2
    // (loaded only via loadMore, outside the refreshed window) remains untouched.
    const brandNew = sampleBroost({ id: 3 });
    vi.mocked(api.get).mockResolvedValue({ items: [brandNew, older], total: 3, limit: 2, offset: 0 });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([3, 1, 2]));
  });

  it('discards an out-of-order (stale) response: a slow request resolving after a newer one must not overwrite the newer state', async () => {
    let resolveSlow: (value: { items: Broost[]; total: number; limit: number; offset: number }) => void = () => {};
    const slow = new Promise<{ items: Broost[]; total: number; limit: number; offset: number }>((resolve) => {
      resolveSlow = resolve;
    });
    vi.mocked(api.get).mockReturnValueOnce(slow);
    const { result } = renderHook(() => useBroostHistory());
    // Initial mount request is now in flight but unresolved ("slow").

    const fast = sampleBroost({ id: 99 });
    vi.mocked(api.get).mockResolvedValueOnce({ items: [fast], total: 1, limit: 20, offset: 0 });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.items.map((i) => i.id)).toEqual([99]);

    // Now the original slow mount request finally resolves — since a newer request (the
    // explicit reload() above) has since started, this stale response must be ignored.
    await act(async () => {
      resolveSlow({ items: [sampleBroost({ id: 1 })], total: 1, limit: 20, offset: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.items.map((i) => i.id)).toEqual([99]);
  });

  it('cross-component synchronization: marking a BROOST read in one hook instance refreshes another mounted instance via the shared bus, without double-fetching the instance that acted', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/broosts/history')) return { items: [SAMPLE_BROOST], total: 1, limit: 20, offset: 0 };
      return { count: 1, recent: [SAMPLE_BROOST] };
    });
    const unreadHook = renderHook(() => useBroostUnread());
    await waitFor(() => expect(unreadHook.result.current.loadStatus).toBe('ready'));
    const historyHook = renderHook(() => useBroostHistory());
    await waitFor(() => expect(historyHook.result.current.loadStatus).toBe('ready'));

    const callsBeforeMarkRead = vi.mocked(api.get).mock.calls.length;
    vi.mocked(api.post).mockResolvedValue({ ...SAMPLE_BROOST, isRead: true, readAt: '2026-01-01T00:01:00.000Z' });
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/broosts/history')) return { items: [], total: 0, limit: 20, offset: 0 };
      return { count: 0, recent: [] };
    });
    await act(async () => {
      await unreadHook.result.current.markRead(1);
    });

    // The acting hook (unreadHook) reloads exactly once for its own action; the *other*
    // mounted hook (historyHook) must ALSO refresh once via the bus — never twice, and never
    // zero times.
    const callsAfter = vi.mocked(api.get).mock.calls.length;
    expect(callsAfter).toBe(callsBeforeMarkRead + 2);

    unreadHook.unmount();
    historyHook.unmount();
  });
});
