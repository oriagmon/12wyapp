/**
 * Advances a cycle's `current_week` from the calendar, instead of waiting for somebody to
 * click the arrow in the dashboard header.
 *
 * ## Why this exists
 *
 * `cycles.current_week` is the app's *only* clock. The duo streak, the celebration
 * scoreboard, week-score finalization and the end-of-week recap email all ask "which weeks
 * are finished?", and the only honest answer the schema can give is "the ones below
 * `current_week`" -- `completions` are keyed by `(tactic_id, week, weekday)` with no dates
 * at all, so there is nothing else to compare against.
 *
 * That made the manual arrow a single point of failure: a cycle left on week 1 reports zero
 * finished weeks forever, so the streak never counts, the scoreboard stays empty and the
 * recap never sends -- no matter how well the week actually went.
 *
 * ## Recompute, never increment
 *
 * The week is always derived fresh from `cycles.started_on` rather than stepped by one.
 * A `+1` on a timer would make the clock stateful: a worker outage, a paused VM or two runs
 * in the same week would permanently skew a cycle, and nothing would ever pull it back.
 * Recomputing makes the anchor the single source of truth, so a missed run is a no-op that
 * self-heals on the next tick, and running the worker ten times in a row is identical to
 * running it once.
 *
 * ## Sunday-anchored, Israel-local
 *
 * Both the anchor and "today" are collapsed to their Sunday via `israelWeekStart` before
 * being subtracted, so the difference is always an exact multiple of 7 days. Doing the
 * arithmetic on week *starts* rather than raw dates means a DST transition, a partial first
 * day, or the time of day a cycle happened to be created can never move the boundary: the
 * week turns over at Israel-local Saturday midnight, exactly when a fresh week of tactics
 * begins in the 0=Sun..6=Sat grid used everywhere else.
 *
 * ## Never runs backwards
 *
 * Only forward moves are applied. `current_week` is frequently set by hand -- stepping back
 * to review an earlier week is a normal thing to do in the UI -- and a worker that "fixed"
 * that would fight the user and yank the dashboard out from under them mid-session. The
 * cap at 12 is likewise deliberate: a finished cycle stops at week 12 and waits for a human
 * to wrap it up, rather than being auto-retired by a background job.
 */
import type Database from 'better-sqlite3';
import { israelWeekStart } from './israelTime.js';
import { finalizeClosedWeekScores, type FinalizedReview } from './weekScoreFinalization.js';

/** Weeks in a 12 Week Year cycle, matching the `current_week BETWEEN 1 AND 12` CHECK. */
export const CYCLE_WEEKS = 12;

const MS_PER_DAY = 86_400_000;

export type CycleAnchor = {
  cycleId: number;
  userId: number;
  startedOn: string;
};

export type CycleWeekAdvance = {
  cycleId: number;
  userId: number;
  startedOn: string;
  previousWeek: number;
  newWeek: number;
  finalizedScores: FinalizedReview[];
};

/** Parses a `YYYY-MM-DD` calendar date as a UTC instant. Anchoring to UTC (rather than
 *  `new Date('YYYY-MM-DD')` semantics or a local-time constructor) keeps day subtraction
 *  free of any offset from the server process's own timezone. */
function parseIsoDateUtc(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

/** Collapses an already-resolved calendar date to the Sunday that starts its week.
 *
 *  Anchors are *written* as Sundays (`israelWeekStart`), but this normalises on read so the
 *  Sunday-boundary rule holds even for a row hand-edited to a mid-week date. Without it a
 *  Wednesday anchor would make weeks turn over on Wednesdays for that one cycle, silently
 *  desynchronising it from the Sun..Sat `completions` grid the scores are computed from. */
function sundayOfUtcMs(ms: number): number {
  return ms - new Date(ms).getUTCDay() * MS_PER_DAY;
}

/**
 * The cycle week that `now` falls in for a cycle anchored at `startedOn`, clamped to 1..12.
 *
 * Both sides are collapsed to their Sunday before subtracting, so the difference is always an
 * exact multiple of 7 days and the boundary can only ever fall at Israel-local Saturday
 * midnight.
 *
 * Returns `null` for an unparseable anchor rather than guessing, so a corrupt row is left
 * alone by the worker instead of having a wrong week written over a correct one.
 */
export function computeCycleWeek(startedOn: string, now: Date = new Date()): number | null {
  const parsedAnchor = parseIsoDateUtc(startedOn);
  if (parsedAnchor === null) return null;
  const parsedNow = parseIsoDateUtc(israelWeekStart(now));
  if (parsedNow === null) return null;

  const anchor = sundayOfUtcMs(parsedAnchor);
  const weeksElapsed = Math.floor((parsedNow - anchor) / MS_PER_DAY / 7);
  if (weeksElapsed < 0) return 1;
  return Math.min(weeksElapsed + 1, CYCLE_WEEKS);
}

/**
 * Gives every active cycle that still has no anchor one, chosen so that its **current week
 * does not change**.
 *
 * The obvious implementation — anchor to the Sunday of the week the cycle was created in —
 * is wrong for any cycle that predates this feature. Until now `current_week` only moved
 * when somebody clicked the arrow, so a cycle can easily be sitting on week 1 having been
 * created a month ago, with *every* completion filed under week 1. Anchoring from
 * `created_at` would jump it several weeks forward and retroactively declare the weeks in
 * between finished — but those weeks contain no completions, because the work was all
 * recorded against week 1. The result would be phantom 0% weeks frozen into the duo streak
 * and mailed out in the recap, dragging down an average that was never actually missed.
 *
 * Anchoring backwards from the week the cycle is *already* on instead means adopting the
 * calendar is a no-op on the day it happens: nobody's week number moves, nothing is
 * retroactively scored, and from the next Sunday onwards the clock simply runs by itself.
 */
export function anchorUnanchoredCycles(db: Database.Database, now: Date = new Date()): CycleAnchor[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, current_week
         FROM cycles
        WHERE is_active = 1 AND started_on IS NULL`
    )
    .all() as { id: number; user_id: number; current_week: number }[];

  const anchored: CycleAnchor[] = [];
  const update = db.prepare('UPDATE cycles SET started_on = ? WHERE id = ? AND started_on IS NULL');
  const thisWeekSunday = parseIsoDateUtc(israelWeekStart(now));

  const run = db.transaction(() => {
    for (const row of rows) {
      if (thisWeekSunday === null) continue;
      const weeksBack = Math.max(0, row.current_week - 1);
      const startedOn = new Date(thisWeekSunday - weeksBack * 7 * MS_PER_DAY).toISOString().slice(0, 10);
      const result = update.run(startedOn, row.id);
      if (result.changes > 0) {
        anchored.push({ cycleId: row.id, userId: row.user_id, startedOn });
      }
    }
  });
  run();

  return anchored;
}

/**
 * Moves every anchored active cycle forward to the week the calendar says it is in.
 *
 * Each advance also runs {@link finalizeClosedWeekScores} for that user, because advancing
 * the week is exactly the moment a week becomes final: any WAM review still holding a
 * provisional mid-week score for a now-closed week has to be recomputed and frozen here, or
 * a meeting held on Friday would keep its half-finished reading forever. This mirrors what
 * `PATCH /api/cycle` already does when the arrow is clicked by hand.
 */
export function advanceDueCycleWeeks(db: Database.Database, now: Date = new Date()): CycleWeekAdvance[] {
  anchorUnanchoredCycles(db, now);

  const rows = db
    .prepare(
      `SELECT id, user_id, current_week, started_on
         FROM cycles
        WHERE is_active = 1 AND started_on IS NOT NULL`
    )
    .all() as { id: number; user_id: number; current_week: number; started_on: string }[];

  const advances: CycleWeekAdvance[] = [];

  for (const row of rows) {
    const target = computeCycleWeek(row.started_on, now);
    if (target === null || target <= row.current_week) continue;

    const result = db
      .prepare(
        `UPDATE cycles
            SET current_week = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND current_week = ?`
      )
      .run(target, row.id, row.current_week);
    if (result.changes === 0) continue;

    advances.push({
      cycleId: row.id,
      userId: row.user_id,
      startedOn: row.started_on,
      previousWeek: row.current_week,
      newWeek: target,
      finalizedScores: finalizeClosedWeekScores(db, row.user_id),
    });
  }

  return advances;
}
