import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { translateActive } from '../i18n';

/**
 * Focused types for the weekly planning ritual feature, kept local to this hook rather than
 * added to lib/types.ts (which is being edited concurrently for other features).
 */
export type RitualStatus = 'draft' | 'complete';

export interface WeeklyPlanningRitual {
  id: number;
  cycleId: number;
  targetWeek: number;
  workedWell: string;
  improveNext: string;
  tacticsReviewed: boolean;
  weeklyFocus: string;
  commitment: string;
  status: RitualStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyPlanningDraftPatch {
  workedWell?: string;
  improveNext?: string;
  tacticsReviewed?: boolean;
  weeklyFocus?: string;
  commitment?: string;
}

export type RitualLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RitualResponse {
  access: 'owner' | 'partner';
  ritual: WeeklyPlanningRitual | null;
}

/** The PUT/complete/reopen endpoints always return the (now-existing) ritual, never null. */
interface RitualMutationResponse {
  access: 'owner' | 'partner';
  ritual: WeeklyPlanningRitual;
}

interface RitualScope {
  cycleId: number | null;
  targetWeek: number | null;
  readSequence: number;
  mutationSequence: number;
  revision: number;
}

interface RitualState {
  scope: RitualScope;
  ritual: WeeklyPlanningRitual | null;
  access: RitualResponse['access'] | null;
  loadStatus: RitualLoadStatus;
  loadError: string | null;
}

function emptyState(scope: RitualScope): RitualState {
  return {
    scope, ritual: null, access: null, loadError: null,
    loadStatus: scope.cycleId === null || scope.targetWeek === null ? 'idle' : 'loading',
  };
}

/**
 * Loads (and mutates) the weekly planning ritual for one cycle/target-week pair. Pass
 * `cycleId: null` or `targetWeek: null` (e.g. when there's no active cycle, or the cycle is
 * already at week 12 and there is no valid "next week" to plan) to keep the hook idle without
 * fetching anything.
 */
export function useWeeklyPlanningRitual(cycleId: number | null, targetWeek: number | null) {
  const activeScope = useRef<RitualScope>({ cycleId, targetWeek, readSequence: 0, mutationSequence: 0, revision: 0 });
  // Identity changes during render, before effects: even A -> B -> A is a new generation.
  if (activeScope.current.cycleId !== cycleId || activeScope.current.targetWeek !== targetWeek) {
    activeScope.current = { cycleId, targetWeek, readSequence: 0, mutationSequence: 0, revision: 0 };
  }
  const scope = activeScope.current;
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const [state, setState] = useState<RitualState>(() => emptyState(scope));
  const current = state.scope === scope ? state : emptyState(scope);

  const isCurrent = useCallback((generation: number) =>
    mounted.current && activeScope.current === scope &&
    lifetime.current === generation,
  [scope]);

  const reload = useCallback(async () => {
    const sequence = ++scope.readSequence;
    const revision = scope.revision;
    const generation = lifetime.current;
    if (!isCurrent(generation)) return;
    setState(emptyState(scope));
    if (scope.cycleId === null || scope.targetWeek === null) return;
    try {
      const data = await api.get<RitualResponse>(`/weekly-planning/${scope.cycleId}/${scope.targetWeek}`);
      if (!isCurrent(generation) || sequence !== scope.readSequence || revision !== scope.revision) return;
      setState({ scope, ...data, loadStatus: 'ready', loadError: null });
    } catch (e) {
      if (!isCurrent(generation) || sequence !== scope.readSequence || revision !== scope.revision) return;
      setState({
        scope, ritual: null, access: null, loadStatus: 'error',
        loadError: e instanceof ApiError ? e.message : translateActive('common.load.ritual'),
      });
    }
  }, [scope, isCurrent]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      lifetime.current += 1;
    };
  }, [reload]);

  const mutate = useCallback(
    async (action: 'draft' | 'complete' | 'reopen', patch?: WeeklyPlanningDraftPatch) => {
      if (scope.cycleId === null || scope.targetWeek === null) {
        throw new Error(translateActive('common.guard.noTargetWeek'));
      }
      const sequence = ++scope.mutationSequence;
      const generation = lifetime.current;
      const path = `/weekly-planning/${scope.cycleId}/${scope.targetWeek}`;
      // The captured scope remains the request's target even if navigation occurs while saving.
      // Failures still reject unchanged; stale successes resolve without publishing into a new view.
      const data = action === 'draft'
        ? await api.put<RitualMutationResponse>(path, patch)
        : await api.post<RitualMutationResponse>(`${path}/${action}`);
      if (isCurrent(generation) && sequence === scope.mutationSequence) {
        scope.revision += 1;
        setState({ scope, ...data, loadStatus: 'ready', loadError: null });
      }
      return data.ritual;
    },
    [scope, isCurrent]
  );

  const saveDraft = useCallback((patch: WeeklyPlanningDraftPatch) => mutate('draft', patch), [mutate]);
  const complete = useCallback(() => mutate('complete'), [mutate]);
  const reopen = useCallback(() => mutate('reopen'), [mutate]);

  return {
    ritual: current.ritual, access: current.access, loadStatus: current.loadStatus,
    loadError: current.loadError, reload, saveDraft, complete, reopen,
  };
}
