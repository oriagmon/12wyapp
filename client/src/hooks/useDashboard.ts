import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Cycle, DashboardBundle, Goal, GoalColor, Tactic } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { publishSuccess } from '../lib/celebrations';
import { effectiveTacticForWeek, TARGET_SCORE } from '../lib/scoring';
import { translateActive } from '../i18n';

export type LoadStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface DashboardWeekNavigation {
  viewedWeek: number | null;
  onViewedWeekChange: (week: number) => void;
}

export function useDashboard(userId: number | null, navigation?: DashboardWeekNavigation) {
  const { user: authUser, refreshUser } = useAuth();
  // Only the authenticated user's *own* mutations can change their personal success streak —
  // a dashboard instance pointed at a partner's userId (read-only anyway) must never trigger
  // this, per the "avoid refreshing on read-only partner operations" rule.
  const isSelf = authUser !== null && authUser.id === userId;

  const [loadedBundle, setBundle] = useState<DashboardBundle | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<number | null>(userId);
  const bundle = loadedUserId === userId ? loadedBundle : null;
  const [storedLoadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const loadStatus = loadedUserId === userId ? storedLoadStatus : 'loading';
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localViewedWeek, setLocalViewedWeek] = useState<number>(1);
  const viewedWeek = navigation ? navigation.viewedWeek ?? bundle?.cycle?.currentWeek ?? 1 : localViewedWeek;
  const setViewedWeek = useCallback((week: number) => {
    if (!Number.isInteger(week) || week < 1 || week > 12) return;
    if (navigation) {
      if (week !== navigation.viewedWeek) navigation.onViewedWeekChange(week);
    } else setLocalViewedWeek(week);
  }, [navigation?.viewedWeek, navigation?.onViewedWeekChange, Boolean(navigation)]);
  const hasDataRef = useRef(false);
  const targetRef = useRef({ userId, accountId: authUser?.id });
  const identityEpoch = useRef(0);
  if (targetRef.current.userId !== userId || targetRef.current.accountId !== authUser?.id) identityEpoch.current += 1;
  targetRef.current = { userId, accountId: authUser?.id };
  const loadVersion = useRef(0);

  const reload = useCallback(async () => {
    if (userId === null || targetRef.current.userId !== userId) return;
    const version = ++loadVersion.current;
    // Only show the full-page loading state on the very first fetch (or after
    // switching target user). Subsequent reloads triggered by mutations refresh
    // data in place, keeping the dashboard (and its tab selection) mounted.
    if (!hasDataRef.current) {
      setLoadStatus('loading');
    }
    try {
      const data = await api.get<DashboardBundle>(`/dashboard/${userId}`);
      if (version !== loadVersion.current || targetRef.current.userId !== userId) return;
      setBundle(data);
      setLoadedUserId(userId);
      setLoadError(null);
      hasDataRef.current = true;
      setLocalViewedWeek((prev) => {
        if (data.cycle && prev >= 1 && prev <= 12) return prev;
        return data.cycle?.currentWeek ?? 1;
      });
      setLoadStatus(data.cycle ? 'ready' : 'empty');
      return data;
    } catch (e) {
      if (version !== loadVersion.current || targetRef.current.userId !== userId) return;
      setLoadedUserId(userId);
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.dashboard'));
      setLoadStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    hasDataRef.current = false;
    setBundle(null);
    setLoadError(null);
    setLoadStatus('loading');
    reload();
    return () => { loadVersion.current += 1; identityEpoch.current += 1; };
  }, [reload]);

  const isOwner = bundle?.access === 'owner';

  // --- Mutations (all no-ops thrown as errors if not owner; UI should also disable controls) ---

  const createCycle = useCallback(
    async (name: string) => {
      const cycle = await api.post<{ id: number; name: string; current_week: number }>('/cycle', { name });
      await reload();
      return cycle;
    },
    [reload]
  );

  const updateCycle = useCallback(
    async (
      patch: Partial<
        Pick<
          Cycle,
          | 'name'
          | 'currentWeek'
          | 'vision'
          | 'successDefinition'
          | 'whyItMatters'
          | 'blockers'
          | 'risks'
          | 'lagMeasures'
          | 'leadMeasures'
          | 'notes'
        >
      >
    ) => {
      await api.patch<Cycle>('/cycle', patch);
      await reload();
      // The current-week field is exactly what determines which weeks count as "finished"
      // for the personal success streak — refresh it (own dashboard only) after any cycle
      // update so TopBar/ProfilePage never show a stale number. A failed refresh here is
      // swallowed internally by refreshUser() and never masks/replaces this mutation's own
      // success or failure (already resolved above).
      if (isSelf) await refreshUser();
    },
    [reload, isSelf, refreshUser]
  );

  const resetCycle = useCallback(
    async (name: string) => {
      await api.post('/cycle/reset', { name, confirm: true });
      await reload();
      // Ending/archiving a cycle finalizes its recorded current week as "finished" for streak
      // purposes (see computeSuccessStreak) and starts a fresh week-1 cycle — either way the
      // streak can change, so refresh (own dashboard only).
      if (isSelf) await refreshUser();
    },
    [reload, isSelf, refreshUser]
  );

  const createGoal = useCallback(
    async (title: string, color?: GoalColor) => {
      const goal = await api.post<Goal>('/goals', { title, color });
      await reload();
      return goal;
    },
    [reload]
  );

  const renameGoal = useCallback(
    async (goalId: number, title: string) => {
      await api.patch(`/goals/${goalId}`, { title });
      await reload();
    },
    [reload]
  );

  const deleteGoal = useCallback(
    async (goalId: number) => {
      await api.delete(`/goals/${goalId}`, { confirm: true });
      await reload();
    },
    [reload]
  );

  const createTactic = useCallback(
    async (input: { goalId: number; title: string; weekdays: number[]; startWeek: number; endWeek: number }) => {
      const tactic = await api.post<Tactic>('/tactics', input);
      await reload();
      return tactic;
    },
    [reload]
  );

  const updateTactic = useCallback(
    async (
      tacticId: number,
      patch: Partial<{
        title: string;
        weekdays: number[];
        startWeek: number;
        endWeek: number;
        scope: 'nextWeek' | 'restOfCycle';
      }>
    ) => {
      if (patch.scope) {
        await api.put(`/tactics/${tacticId}/adaptation`, {
          title: patch.title,
          weekdays: patch.weekdays,
          scope: patch.scope,
        });
      } else {
        await api.patch(`/tactics/${tacticId}`, patch);
      }
      await reload();
    },
    [reload]
  );

  /** Drops the upcoming week's one-off adaptation so the tactic returns to its baseline. */
  const resetTacticAdaptation = useCallback(
    async (tacticId: number) => {
      await api.delete(`/tactics/${tacticId}/adaptation`);
      await reload();
    },
    [reload]
  );

  const deleteTactic = useCallback(
    async (tacticId: number) => {
      await api.delete(`/tactics/${tacticId}`);
      await reload();
    },
    [reload]
  );

  const toggleCompletion = useCallback(
    async (tacticId: number, week: number, weekday: number, done: boolean) => {
      const accountId = authUser?.id;
      const epoch = identityEpoch.current;
      const cycleId = bundle?.cycle?.id;
      const tactic = bundle?.goals.flatMap((goal) => goal.tactics).find((item) => item.id === tacticId);
      const previouslyDone = tactic?.completions.some((item) => item.week === week && item.weekday === weekday && item.done);
      const scheduled = tactic && week >= tactic.startWeek && week <= tactic.endWeek &&
        effectiveTacticForWeek(tactic, week).weekdays.includes(weekday);
      const eligible = isSelf && isOwner && done && !previouslyDone && scheduled && cycleId;
      const firstStep = !bundle?.goals.some((goal) => goal.tactics.some((item) => item.completions.length > 0));
      const previousScore = bundle?.weekScores.find((item) => item.week === week)?.score ?? null;
      await api.post('/completions/toggle', { tacticId, week, weekday, done });
      if (identityEpoch.current !== epoch) return;
      const refreshed = await reload();
      if (identityEpoch.current !== epoch) return;
      if (eligible && accountId !== undefined) {
        const nextScore = refreshed?.cycle?.id === cycleId
          ? refreshed.weekScores.find((item) => item.week === week)?.score ?? null : null;
        const milestone = previousScore !== null && previousScore < TARGET_SCORE &&
          nextScore !== null && nextScore >= TARGET_SCORE;
        publishSuccess({
          accountId, owner: true, success: true, completed: true,
          kind: milestone ? 'milestone' : 'completion',
          occurrenceId: milestone
            ? `milestone:${cycleId}:${week}:${crypto.randomUUID()}`
            : `completion:${cycleId}:${tacticId}:${week}:${weekday}`,
          firstStep,
        });
      }
      // A completion toggle directly changes the finished week's score, and thus the
      // personal success streak — refresh it (own dashboard only, never for a read-only
      // partner view). refreshUser() never throws, so it can't mask this mutation's own
      // (already-resolved) success.
      if (isSelf) await refreshUser();
    },
    [reload, isSelf, isOwner, refreshUser, authUser?.id, userId, bundle]
  );

  return {
    bundle,
    loadStatus,
    loadError,
    isOwner,
    viewedWeek,
    setViewedWeek,
    reload,
    createCycle,
    updateCycle,
    resetCycle,
    createGoal,
    renameGoal,
    deleteGoal,
    createTactic,
    updateTactic,
    resetTacticAdaptation,
    deleteTactic,
    toggleCompletion,
  };
}
