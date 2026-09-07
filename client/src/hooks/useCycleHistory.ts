import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { CycleHistoryDetailResponse, CycleHistoryListResponse } from '../lib/types';

export function useCycleHistory(userId: number | null) {
  const [state, setState] = useState<{
    userId: number | null;
    list: CycleHistoryListResponse | null;
    loading: boolean;
    error: string | null;
  }>({ userId, list: null, loading: userId !== null, error: null });
  const sequence = useRef(0);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;

  const reload = useCallback(async () => {
    const requestId = ++sequence.current;
    setState({ userId, list: null, loading: userId !== null, error: null });
    if (userId === null) return;
    try {
      const data = await api.get<CycleHistoryListResponse>(`/cycles/${userId}`);
      if (requestId !== sequence.current || userId !== currentUserId.current) return;
      setState({ userId, list: data, loading: false, error: null });
    } catch (e) {
      if (requestId !== sequence.current || userId !== currentUserId.current) return;
      setState({ userId, list: null, loading: false, error: e instanceof ApiError ? e.message : 'שגיאה בטעינת היסטוריית המחזורים' });
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  const current = state.userId === userId ? state : { list: null, loading: userId !== null, error: null };
  return { list: current.list, loading: current.loading, error: current.error, reload };
}

export function useCycleDetail(userId: number | null, cycleId: number | null) {
  const key = `${userId}:${cycleId}`;
  const enabled = userId !== null && cycleId !== null;
  const [state, setState] = useState<{
    key: string;
    detail: CycleHistoryDetailResponse | null;
    loadStatus: 'idle' | 'loading' | 'ready' | 'error';
    loadError: string | null;
  }>({ key, detail: null, loadStatus: enabled ? 'loading' : 'idle', loadError: null });
  const sequence = useRef(0);
  const currentKey = useRef(key);
  currentKey.current = key;

  const reload = useCallback(async () => {
    const requestId = ++sequence.current;
    if (userId === null || cycleId === null) {
      setState({ key, detail: null, loadStatus: 'idle', loadError: null });
      return;
    }
    setState({ key, detail: null, loadStatus: 'loading', loadError: null });
    try {
      const data = await api.get<CycleHistoryDetailResponse>(`/cycles/${userId}/${cycleId}`);
      if (requestId !== sequence.current || key !== currentKey.current) return;
      if (data.cycle.id !== cycleId) throw new Error('Unexpected cycle response');
      setState({ key, detail: data, loadStatus: 'ready', loadError: null });
    } catch (e) {
      if (requestId !== sequence.current || key !== currentKey.current) return;
      setState({
        key, detail: null, loadStatus: 'error',
        loadError: e instanceof ApiError ? e.message : 'שגיאה בטעינת המחזור',
      });
    }
  }, [userId, cycleId, key]);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  const current = state.key === key ? state : {
    detail: null, loadStatus: enabled ? 'loading' as const : 'idle' as const, loadError: null,
  };
  return { detail: current.detail, loadStatus: current.loadStatus, loadError: current.loadError, reload };
}
