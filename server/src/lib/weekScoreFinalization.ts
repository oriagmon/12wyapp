/**
 * Turns a provisionally-frozen WAM week score into a final one.
 *
 * Why this exists
 * ---------------
 * `POST /wams/:id/complete` freezes `wam_reviews.score_snapshot` at the instant the meeting
 * is completed. That is only correct if the meeting happens after the reviewed week has
 * ended. These meetings are actually held on Friday or Saturday morning, so the frozen
 * number routinely captured a week with two days still unticked — and since
 * `DUO_STREAK_THRESHOLD` is 85, a Friday meeting could not clear the bar even when both
 * partners went on to finish the week at 100%. The streak silently never counted, and the
 * celebration scoreboard never fired.
 *
 * When is a week "over"?
 * ----------------------
 * There is no calendar answer available. Cycles have no start date (`001_init.sql`) and
 * completions are keyed by `(tactic_id, week, weekday)` with no date at all
 * (`lib/scoring.ts`), while `cycles.current_week` is advanced by hand. So the only honest
 * definition the schema supports is:
 *
 *     week N is over for a person once THEIR OWN cycle has moved past it (current_week > N)
 *
 * That is deliberately per-person, evaluated against the cycle the review is actually scored
 * against — the two partners are frequently on different weeks, and each one's meeting review
 * must finalize on their own timeline, not their partner's.
 *
 * Immutability
 * ------------
 * Freezing a score is still a one-way door; this does not reopen it. `score_finalized_at`
 * records the single moment a review crossed from provisional to final, and an already-final
 * review is never recomputed again — so later tactic edits still cannot rewrite history. All
 * this changes is *which* reading gets frozen: the week's final score instead of an
 * arbitrary mid-week one.
 */
import type Database from 'better-sqlite3';
import { computeCycleWeekScore } from './wam.js';

export interface FinalizedReview {
  wamId: number;
  userId: number;
  week: number;
  previousScore: number | null;
  finalScore: number | null;
}

interface PendingReviewRow {
  wam_id: number;
  user_id: number;
  week: number;
  cycle_id: number | null;
  score_snapshot: number | null;
  current_week: number;
}

/**
 * Every completed review whose reviewed week has closed but which is still carrying a
 * provisional score.
 *
 * Only `status = 'complete'` meetings are considered: a draft has never frozen a score in the
 * first place (`score_snapshot` is NULL and stays that way until completion), so there is
 * nothing to finalize and stamping one would wrongly mark it done.
 *
 * The cycle each review is scored against is chosen by which side of the partnership the user
 * sits on, mirroring exactly how `complete` picked the cycle when it first froze the number.
 */
function pendingReviews(db: Database.Database, userId: number | null): PendingReviewRow[] {
  return db
    .prepare(
      `SELECT r.wam_id, r.user_id, w.week, r.score_snapshot,
              CASE WHEN p.initiator_id = r.user_id THEN w.initiator_cycle_id ELSE w.invitee_cycle_id END AS cycle_id,
              c.current_week
         FROM wam_reviews r
         JOIN wams w ON w.id = r.wam_id
         JOIN partnerships p ON p.id = w.partnership_id
         JOIN cycles c ON c.id = CASE WHEN p.initiator_id = r.user_id
                                      THEN w.initiator_cycle_id ELSE w.invitee_cycle_id END
        WHERE r.score_finalized_at IS NULL
          AND w.status = 'complete'
          AND c.current_week > w.week
          AND (? IS NULL OR r.user_id = ?)`
    )
    .all(userId, userId) as PendingReviewRow[];
}

/**
 * Re-freezes and stamps every review of `userId` (or of everyone, when null) whose week has
 * closed. Safe to call repeatedly — a review is only ever picked up while it is still
 * provisional, so a second call is a no-op.
 *
 * Returns what actually changed, so callers (the backfill script in particular) can show a
 * real before/after diff rather than asking the operator to trust it.
 */
export function finalizeClosedWeekScores(
  db: Database.Database,
  userId: number | null = null
): FinalizedReview[] {
  const pending = pendingReviews(db, userId);
  if (pending.length === 0) return [];

  const update = db.prepare(
    `UPDATE wam_reviews
        SET score_snapshot = ?,
            score_finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE wam_id = ? AND user_id = ? AND score_finalized_at IS NULL`
  );

  return db.transaction(() => {
    const changed: FinalizedReview[] = [];
    for (const row of pending) {
      const finalScore = computeCycleWeekScore(db, row.cycle_id, row.week).score;
      update.run(finalScore, row.wam_id, row.user_id);
      changed.push({
        wamId: row.wam_id,
        userId: row.user_id,
        week: row.week,
        previousScore: row.score_snapshot,
        finalScore,
      });
    }
    return changed;
  })();
}

/**
 * Fire-and-forget wrapper for the request path.
 *
 * Advancing the week is the user's action; finalizing old meeting scores is bookkeeping that
 * happens to be triggered by it. A failure here must never turn a successful week advance
 * into an error response, so it is logged and swallowed. The next advance — or the worker —
 * picks the same rows up again, since nothing was stamped.
 */
export function finalizeClosedWeekScoresQuietly(db: Database.Database, userId: number): void {
  try {
    finalizeClosedWeekScores(db, userId);
  } catch (error) {
    console.error('[week-score-finalization] failed for user', userId, error);
  }
}
