import { isScheduled, type TacticWithCompletions } from './scoring.js';
import { israelWeekday } from './israelTime.js';

/**
 * Pure execution-risk calculator for a single (already in-progress) cycle week — no DB access,
 * fully deterministic given its inputs, and reused as-is by the route (server/src/routes/
 * executionRecovery.ts) and directly by tests. Reuses `isScheduled` from scoring.ts so
 * per-week tactic overrides are respected identically to every other scoring computation in
 * the app — this file never re-implements that logic.
 *
 * Product rule (see README): from Wednesday onward in Israel time, the owner's active-cycle
 * current week is flagged "at risk" if either:
 *   (a) the completion rate of actions *due* (scheduled on today's Israel weekday or earlier
 *       this week, Sunday=0 first) is below 65%, or
 *   (b) even completing every remaining *not-yet-due* scheduled action this week could not
 *       reach the 85% target score (a due-but-undone action is treated as a permanent miss
 *       for this best-case calculation — it already can't un-happen).
 * The flag never fires Sunday-Tuesday, regardless of the underlying numbers (returned here so
 * callers/tests can see what the math *would* say, decoupled from whether it's eligible to
 * actually trigger yet).
 */

export const DUE_COMPLETION_RISK_THRESHOLD = 65;
export const MAX_ACHIEVABLE_RISK_THRESHOLD = 85;

/** Israel weekday (0=Sunday..6=Saturday) values on which the flag is allowed to trigger —
 *  Wednesday through Saturday. Sunday/Monday/Tuesday (0/1/2) never trigger, no matter what
 *  the underlying due-completion/maximum-achievable math says. */
const ELIGIBLE_WEEKDAYS = new Set([3, 4, 5, 6]);

export type ExecutionRiskReason = 'due_completion_below_threshold' | 'maximum_achievable_below_target';

export interface ExecutionRiskAssessment {
  week: number;
  /** Israel weekday (0=Sunday..6=Saturday) for the instant this was assessed at. */
  israelWeekday: number;
  /** True only Wednesday-Saturday Israel time — see ELIGIBLE_WEEKDAYS above. */
  eligibleToTrigger: boolean;
  /** Scheduled occurrences on days that have already ended this week — Sunday through
   *  yesterday. Today is deliberately excluded: see `assessExecutionRisk`. */
  dueScheduled: number;
  /** Of `dueScheduled`, how many already have a `done=1` completion. */
  dueCompleted: number;
  /** `dueCompleted / dueScheduled * 100`, rounded, for **display only** — null when
   *  `dueScheduled` is 0 (nothing has come due yet this week, so a completion rate is
   *  meaningless, not zero). The `due_completion_below_threshold` reason below is decided
   *  from the exact (unrounded) fraction, not from this rounded value — see the function
   *  doc comment for why. */
  dueCompletionRate: number | null;
  /** Every scheduled occurrence this week, due or not. */
  totalScheduled: number;
  /** `totalScheduled - dueScheduled` — occurrences scheduled for today or later this week,
   *  which are still there for the taking rather than missed. */
  remainingScheduled: number;
  /** Best case final week score if every remaining (not-yet-due) occurrence were completed,
   *  while every already-due-but-undone occurrence stays a miss (it cannot retroactively
   *  become done): `(dueCompleted + remainingScheduled) / totalScheduled * 100`, rounded, for
   *  **display only** — null when `totalScheduled` is 0 (nothing scheduled at all this week).
   *  The `maximum_achievable_below_target` reason below is decided from the exact (unrounded)
   *  fraction, not from this rounded value. */
  maximumAchievableScore: number | null;
  /** Every reason the underlying numbers indicate risk, independent of `eligibleToTrigger`. */
  reasons: ExecutionRiskReason[];
  /** `eligibleToTrigger && reasons.length > 0` — the actual "should the UI flag this" signal. */
  triggered: boolean;
}

/**
 * Assesses one cycle week's execution risk as of `now`. `tactics` must already reflect
 * per-week overrides (the same `TacticWithCompletions` shape `computeWeekScores` in
 * scoring.ts consumes) and completions for every tactic passed in.
 *
 * The two `reasons` below are decided using exact integer cross-multiplication against each
 * threshold (`a/b < t/100` tested as `a * 100 < t * b`, never `a/b*100` rounded first) —
 * *never* by comparing the rounded `dueCompletionRate`/`maximumAchievableScore` display
 * values. Rounding before comparing would be a real bug: e.g. 323/500 = 64.6%, which rounds
 * to a *displayed* 65% (looking like it just clears the 65% bar), yet the true rate is still
 * below it and must still trigger; conversely a true 85.0% must never trigger merely because
 * of how some other fraction happens to round. Comparing the exact fraction — via integer
 * multiplication only, no floating-point division at all — sidesteps both the rounding *and*
 * any floating-point-precision concerns entirely.
 */
export function assessExecutionRisk(
  tactics: TacticWithCompletions[],
  week: number,
  now: Date
): ExecutionRiskAssessment {
  const todayIsraelWeekday = israelWeekday(now);

  let totalScheduled = 0;
  let dueScheduled = 0;
  let dueCompleted = 0;

  for (const tactic of tactics) {
    const doneWeekdays = new Set(
      tactic.completions.filter((c) => c.done && c.week === week).map((c) => c.weekday)
    );
    for (let weekday = 0; weekday <= 6; weekday++) {
      if (!isScheduled(tactic, week, weekday)) continue;
      totalScheduled += 1;
      // Strictly before today: a day only counts against you once it is actually over.
      // Including today would mark everything planned for it as already missed from the
      // moment midnight passes — someone who has done every single thing so far would open
      // the app just after midnight and be told they are behind, which is both wrong and
      // exactly the kind of thing that makes people stop trusting the number.
      if (weekday < todayIsraelWeekday) {
        dueScheduled += 1;
        if (doneWeekdays.has(weekday)) dueCompleted += 1;
      }
    }
  }

  const remainingScheduled = totalScheduled - dueScheduled;
  const dueCompletionRate = dueScheduled === 0 ? null : Math.round((dueCompleted / dueScheduled) * 100);
  const maximumAchievableScore =
    totalScheduled === 0 ? null : Math.round(((dueCompleted + remainingScheduled) / totalScheduled) * 100);

  const reasons: ExecutionRiskReason[] = [];
  // Exact cross-multiplication: dueCompleted/dueScheduled < 65/100, without ever rounding or
  // dividing — see the function doc comment above for why this must not use the rounded
  // dueCompletionRate instead.
  if (dueScheduled > 0 && dueCompleted * 100 < DUE_COMPLETION_RISK_THRESHOLD * dueScheduled) {
    reasons.push('due_completion_below_threshold');
  }
  // Exact cross-multiplication: (dueCompleted + remainingScheduled)/totalScheduled < 85/100.
  if (
    totalScheduled > 0 &&
    (dueCompleted + remainingScheduled) * 100 < MAX_ACHIEVABLE_RISK_THRESHOLD * totalScheduled
  ) {
    reasons.push('maximum_achievable_below_target');
  }

  const eligibleToTrigger = ELIGIBLE_WEEKDAYS.has(todayIsraelWeekday);

  return {
    week,
    israelWeekday: todayIsraelWeekday,
    eligibleToTrigger,
    dueScheduled,
    dueCompleted,
    dueCompletionRate,
    totalScheduled,
    remainingScheduled,
    maximumAchievableScore,
    reasons,
    triggered: eligibleToTrigger && reasons.length > 0,
  };
}
