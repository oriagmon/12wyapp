import type Database from 'better-sqlite3';

/**
 * "Duo Streak" — how many *consecutive* completed WAMs in a row both partners scored at
 * least this threshold on their own frozen review snapshot. Deliberately derived on the fly
 * from `wams`/`wam_reviews` alone — no dedicated table. See the module doc comment below for
 * the full semantics and why no persistence is needed.
 */
export const DUO_STREAK_THRESHOLD = 85;

export interface DuoStreakLatestSuccess {
  wamId: number;
  week: number;
  completedAt: string;
  scoreA: number;
  scoreB: number;
}

export interface DuoStreakSummary {
  /** Consecutive successful (both >= threshold) completed WAMs counting backward from the
   *  most recently *completed* WAM in durable creation order — 0 if that WAM itself failed
   *  (or there are no completed WAMs at all yet). */
  currentStreak: number;
  /** The longest such run anywhere in this partnership's completed history. */
  bestStreak: number;
  /** Total count of successful completed WAMs across all history (not just the current run). */
  totalDuoWins: number;
  /** The most recent successful completed WAM, regardless of whether the streak continued
   *  past it (e.g. a later completed WAM may have broken the streak afterward) — or null if
   *  there has never been one. */
  latestDuoSuccess: DuoStreakLatestSuccess | null;
}

interface CompletedWamScoreRow {
  id: number;
  week: number;
  completed_at: string;
  score_a: number | null;
  score_b: number | null;
}

/**
 * ## Semantics
 *
 * A "successful Duo week" is a currently-**complete** WAM whose two frozen
 * `wam_reviews.score_snapshot` values are both non-null and both >= `DUO_STREAK_THRESHOLD`.
 * Live/rounded scores are never used — only the exact frozen integer snapshot written at the
 * moment that specific WAM was completed (see `POST /:id/complete`), so a streak can never be
 * silently changed by later tactic edits, adaptations, or re-scoring of *other* weeks.
 *
 * The sequence considered is **every WAM in this partnership currently in `status = 'complete'`,
 * ordered by WAM id ascending** (WAM ids are monotonic per partnership and durable — the same
 * ID-based ordering convention already used for punishment "next WAM" binding). Draft WAMs
 * (including a currently-reopened one, and a brand-new draft started for the next week) are
 * **excluded from the sequence entirely** rather than treated as failures — so:
 *   - a fresh draft after a successful streak never resets it (there is simply no new row to
 *     consider yet);
 *   - a *reopened* WAM temporarily drops out of the sequence (as if it never happened) until
 *     it is completed again, at which point it re-enters using whatever its *new* frozen
 *     snapshot turns out to be;
 *   - the sequence is stable across skipped week numbers and cycle resets, since it never
 *     references `week` for ordering or gap-detection at all — only WAM creation order.
 *
 * `currentStreak` is the number of trailing consecutive successes in that sequence (0 if the
 * most recent completed WAM itself failed, even if an earlier run existed). `bestStreak` is the
 * longest run anywhere in the sequence. `totalDuoWins` counts every success, not just the
 * current run. `latestDuoSuccess` is the most recent success regardless of any failures after
 * it (so it can be non-null even when `currentStreak` is 0).
 */
export function computeDuoStreak(
  db: Database.Database,
  partnershipId: number,
  initiatorId: number,
  inviteeId: number
): DuoStreakSummary {
  const rows = db
    .prepare(
      `SELECT w.id as id, w.week as week, w.completed_at as completed_at,
              (SELECT score_snapshot FROM wam_reviews WHERE wam_id = w.id AND user_id = ?) as score_a,
              (SELECT score_snapshot FROM wam_reviews WHERE wam_id = w.id AND user_id = ?) as score_b
       FROM wams w
       WHERE w.partnership_id = ? AND w.status = 'complete'
       ORDER BY w.id ASC`
    )
    .all(initiatorId, inviteeId, partnershipId) as CompletedWamScoreRow[];

  let running = 0;
  let best = 0;
  let totalDuoWins = 0;
  let latestDuoSuccess: DuoStreakLatestSuccess | null = null;

  for (const row of rows) {
    const isDuoSuccess =
      row.score_a !== null &&
      row.score_b !== null &&
      row.score_a >= DUO_STREAK_THRESHOLD &&
      row.score_b >= DUO_STREAK_THRESHOLD;
    if (isDuoSuccess) {
      running += 1;
      totalDuoWins += 1;
      latestDuoSuccess = {
        wamId: row.id,
        week: row.week,
        completedAt: row.completed_at,
        scoreA: row.score_a as number,
        scoreB: row.score_b as number,
      };
    } else {
      running = 0;
    }
    if (running > best) best = running;
  }

  return { currentStreak: running, bestStreak: best, totalDuoWins, latestDuoSuccess };
}

/** The strict outcome classification for one specific WAM's pair of frozen scores — shared by
 *  the "Duo Streak" success rule above and the post-completion celebration descriptor, so the
 *  two can never define "success"/"who's ahead" differently. `null` for either score (no cycle,
 *  or no scheduled actions at all that week) always falls back to `'completion'` — there is
 *  nothing meaningful to compare or celebrate specially. Equal scores that both clear the
 *  threshold are `'duo-success'`, never `'tie'` — the pair-success rule takes priority over the
 *  "equal but not celebrating a personal winner" case. */
export function classifyWamOutcome(
  scoreA: number | null,
  scoreB: number | null
): 'duo-success' | 'spotlight-a' | 'spotlight-b' | 'tie' | 'completion' {
  if (scoreA === null || scoreB === null) return 'completion';
  if (scoreA >= DUO_STREAK_THRESHOLD && scoreB >= DUO_STREAK_THRESHOLD) return 'duo-success';
  if (scoreA === scoreB) return 'tie';
  return scoreA > scoreB ? 'spotlight-a' : 'spotlight-b';
}
