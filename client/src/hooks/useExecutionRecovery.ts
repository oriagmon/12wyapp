import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Focused types for the execution recovery feature, kept local to this hook rather than
 * added to lib/types.ts (following the same convention used by useWeeklyPlanningRitual.ts).
 */
export type RecoveryStrategy = 'reduce_next_week' | 'maneuver';
export type RecoveryPlanStatus = 'active' | 'resolved';
export type ExecutionRiskReason = 'due_completion_below_threshold' | 'maximum_achievable_below_target';
export type RecoveryAccess = 'owner' | 'partner';

export interface ExecutionRiskAssessment {
  week: number;
  israelWeekday: number;
  eligibleToTrigger: boolean;
  dueScheduled: number;
  dueCompleted: number;
  dueCompletionRate: number | null;
  totalScheduled: number;
  remainingScheduled: number;
  maximumAchievableScore: number | null;
  reasons: ExecutionRiskReason[];
  triggered: boolean;
}

export interface TacticAdjustmentSnapshotEntry {
  tacticId: number;
  weekdays: number[];
}

export interface ReduceNextWeekAdjustment {
  targetWeek: number;
  before: TacticAdjustmentSnapshotEntry[];
  after: TacticAdjustmentSnapshotEntry[];
}

export interface ExecutionRecoveryPlan {
  id: number;
  cycleId: number;
  week: number;
  strategy: RecoveryStrategy;
  note: string;
  status: RecoveryPlanStatus;
  adjustment: ReduceNextWeekAdjustment | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ReduceNextWeekInput {
  note?: string;
  tactics: { tacticId: number; weekdays: number[] }[];
}

export type RecoveryLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RecoveryResponse {
  access: RecoveryAccess;
  cycle: { id: number; week: number } | null;
  risk: ExecutionRiskAssessment | null;
  plan: ExecutionRecoveryPlan | null;
}

/** PUT/reduce-next-week/resolve/reopen always return the plan for the caller's own request —
 *  always the owner, since every mutation is owner-only. */
interface RecoveryMutationResponse {
  access: 'owner';
  plan: ExecutionRecoveryPlan;
}

/**
 * Loads (and mutates) the execution recovery risk/plan for one user's active-cycle current
 * week. Pass `userId: null` to keep the hook idle without fetching anything.
 *
 * `refreshSignal` is an optional extra effect dependency — pass a value that changes (e.g. the
 * dashboard bundle's object reference) whenever something *else* might have changed the risk
 * picture (a completion toggle, a tactic edit, a current-week change), so the risk card stays
 * current without this hook needing to know about any of those mutations directly. Every such
 * background refresh is **non-destructive**: `loadStatus` only ever flips to `'loading'` for
 * the very first fetch of a given `userId` (mirroring useDashboard.ts's own `hasDataRef`
 * pattern) — a background refresh triggered by `refreshSignal` never flips `loadStatus` back
 * to `'loading'`, so a component rendering `null`/a spinner while `loading` never unmounts
 * (and destroys an in-progress typed note or reduction-editor selection) just because some
 * unrelated dashboard mutation happened to fire a refresh. A stale `loadError` from an earlier
 * failed attempt is also cleared the moment a later refresh succeeds.
 *
 * `onReduced` (optional) is called after a *successful* `reduceNextWeek()` — pass e.g. the
 * dashboard's own `reload` so week N+1 views immediately reflect the new overrides. Never
 * called when `reduceNextWeek()` throws.
 */
export function useExecutionRecovery(
  userId: number | null,
  refreshSignal?: unknown,
  onReduced?: () => unknown | Promise<unknown>
) {
  const [access, setAccess] = useState<RecoveryAccess | null>(null);
  const [cycle, setCycle] = useState<{ id: number; week: number } | null>(null);
  const [risk, setRisk] = useState<ExecutionRiskAssessment | null>(null);
  const [plan, setPlan] = useState<ExecutionRecoveryPlan | null>(null);
  const [loadStatus, setLoadStatus] = useState<RecoveryLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Tracks, across renders, whether the *current* userId has ever loaded successfully —
  // deliberately not reset by a `refreshSignal` change, only by `userId` itself changing (see
  // reload() below), so a background refresh never re-triggers the initial loading state.
  const hasDataRef = useRef(false);
  const lastUserIdRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (userId === null) {
      lastUserIdRef.current = null;
      hasDataRef.current = false;
      setLoadStatus('idle');
      setAccess(null);
      setCycle(null);
      setRisk(null);
      setPlan(null);
      return;
    }
    if (lastUserIdRef.current !== userId) {
      // Switched to a different target user (or this is the very first load) — that user's
      // data has never been fetched yet, so this one legitimately needs the loading state.
      lastUserIdRef.current = userId;
      hasDataRef.current = false;
    }
    if (!hasDataRef.current) setLoadStatus('loading');
    try {
      const data = await api.get<RecoveryResponse>(`/execution-recovery/${userId}`);
      setAccess(data.access);
      setCycle(data.cycle);
      setRisk(data.risk);
      setPlan(data.plan);
      hasDataRef.current = true;
      setLoadStatus('ready');
      setLoadError(null); // clear any stale error from an earlier failed attempt
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'שגיאה בטעינת תוכנית החילוץ');
      setLoadStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshSignal deliberately
    // triggers a reload without reload() itself needing to depend on it.
  }, [reload, refreshSignal]);

  const saveManeuver = useCallback(
    async (note: string) => {
      if (userId === null) throw new Error('אין משתמש זמין');
      const data = await api.put<RecoveryMutationResponse>(`/execution-recovery/${userId}`, { note });
      setPlan(data.plan);
      return data.plan;
    },
    [userId]
  );

  const reduceNextWeek = useCallback(
    async (input: ReduceNextWeekInput) => {
      if (userId === null) throw new Error('אין משתמש זמין');
      const data = await api.post<RecoveryMutationResponse>(`/execution-recovery/${userId}/reduce-next-week`, input);
      setPlan(data.plan);
      // Only reached on success — a thrown error above (network/validation) skips this
      // entirely, so onReduced (e.g. the dashboard's own reload) never fires on failure.
      if (onReduced) await onReduced();
      return data.plan;
    },
    [userId, onReduced]
  );

  const resolve = useCallback(async () => {
    if (userId === null) throw new Error('אין משתמש זמין');
    const data = await api.post<RecoveryMutationResponse>(`/execution-recovery/${userId}/resolve`);
    setPlan(data.plan);
    return data.plan;
  }, [userId]);

  const reopen = useCallback(async () => {
    if (userId === null) throw new Error('אין משתמש זמין');
    const data = await api.post<RecoveryMutationResponse>(`/execution-recovery/${userId}/reopen`);
    setPlan(data.plan);
    return data.plan;
  }, [userId]);

  return { access, cycle, risk, plan, loadStatus, loadError, reload, saveManeuver, reduceNextWeek, resolve, reopen };
}
