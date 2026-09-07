import type Database from 'better-sqlite3';
import {
  getActiveCycle,
  getCycleById,
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
} from './repo.js';
import { computeWeekScores, type TacticWithCompletions } from './scoring.js';

export interface PartnershipInfo {
  id: number;
  initiatorId: number;
  inviteeId: number;
}

/** Returns the caller's single partnership (app enforces max one — see routes/partnerships.ts), if any. */
export function getAcceptedPartnershipForUser(
  db: Database.Database,
  userId: number
): PartnershipInfo | undefined {
  return db
    .prepare(
      `SELECT id, initiator_id as initiatorId, invitee_id as inviteeId
       FROM partnerships
       WHERE initiator_id = ? OR invitee_id = ?
       LIMIT 1`
    )
    .get(userId, userId) as PartnershipInfo | undefined;
}

export function isPartnershipMember(partnership: PartnershipInfo, userId: number): boolean {
  return partnership.initiatorId === userId || partnership.inviteeId === userId;
}

export function otherUserId(partnership: PartnershipInfo, userId: number): number {
  return partnership.initiatorId === userId ? partnership.inviteeId : partnership.initiatorId;
}

/** 'a' = partnership initiator, 'b' = partnership invitee — used to label shared commitments. */
export function scopeForUser(partnership: PartnershipInfo, userId: number): 'a' | 'b' {
  return partnership.initiatorId === userId ? 'a' : 'b';
}

export function userIdForScope(partnership: PartnershipInfo, scope: 'a' | 'b' | 'shared'): number | null {
  if (scope === 'a') return partnership.initiatorId;
  if (scope === 'b') return partnership.inviteeId;
  return null;
}

/** The active cycle id for a user right now, or null if they have none — used to snapshot
 *  which cycle generation each partner is on when a WAM is first created. */
export function currentActiveCycleId(db: Database.Database, userId: number): number | null {
  return getActiveCycle(db, userId)?.id ?? null;
}

/** True only if the given cycle id exists and has since been archived (is_active = 0).
 *  A null cycleId (the user had no cycle at WAM-creation time) is never "archived". */
export function isCycleArchived(db: Database.Database, cycleId: number | null): boolean {
  if (cycleId === null) return false;
  const cycle = getCycleById(db, cycleId);
  return Boolean(cycle) && cycle!.is_active === 0;
}

export interface CycleWeekSnapshot {
  hasCycle: boolean;
  cycleId: number | null;
  cycleName: string | null;
  cycleIsActive: boolean;
  currentWeek: number | null;
  score: number | null;
  scheduled: number;
  completed: number;
}

/**
 * Computes the execution score for an arbitrary week (1-12) within one *specific* cycle
 * (not necessarily the user's currently active one) — WAMs pin each side to the cycle that
 * was active when the meeting was created, so reviewing it later (even after that cycle is
 * archived and a new one started) always reflects the same historical data.
 */
export function computeCycleWeekScore(
  db: Database.Database,
  cycleId: number | null,
  week: number
): CycleWeekSnapshot {
  if (cycleId === null) {
    return {
      hasCycle: false,
      cycleId: null,
      cycleName: null,
      cycleIsActive: false,
      currentWeek: null,
      score: null,
      scheduled: 0,
      completed: 0,
    };
  }
  const cycle = getCycleById(db, cycleId);
  if (!cycle) {
    return {
      hasCycle: false,
      cycleId: null,
      cycleName: null,
      cycleIsActive: false,
      currentWeek: null,
      score: null,
      scheduled: 0,
      completed: 0,
    };
  }

  const goals = getGoalsForCycle(db, cycle.id);
  const tactics = getTacticsForGoals(db, goals.map((g) => g.id));
  const tacticIds = tactics.map((t) => t.id);
  const completions = getCompletionsForTactics(db, tacticIds);
  const overrides = getTacticOverrides(db, tacticIds);

  const withCompletions: TacticWithCompletions[] = tactics.map((t) => ({
    id: t.id,
    weekdays: JSON.parse(t.weekdays) as number[],
    startWeek: t.start_week,
    endWeek: t.end_week,
    overrides: overrides
      .filter((override) => override.tactic_id === t.id)
      .map((override) => ({
        week: override.week,
        weekdays: JSON.parse(override.weekdays) as number[],
      })),
    completions: completions
      .filter((c) => c.tactic_id === t.id)
      .map((c) => ({ week: c.week, weekday: c.weekday, done: c.done === 1 })),
  }));

  const weekScores = computeWeekScores(withCompletions);
  const entry = weekScores.find((w) => w.week === week)!;

  return {
    hasCycle: true,
    cycleId: cycle.id,
    cycleName: cycle.name,
    cycleIsActive: cycle.is_active === 1,
    currentWeek: cycle.current_week,
    score: entry.score,
    scheduled: entry.scheduled,
    completed: entry.completed,
  };
}
