import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatIsraelWallTime, israelWallTimeToUtcIso } from '../lib/israelTime';
import type { ExecutionHeatmapResponse } from '../lib/executionHeatmapTypes';
import { translateActive } from '../i18n';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
interface HeatmapState {
  key: string;
  data: ExecutionHeatmapResponse | null;
  loadStatus: LoadStatus;
  loadError: string | null;
}

export function useExecutionHeatmap(userId: number | null, cycleId?: number, refreshKey?: unknown) {
  const key = `${userId}:${cycleId ?? 'active'}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<HeatmapState>({ key, data: null, loadStatus: 'idle', loadError: null });
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (userId === null) {
      setState({ key, data: null, loadStatus: 'idle', loadError: null });
      return;
    }
    let disposed = false;
    setState((previous) => previous.key === key && previous.data
      ? { ...previous, loadError: null }
      : { key, data: null, loadStatus: 'loading', loadError: null });
    const path = `/execution-heatmap/${userId}${cycleId === undefined ? '' : `?cycleId=${cycleId}`}`;
    api.get<ExecutionHeatmapResponse>(path).then((data) => {
      if (!disposed) setState({ key, data, loadStatus: 'ready', loadError: null });
    }).catch((error: unknown) => {
      if (!disposed) setState({
        key, data: null, loadStatus: 'error',
        loadError: error instanceof ApiError ? error.message : translateActive('common.load.heatmap'),
      });
    });
    return () => { disposed = true; };
  }, [key, userId, cycleId, refreshKey, revision]);

  useEffect(() => {
    if (userId === null) return;
    const now = new Date();
    const tomorrow = new Date(`${formatIsraelWallTime(now).slice(0, 10)}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const midnight = israelWallTimeToUtcIso(`${tomorrow.toISOString().slice(0, 10)}T00:00`);
    const timer = midnight === null ? undefined : window.setTimeout(reload, new Date(midnight).getTime() - now.getTime() + 100);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, revision, reload]);

  // A target change must never render even one frame of the previous person's history.
  const visibleState: HeatmapState = state.key === key ? state
    : { key, data: null, loadStatus: userId === null ? 'idle' : 'loading', loadError: null };
  return { ...visibleState, reload };
}
