/**
 * Scoring rules for the 12-Week Year dashboard.
 *
 * For a given week, a tactic is "scheduled" on a weekday if that weekday is in its
 * weekday set AND the week falls within [start_week, end_week] for the tactic.
 * A scheduled occurrence is "completed" if a completions row exists with done=1.
 *
 * Week score = completed / scheduled * 100, rounded to nearest integer.
 * A week with zero scheduled occurrences has no score (null) and is excluded from
 * averages by callers.
 */

export const TARGET_SCORE = 85;
export const TOTAL_WEEKS = 12;

export interface TacticLike {
  weekdays: number[]; // 0=Sunday..6=Saturday
  startWeek: number;
  endWeek: number;
  overrides?: { week: number; weekdays: number[] }[];
}

export interface CompletionLike {
  week: number;
  weekday: number;
  done: boolean;
  /** Whether this occurrence has a tactic-evidence record (see migration
   *  015_tactic_evidence.sql) — optional/purely additive; scoring itself never depends on
   *  it. Populated by cycleBundle.ts so the client can show a compact indicator without a
   *  second round trip. */
  hasEvidence?: boolean;
}

export interface TacticWithCompletions extends TacticLike {
  id: number;
  completions: CompletionLike[];
}

export function isScheduled(tactic: TacticLike, week: number, weekday: number): boolean {
  const weekdays = tactic.overrides?.find((override) => override.week === week)?.weekdays ?? tactic.weekdays;
  return week >= tactic.startWeek && week <= tactic.endWeek && weekdays.includes(weekday);
}

export interface WeekScore {
  week: number;
  scheduled: number;
  completed: number;
  score: number | null; // null when nothing was scheduled that week
}

/**
 * Computes per-week scheduled/completed counts and score across one or more tactics.
 * Completions are matched per-tactic (by tactic id) so identical weekday/week combos on
 * different tactics never cross-contaminate each other's completion state.
 */
export function computeWeekScores(
  tactics: TacticWithCompletions[],
  totalWeeks: number = TOTAL_WEEKS
): WeekScore[] {
  const results: WeekScore[] = [];
  for (let week = 1; week <= totalWeeks; week++) {
    let scheduled = 0;
    let completed = 0;
    for (const tactic of tactics) {
      const doneWeekdays = new Set(
        tactic.completions.filter((c) => c.done && c.week === week).map((c) => c.weekday)
      );
      for (let weekday = 0; weekday <= 6; weekday++) {
        if (isScheduled(tactic, week, weekday)) {
          scheduled++;
          if (doneWeekdays.has(weekday)) completed++;
        }
      }
    }
    results.push({
      week,
      scheduled,
      completed,
      score: scheduled === 0 ? null : Math.round((completed / scheduled) * 100),
    });
  }
  return results;
}

export function remainingToTarget(score: number | null): number {
  if (score === null) return TARGET_SCORE;
  return Math.max(0, TARGET_SCORE - score);
}

export function isGoldWeek(score: number | null): boolean {
  return score !== null && score >= TARGET_SCORE;
}

/** Average across weeks that had at least one scheduled occurrence. Null if none did. */
export function averageScore(weekScores: WeekScore[]): number | null {
  const withScore = weekScores.filter((w) => w.score !== null) as (WeekScore & { score: number })[];
  if (withScore.length === 0) return null;
  const sum = withScore.reduce((acc, w) => acc + w.score, 0);
  return Math.round((sum / withScore.length) * 10) / 10;
}
