import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { createBroostInstanceId, publishBroostChange, subscribeBroostChange } from '../lib/broostBus';
import { translateActive } from '../i18n';

/**
 * Focused types for the BROOST feature, kept local to this hook rather than added to
 * lib/types.ts (following the same convention used by useWeeklyPlanningRitual.ts /
 * useExecutionRecovery.ts).
 */
export interface BroostParticipant {
  id: number;
  /** displayName, falling back to email — never a raw email field. Render this participant's
   *  identity using initials derived from `label` only; never attempt to fetch an avatar
   *  image for a non-self userId (the authenticated avatar route is self-only by design — see
   *  server/src/lib/broosts.ts's loadBroostParticipant doc comment for the full rationale). */
  label: string;
  hasAvatar: boolean;
  avatarVersion: number;
}

export type BroostDirection = 'sent' | 'received';
export type BroostEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface Broost {
  id: number;
  direction: BroostDirection;
  presetKey: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
  emailStatus: BroostEmailStatus;
  emailHasError: boolean;
  /** True only when a currently-'failed' send is still scheduled for an automatic retry —
   *  lets the UI say "will retry automatically" instead of implying a terminal failure. */
  emailWillRetry: boolean;
  sender: BroostParticipant;
  recipient: BroostParticipant;
}

export interface BroostPreset {
  key: string;
  message: string;
}

export interface SendBroostInput {
  presetKey?: string;
  customMessage?: string;
}

export const MAX_CUSTOM_MESSAGE_LENGTH = 500;

export type BroostLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Never polls faster than this, regardless of what a caller requests — this app deliberately
 *  has no real-time push infrastructure (websockets/SSE); a modest floor keeps polling from
 *  ever becoming an accidental DoS-on-yourself. */
const MIN_POLL_INTERVAL_MS = 60_000;

/**
 * Lightweight unread-count + recent-preview feed for a TopBar badge/popover. Refreshes on
 * mount, on the browser window regaining focus, via modest polling (never faster than 60s),
 * and whenever any *other* BROOST hook instance publishes a change (e.g. a read-action taken
 * from the BROOST page itself) — every subscription (focus listener, interval, bus) is
 * cleaned up on unmount. This is the entire "real-time-ish" strategy for this app: no
 * websockets/SSE, just cheap periodic + event-driven refresh while the tab is actually being
 * used. A monotonic per-call request sequence number guards against an out-of-order response
 * (e.g. a slow poll resolving after a newer focus-triggered reload already landed) ever
 * overwriting fresher state.
 */
export function useBroostUnread(pollIntervalMs: number = MIN_POLL_INTERVAL_MS) {
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<Broost[]>([]);
  const [loadStatus, setLoadStatus] = useState<BroostLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const requestSeqRef = useRef(0);
  const instanceIdRef = useRef(createBroostInstanceId());

  const reload = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    if (!hasDataRef.current) setLoadStatus('loading');
    try {
      const data = await api.get<{ count: number; recent: Broost[] }>('/broosts/unread');
      if (seq !== requestSeqRef.current) return; // a newer request has since started; discard
      setCount(data.count);
      setRecent(data.recent);
      hasDataRef.current = true;
      setLoadStatus('ready');
      setLoadError(null);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.broostAlerts'));
      setLoadStatus('error');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  useEffect(() => {
    const effectiveInterval = Math.max(pollIntervalMs, MIN_POLL_INTERVAL_MS);
    const id = window.setInterval(reload, effectiveInterval);
    return () => window.clearInterval(id);
  }, [reload, pollIntervalMs]);

  // A mutation performed elsewhere (e.g. marking one read from the BROOST page's history)
  // should refresh this badge too — but this instance's *own* mutations below already call
  // `reload()` directly, so its own publish is ignored here to avoid a redundant double fetch.
  useEffect(() => {
    return subscribeBroostChange((sourceId) => {
      if (sourceId === instanceIdRef.current) return;
      reload();
    });
  }, [reload]);

  const markRead = useCallback(
    async (id: number) => {
      const updated = await api.post<Broost>(`/broosts/${id}/read`);
      await reload();
      publishBroostChange(instanceIdRef.current);
      return updated;
    },
    [reload]
  );

  const markAllRead = useCallback(async () => {
    const result = await api.post<{ updated: number }>('/broosts/read-all');
    await reload();
    publishBroostChange(instanceIdRef.current);
    return result;
  }, [reload]);

  const reply = useCallback(async (replyToBroostId: number, customMessage: string) => {
    const sent = await api.post<Broost>('/broosts', { replyToBroostId, customMessage });
    publishBroostChange(instanceIdRef.current);
    return sent;
  }, []);

  return { count, recent, loadStatus, loadError, reload, markRead, markAllRead, reply };
}

/** Loads the shared preset catalog once (see GET /api/broosts/presets) — the client never
 *  hardcodes its own duplicate copy of the preset text. */
export function useBroostPresets() {
  const [presets, setPresets] = useState<BroostPreset[]>([]);
  const [loadStatus, setLoadStatus] = useState<BroostLoadStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ presets: BroostPreset[] }>('/broosts/presets')
      .then((data) => {
        if (!cancelled) {
          setPresets(data.presets);
          setLoadStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { presets, loadStatus };
}

const DEFAULT_HISTORY_LIMIT = 20;

/** Merges a freshly-fetched "top window" (offset 0, newest-first) into the existing
 *  accumulated item list: every item present in the fresh window is replaced with its latest
 *  server state and ordered exactly as the fresh window says (newest-first); anything
 *  previously loaded further down via `loadMore` that isn't part of this window is preserved,
 *  appended after it, untouched. Never snaps an already-scrolled-down view back to a single
 *  short page. */
function mergeRefreshedTop(existing: Broost[], freshTop: Broost[]): Broost[] {
  const freshIds = new Set(freshTop.map((item) => item.id));
  const remainder = existing.filter((item) => !freshIds.has(item.id));
  return [...freshTop, ...remainder];
}

/** Appends an older page fetched via `loadMore`, de-duplicating by id (defensive — in the
 *  normal case there is no overlap, but a concurrent top-refresh could in principle have
 *  already pulled in an item this page also contains). */
function dedupeAppend(existing: Broost[], incoming: Broost[]): Broost[] {
  const seen = new Set(existing.map((item) => item.id));
  const toAppend = incoming.filter((item) => !seen.has(item.id));
  return [...existing, ...toAppend];
}

/**
 * Loads (and mutates) the caller's own combined sent+received BROOST history, paginated.
 * Refreshes on mount, on window focus, and whenever any *other* BROOST hook instance
 * publishes a change (e.g. the TopBar bell marking something read) — every such refresh
 * re-fetches only the "top window" covering everything already loaded and merges it in
 * (see mergeRefreshedTop), so it never discards items the user already scrolled down to via
 * `loadMore`. `loadMore` itself always appends (de-duplicated), never replaces. A monotonic
 * request-sequence guard discards any response that resolves after a newer request has
 * already started, so out-of-order network responses can never overwrite fresher state.
 */
export function useBroostHistory(limit: number = DEFAULT_HISTORY_LIMIT) {
  const [items, setItems] = useState<Broost[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadStatus, setLoadStatus] = useState<BroostLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const offsetRef = useRef(0);
  const requestSeqRef = useRef(0);
  const instanceIdRef = useRef(createBroostInstanceId());

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  /** Re-fetches the top window (offset 0, sized to cover every sequential page already
   *  loaded via loadMore) and merges it in. Used for the initial load, focus refresh, a
   *  foreign BROOST-bus change, and after a successful send/mark-all-read. */
  const refreshTop = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    if (!hasDataRef.current) setLoadStatus('loading');
    const topLimit = offsetRef.current + limit;
    try {
      const data = await api.get<{ items: Broost[]; total: number; limit: number; offset: number }>(
        `/broosts/history?limit=${topLimit}&offset=0`
      );
      if (seq !== requestSeqRef.current) return; // a newer request has since started; discard
      setItems((prev) => mergeRefreshedTop(prev, data.items));
      setTotal(data.total);
      hasDataRef.current = true;
      setLoadStatus('ready');
      setLoadError(null);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.broostHistory'));
      setLoadStatus('error');
    }
  }, [limit]);

  useEffect(() => {
    refreshTop();
  }, [refreshTop]);

  useEffect(() => {
    const onFocus = () => refreshTop();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTop]);

  // A mutation performed elsewhere (e.g. the TopBar bell marking one read) should refresh
  // this page's history too — but this instance's own mutations below already refresh
  // directly, so its own publish is ignored here to avoid a redundant double fetch.
  useEffect(() => {
    return subscribeBroostChange((sourceId) => {
      if (sourceId === instanceIdRef.current) return;
      refreshTop();
    });
  }, [refreshTop]);

  const send = useCallback(
    async (input: SendBroostInput) => {
      const broost = await api.post<Broost>('/broosts', input);
      await refreshTop();
      publishBroostChange(instanceIdRef.current);
      return broost;
    },
    [refreshTop]
  );

  const markRead = useCallback(async (id: number) => {
    const updated = await api.post<Broost>(`/broosts/${id}/read`);
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    publishBroostChange(instanceIdRef.current);
    return updated;
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await api.post<{ updated: number }>('/broosts/read-all');
    await refreshTop();
    publishBroostChange(instanceIdRef.current);
    return result;
  }, [refreshTop]);

  const hasMore = items.length < total;
  const loadMore = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const nextOffset = offsetRef.current + limit;
    try {
      const data = await api.get<{ items: Broost[]; total: number; limit: number; offset: number }>(
        `/broosts/history?limit=${limit}&offset=${nextOffset}`
      );
      if (seq !== requestSeqRef.current) return; // a newer request has since started; discard
      setItems((prev) => dedupeAppend(prev, data.items));
      setTotal(data.total);
      setOffset(nextOffset);
      setLoadStatus('ready');
      setLoadError(null);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.broostHistory'));
      setLoadStatus('error');
    }
  }, [limit]);

  return {
    items,
    total,
    offset,
    limit,
    hasMore,
    loadStatus,
    loadError,
    reload: refreshTop,
    send,
    markRead,
    markAllRead,
    loadMore,
  };
}
