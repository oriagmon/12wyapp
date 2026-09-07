import type Database from 'better-sqlite3';
import {
  getAllCyclesForUser,
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
} from './repo.js';
import { computeWeekScores, TARGET_SCORE, type TacticWithCompletions } from './scoring.js';

/**
 * Computes the user's personal "success streak": the number of consecutive *finished* weeks
 * (across all of the user's cycles, oldest to newest) whose score is >= TARGET_SCORE (85),
 * counting backward from the most recently finished week. Never persists or duplicates score
 * data — everything here is derived on read from the same goals/tactics/completions/overrides
 * used by the dashboard, via the same computeWeekScores used everywhere else.
 *
 * "Finished" weeks:
 *  - Active cycle: weeks 1..current_week-1 (the current week is still in progress and must
 *    never affect the streak either way).
 *  - Archived cycle: weeks 1..current_week (by definition, an archived cycle is over — its
 *    last-recorded current_week counts as finished too).
 *
 * Cycles are traversed in chronological order (oldest first) so the streak can continue
 * across an archive boundary into the next cycle. A null score (nothing was ever scheduled
 * that week) or a score below the target immediately breaks/ends the streak.
 */
export function computeSuccessStreak(db: Database.Database, userId: number): number {
  // getAllCyclesForUser returns newest-first (for history browsing); reverse to chronological.
  const cycles = getAllCyclesForUser(db, userId).slice().reverse();

  const finishedScores: (number | null)[] = [];
  for (const cycle of cycles) {
    const goalRows = getGoalsForCycle(db, cycle.id);
    const goalIds = goalRows.map((g) => g.id);
    const tacticRows = getTacticsForGoals(db, goalIds);
    const tacticIds = tacticRows.map((t) => t.id);
    const overrideRows = getTacticOverrides(db, tacticIds);
    const completionRows = getCompletionsForTactics(db, tacticIds);

    const tactics: TacticWithCompletions[] = tacticRows.map((t) => ({
      id: t.id,
      weekdays: JSON.parse(t.weekdays) as number[],
      startWeek: t.start_week,
      endWeek: t.end_week,
      overrides: overrideRows
        .filter((o) => o.tactic_id === t.id)
        .map((o) => ({ week: o.week, weekdays: JSON.parse(o.weekdays) as number[] })),
      completions: completionRows
        .filter((c) => c.tactic_id === t.id)
        .map((c) => ({ week: c.week, weekday: c.weekday, done: c.done === 1 })),
    }));

    const weekScores = computeWeekScores(tactics);
    // Archiving a cycle (via "סיום מחזור") is an explicit, user-driven action that finalizes
    // whatever current_week it was on at that moment — that week is therefore always counted
    // as finished for an archived cycle, unlike an active cycle's current week, which is still
    // ongoing and deliberately excluded.
    const finishedThroughWeek = cycle.is_active === 1 ? cycle.current_week - 1 : cycle.current_week;
    for (let week = 1; week <= finishedThroughWeek; week++) {
      const found = weekScores.find((w) => w.week === week);
      finishedScores.push(found ? found.score : null);
    }
  }

  let streak = 0;
  for (let i = finishedScores.length - 1; i >= 0; i--) {
    const score = finishedScores[i];
    if (score === null || score < TARGET_SCORE) break;
    streak++;
  }
  return streak;
}
