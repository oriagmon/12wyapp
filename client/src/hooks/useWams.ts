import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { CommitmentScope, WamCompleteResult, WamDetail, WamListResponse, WamSummary } from '../lib/types';
import { translateActive } from '../i18n';

export function useWamList() {
  const [data, setData] = useState<WamListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<WamListResponse>('/wams');
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : translateActive('common.load.wams'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const startMeeting = useCallback(
    async (week: number) => {
      const wam = await api.post<WamDetail>('/wams', { week });
      await reload();
      return wam;
    },
    [reload]
  );

  const search = useCallback(async (q: string): Promise<WamSummary[]> => {
    if (q.trim().length === 0) return [];
    const res = await api.get<{ results: WamSummary[] }>(`/wams/search?q=${encodeURIComponent(q)}`);
    return res.results;
  }, []);

  return { data, loading, error, reload, startMeeting, search };
}

export function useWamDetail(wamId: number | null) {
  const [wam, setWam] = useState<WamDetail | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  // The current `wamId`, readable from inside a queued mutation's async closure without
  // itself being a dependency that would recreate every mutation callback on every render.
  const wamIdRef = useRef(wamId);
  wamIdRef.current = wamId;

  // A strict FIFO queue: every detail mutation (content/rating/completion/commitments/
  // punishments/due-toggle) is chained onto this single promise so at most one is ever
  // in flight at a time. This is what actually prevents a stale response from a rapid
  // earlier call from overwriting a newer call's result — if the server could otherwise
  // process/answer two overlapping requests out of order, queuing means there is never a
  // *second* in-flight request for the queue to reorder against in the first place. A
  // rejected mutation still lets the queue continue (the `.catch` below only swallows the
  // rejection for queue-continuation purposes — the original caller still sees the real
  // rejection via the returned promise itself).
  const mutationQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const loadSequenceRef = useRef(0);

  const enqueueMutation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = mutationQueueRef.current.then(task, task);
    mutationQueueRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }, []);

  // Only ever applies a mutation's fetched WamDetail if the hook is still pointed at that
  // same WAM — guards against the rare case where the user navigated to a different WAM
  // while a previously-enqueued mutation for the old one was still resolving. Also safely
  // ignores `undefined`/`null` — a defensive no-op, not an error — so it stays decoupled from
  // any particular endpoint's response shape (e.g. a hypothetical no-body 204 delete) rather
  // than assuming every caller always resolves a full WamDetail.
  const applyIfCurrent = useCallback((data: WamDetail | null | undefined) => {
    if (data && data.id === wamIdRef.current) setWam(data);
  }, []);

  const reload = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    if (wamId === null) return;
    try {
      const data = await api.get<WamDetail>(`/wams/${wamId}`);
      if (sequence !== loadSequenceRef.current || wamId !== wamIdRef.current) return;
      applyIfCurrent(data);
      setLoadError(null);
      setLoadStatus('ready');
    } catch (e) {
      if (sequence !== loadSequenceRef.current || wamId !== wamIdRef.current) return;
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.wam'));
      setLoadStatus('error');
    }
  }, [wamId, applyIfCurrent]);

  useEffect(() => {
    setWam(null);
    setLoadError(null);
    setLoadStatus('loading');
    reload();
    return () => { loadSequenceRef.current += 1; };
  }, [reload]);

  const updateContent = useCallback(
    (patch: Partial<{ wins: string; misses: string; blockers: string; lessonsLearned: string; notes: string; adjustmentNotes: string }>) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.patch<WamDetail>(`/wams/${wamId}`, patch);
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const setRating = useCallback(
    (rating: number) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.patch<WamDetail>(`/wams/${wamId}/rating`, { rating });
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const scheduleNextWam = useCallback(
    (schedule: { nextWamAt: string; nextWamDurationMinutes?: number }) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        if (wamId !== wamIdRef.current) return undefined;
        try {
          // Invitation-only: never POST /complete, so this can never freeze a draft's
          // scores, emit a completion celebration, or re-complete a finished meeting.
          const res = await api.put<{ wam: WamDetail }>(`/wams/${wamId}/next-wam`, schedule);
          applyIfCurrent(res.wam);
          return { ...res, celebration: null };
        } catch (error) {
          if (wamId === wamIdRef.current) {
            // Partial delivery persists before returning 502. Refresh its per-recipient
            // statuses without hiding the original error or resending any invitation.
            try { applyIfCurrent(await api.get<WamDetail>(`/wams/${wamId}`)); } catch { /* Keep the delivery error. */ }
          }
          throw error;
        }
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const complete = useCallback(
    (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        if (wamId !== wamIdRef.current) return undefined;
        try {
          // The panel's completed-WAM action is invitation-only. Keep the existing
          // callback wiring, but never POST /complete again or replay its celebration.
          if (wam?.status === 'complete') {
            if (!schedule) throw new Error(translateActive('common.guard.noSchedule'));
            const res = await api.put<{ wam: WamDetail }>(`/wams/${wamId}/next-wam`, schedule);
            applyIfCurrent(res.wam);
            return { ...res, celebration: null };
          }
          const res = await api.post<WamCompleteResult>(`/wams/${wamId}/complete`, schedule ?? {});
          applyIfCurrent(res.wam);
          return res;
        } catch (error) {
          if (schedule && wamId === wamIdRef.current) {
            // Partial delivery persists before returning 502. Refresh its per-recipient
            // statuses without hiding the original error or resending any invitation.
            try { applyIfCurrent(await api.get<WamDetail>(`/wams/${wamId}`)); } catch { /* Keep the delivery error. */ }
          }
          throw error;
        }
      }),
    [wamId, wam?.status, enqueueMutation, applyIfCurrent]
  );

  const reopen = useCallback(
    () =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.post<WamDetail>(`/wams/${wamId}/reopen`);
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const addCommitment = useCallback(
    (label: string, scope: CommitmentScope) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const res = await api.post<{ commitmentId: number; wam: WamDetail }>(`/wams/${wamId}/commitments`, {
          label,
          scope,
        });
        applyIfCurrent(res.wam);
        return res.wam;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const updateCommitment = useCallback(
    (commitmentId: number, patch: Partial<{ label: string; scope: CommitmentScope; done: boolean }>) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.patch<WamDetail>(`/wams/${wamId}/commitments/${commitmentId}`, patch);
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const deleteCommitment = useCallback(
    (commitmentId: number) =>
      enqueueMutation(async () => {
        if (wamId === null) return;
        await api.delete(`/wams/${wamId}/commitments/${commitmentId}`);
        await reload();
      }),
    [wamId, enqueueMutation, reload]
  );

  const addPunishment = useCallback(
    (label: string, assignedUserId: number) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const res = await api.post<{ punishmentId: number; wam: WamDetail }>(`/wams/${wamId}/punishments`, {
          label,
          assignedUserId,
        });
        applyIfCurrent(res.wam);
        return res.wam;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const updatePunishment = useCallback(
    (punishmentId: number, patch: Partial<{ label: string; assignedUserId: number }>) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.patch<WamDetail>(`/wams/${wamId}/punishments/${punishmentId}`, patch);
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const deletePunishment = useCallback(
    (punishmentId: number) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.delete<WamDetail>(`/wams/${wamId}/punishments/${punishmentId}`);
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  const toggleDuePunishment = useCallback(
    (punishmentId: number, done: boolean) =>
      enqueueMutation(async () => {
        if (wamId === null) return undefined;
        const data = await api.patch<WamDetail>(`/wams/${wamId}/due-punishments/${punishmentId}`, { done });
        applyIfCurrent(data);
        return data;
      }),
    [wamId, enqueueMutation, applyIfCurrent]
  );

  return {
    wam,
    loadStatus,
    loadError,
    reload,
    updateContent,
    setRating,
    complete,
    scheduleNextWam,
    reopen,
    addCommitment,
    updateCommitment,
    deleteCommitment,
    addPunishment,
    updatePunishment,
    deletePunishment,
    toggleDuePunishment,
  };
}
