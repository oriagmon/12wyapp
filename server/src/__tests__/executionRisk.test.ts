import { describe, it, expect } from 'vitest';
import { assessExecutionRisk, type ExecutionRiskAssessment } from '../lib/executionRisk.js';
import type { TacticWithCompletions } from '../lib/scoring.js';

// Fixed, deterministic instants (see israelTime.test.ts for why noon UTC on these January
// 2024 dates unambiguously falls on the stated Israel weekday, no DST involved).
const TUESDAY = new Date('2024-01-09T12:00:00Z'); // Israel weekday 2
const WEDNESDAY = new Date('2024-01-10T12:00:00Z'); // Israel weekday 3
const THURSDAY = new Date('2024-01-11T12:00:00Z'); // Israel weekday 4
const SATURDAY = new Date('2024-01-13T12:00:00Z'); // Israel weekday 6
const SUNDAY = new Date('2024-01-07T12:00:00Z'); // Israel weekday 0

/** Builds `count` single-occurrence tactics, each scheduled only on `weekday` for week 1,
 *  with the first `doneCount` of them marked completed — the simplest way to construct an
 *  exact due/total occurrence count without juggling multiple weekdays per tactic. */
function makeTactics(weekday: number, count: number, doneCount: number): TacticWithCompletions[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    weekdays: [weekday],
    startWeek: 1,
    endWeek: 12,
    completions: i < doneCount ? [{ week: 1, weekday, done: true }] : [],
  }));
}

describe('assessExecutionRisk: eligibility window (Sunday-Tuesday never flags, regardless of the math)', () => {
  it('before Wednesday (Tuesday): a due-completion rate of 0% still does not trigger', () => {
    // Scheduled Sun/Mon/Tue (all due by Tuesday), none completed -> 0% due completion, which
    // *would* be well below the 65% threshold — but Tuesday is not an eligible day.
    const tactics: TacticWithCompletions[] = [
      { id: 1, weekdays: [0, 1, 2], startWeek: 1, endWeek: 12, completions: [] },
    ];
    const risk = assessExecutionRisk(tactics, 1, TUESDAY);
    expect(risk.israelWeekday).toBe(2);
    expect(risk.eligibleToTrigger).toBe(false);
    expect(risk.dueCompletionRate).toBe(0);
    expect(risk.reasons).toContain('due_completion_below_threshold');
    expect(risk.triggered).toBe(false); // suppressed purely by ineligible weekday
  });

  it('Sunday never triggers even with maximally bad numbers', () => {
    const tactics = makeTactics(0, 10, 0); // 10 due today (Sunday), none done
    const risk = assessExecutionRisk(tactics, 1, SUNDAY);
    expect(risk.eligibleToTrigger).toBe(false);
    expect(risk.triggered).toBe(false);
  });

  it('Wednesday, Thursday, and Saturday are all eligible', () => {
    const tactics = makeTactics(0, 10, 0);
    expect(assessExecutionRisk(tactics, 1, WEDNESDAY).eligibleToTrigger).toBe(true);
    expect(assessExecutionRisk(tactics, 1, THURSDAY).eligibleToTrigger).toBe(true);
    expect(assessExecutionRisk(tactics, 1, SATURDAY).eligibleToTrigger).toBe(true);
  });
});

describe('assessExecutionRisk: due-completion-rate threshold (65%), exact boundary behavior', () => {
  it('exactly 65% due completion does NOT count as the due-completion reason', () => {
    const tactics = makeTactics(0, 20, 13); // 13/20 = 65.0% exactly, all due (Sunday, by Wed)
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.dueScheduled).toBe(20);
    expect(risk.dueCompleted).toBe(13);
    expect(risk.dueCompletionRate).toBe(65);
    expect(risk.reasons).not.toContain('due_completion_below_threshold');
  });

  it('64% (just below 65%) DOES count as the due-completion reason and triggers on an eligible day', () => {
    const tactics = makeTactics(0, 25, 16); // 16/25 = 64%
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.dueCompletionRate).toBe(64);
    expect(risk.reasons).toContain('due_completion_below_threshold');
    expect(risk.triggered).toBe(true);
  });

  it('due completion rate is null (not zero) when nothing has come due yet this week', () => {
    // Scheduled only on Thursday/Friday/Saturday — none of that is due yet on Wednesday.
    const tactics: TacticWithCompletions[] = [
      { id: 1, weekdays: [4, 5, 6], startWeek: 1, endWeek: 12, completions: [] },
    ];
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.dueScheduled).toBe(0);
    expect(risk.dueCompletionRate).toBeNull();
    expect(risk.reasons).not.toContain('due_completion_below_threshold');
  });
});

describe('assessExecutionRisk: maximum-achievable-score threshold (85%), exact boundary behavior', () => {
  it('exactly 85% maximum achievable does NOT count as the maximum-achievable reason', () => {
    // 17 due (Sunday) occurrences, 14 completed; 3 not-yet-due (Thursday) occurrences.
    // Best case: (14 + 3) / 20 = 85.0% exactly.
    const due = makeTactics(0, 17, 14);
    const notYetDue = makeTactics(4, 3, 0).map((t, i) => ({ ...t, id: 100 + i }));
    const tactics = [...due, ...notYetDue];
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.totalScheduled).toBe(20);
    expect(risk.dueScheduled).toBe(17);
    expect(risk.remainingScheduled).toBe(3);
    expect(risk.maximumAchievableScore).toBe(85);
    expect(risk.reasons).not.toContain('maximum_achievable_below_target');
    expect(risk.triggered).toBe(false);
  });

  it('one fewer completed due action drops the maximum achievable below 85% and triggers', () => {
    const due = makeTactics(0, 17, 13); // one fewer done than the exactly-85 case above
    const notYetDue = makeTactics(4, 3, 0).map((t, i) => ({ ...t, id: 100 + i }));
    const tactics = [...due, ...notYetDue];
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.maximumAchievableScore).toBe(80); // (13 + 3) / 20 = 80%
    expect(risk.reasons).toContain('maximum_achievable_below_target');
    expect(risk.triggered).toBe(true);
  });

  it('a due-but-undone action is treated as a permanent miss, not recoverable, in the maximum-achievable calculation', () => {
    // 10 due (Sunday), 0 completed; nothing else scheduled. Even though nothing remains to
    // complete, the already-missed due actions cap the maximum achievable at 0%.
    const tactics = makeTactics(0, 10, 0);
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.remainingScheduled).toBe(0);
    expect(risk.maximumAchievableScore).toBe(0);
    expect(risk.reasons).toContain('maximum_achievable_below_target');
  });

  it('maximum achievable is null when nothing is scheduled at all this week', () => {
    const tactics: TacticWithCompletions[] = [{ id: 1, weekdays: [0], startWeek: 3, endWeek: 5, completions: [] }];
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY); // week 1 is outside [3,5] -> nothing scheduled
    expect(risk.totalScheduled).toBe(0);
    expect(risk.dueScheduled).toBe(0);
    expect(risk.maximumAchievableScore).toBeNull();
    expect(risk.dueCompletionRate).toBeNull();
    expect(risk.reasons).toEqual([]);
    expect(risk.triggered).toBe(false);
  });
});

describe('assessExecutionRisk: respects per-week tactic overrides via the shared isScheduled()', () => {
  it('an override for the assessed week changes which weekdays count as scheduled', () => {
    // Base schedule: Sunday only. But week 1 has an override switching it to Thursday only.
    const tactics: TacticWithCompletions[] = [
      {
        id: 1,
        weekdays: [0],
        startWeek: 1,
        endWeek: 12,
        overrides: [{ week: 1, weekdays: [4] }],
        completions: [],
      },
    ];
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    // Sunday (base) must NOT count as scheduled for week 1 anymore; Thursday (override) is
    // scheduled but not yet due on Wednesday.
    expect(risk.totalScheduled).toBe(1);
    expect(risk.dueScheduled).toBe(0);
    expect(risk.remainingScheduled).toBe(1);
  });
});

describe('assessExecutionRisk: reasons/fields reported regardless of eligibility (decoupled from triggered)', () => {
  it('returns the full breakdown (dueScheduled/dueCompleted/rate/total/remaining/maxAchievable) together', () => {
    const due = makeTactics(0, 10, 6); // 60% due completion
    const notYetDue = makeTactics(5, 2, 0).map((t, i) => ({ ...t, id: 200 + i }));
    const risk: ExecutionRiskAssessment = assessExecutionRisk([...due, ...notYetDue], 1, THURSDAY);
    expect(risk).toMatchObject({
      week: 1,
      israelWeekday: 4,
      eligibleToTrigger: true,
      dueScheduled: 10,
      dueCompleted: 6,
      dueCompletionRate: 60,
      totalScheduled: 12,
      remainingScheduled: 2,
    });
    expect(risk.maximumAchievableScore).toBe(Math.round(((6 + 2) / 12) * 100));
    expect(risk.reasons.length).toBeGreaterThan(0);
    expect(risk.triggered).toBe(true);
  });
});

describe('assessExecutionRisk: exact cross-multiplication threshold math (never rounds before comparing)', () => {
  it('64.6% due completion (displays as a rounded 65%) still correctly triggers the due-completion reason', () => {
    // 323/500 = 64.6% exactly. Math.round(64.6) = 65, which would incorrectly look like it
    // just cleared the 65% bar if the rounded display value were compared instead of the
    // exact fraction.
    const tactics = makeTactics(0, 500, 323);
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.dueScheduled).toBe(500);
    expect(risk.dueCompleted).toBe(323);
    expect(risk.dueCompletionRate).toBe(65); // rounded display value
    expect(risk.reasons).toContain('due_completion_below_threshold'); // exact 64.6% still < 65%
    expect(risk.triggered).toBe(true);
  });

  it('a true 65.4% due completion (also displays as a rounded 65%) does NOT trigger', () => {
    // 327/500 = 65.4% exactly, rounds to a displayed 65% too — but unlike the 64.6% case
    // above, the true value is already >= 65%, so it must not trigger.
    const tactics = makeTactics(0, 500, 327);
    const risk = assessExecutionRisk(tactics, 1, WEDNESDAY);
    expect(risk.dueCompletionRate).toBe(65);
    expect(risk.reasons).not.toContain('due_completion_below_threshold');
  });

  it('84.5% maximum achievable (displays as a rounded 85%) still correctly triggers the maximum-achievable reason', () => {
    // 131 due (Sunday), 100 completed; 69 not-yet-due (Thursday). Best case:
    // (100 + 69) / 200 = 169/200 = 84.5% exactly. Math.round(84.5) = 85 (JS rounds .5 up),
    // which would incorrectly look like it just cleared the 85% bar if the rounded display
    // value were compared instead of the exact fraction.
    const due = makeTactics(0, 131, 100);
    const notYetDue = makeTactics(4, 69, 0).map((t, i) => ({ ...t, id: 1000 + i }));
    const risk = assessExecutionRisk([...due, ...notYetDue], 1, WEDNESDAY);
    expect(risk.totalScheduled).toBe(200);
    expect(risk.maximumAchievableScore).toBe(85); // rounded display value
    expect(risk.reasons).toContain('maximum_achievable_below_target'); // exact 84.5% still < 85%
    expect(risk.triggered).toBe(true);
  });

  it('a true exact 85.0% maximum achievable does NOT trigger, matching the strict "<" semantics', () => {
    // 17 due (all completed), 3 not-yet-due -> (17 + 3) / 20 = 100%... use a case that lands
    // on exactly 85.0% instead: 17 due (14 completed), 3 not-yet-due -> (14+3)/20 = 85.0%.
    const due = makeTactics(0, 17, 14);
    const notYetDue = makeTactics(4, 3, 0).map((t, i) => ({ ...t, id: 2000 + i }));
    const risk = assessExecutionRisk([...due, ...notYetDue], 1, WEDNESDAY);
    expect(risk.maximumAchievableScore).toBe(85);
    expect(risk.reasons).not.toContain('maximum_achievable_below_target');
    expect(risk.triggered).toBe(false);
  });
});

describe("assessExecutionRisk: today is still in play, so it is not counted as missed", () => {
  // Just after midnight Israel time on Wednesday. 2024-01-09T22:00Z is 00:00 Wednesday in
  // Israel (UTC+2 in January, no DST), i.e. the very start of an eligible day.
  const JUST_AFTER_MIDNIGHT_WEDNESDAY = new Date('2024-01-09T22:34:00Z');

  it('someone who has done everything through Tuesday reads 100% at 00:34 on Wednesday', () => {
    // Sun/Mon/Tue fully done, plus Wednesday work that has not been touched because the day
    // is barely half an hour old. Counting Wednesday as due would report them as behind.
    const tactics: TacticWithCompletions[] = [
      {
        id: 1,
        weekdays: [0, 1, 2, 3],
        startWeek: 1,
        endWeek: 12,
        completions: [
          { week: 1, weekday: 0, done: true },
          { week: 1, weekday: 1, done: true },
          { week: 1, weekday: 2, done: true },
        ],
      },
    ];

    const risk = assessExecutionRisk(tactics, 1, JUST_AFTER_MIDNIGHT_WEDNESDAY);

    expect(risk.israelWeekday).toBe(3);
    expect(risk.dueScheduled).toBe(3); // Sun, Mon, Tue — not Wednesday
    expect(risk.dueCompleted).toBe(3);
    expect(risk.dueCompletionRate).toBe(100);
    expect(risk.reasons).not.toContain('due_completion_below_threshold');
    expect(risk.triggered).toBe(false);
  });

  it("today's untouched work does not drag down the best score still achievable", () => {
    // Everything through Tuesday done; Wednesday's four occurrences are still ahead of them,
    // so a perfect week remains possible and the card must not claim otherwise.
    const tactics: TacticWithCompletions[] = [
      {
        id: 1,
        weekdays: [0, 1, 2],
        startWeek: 1,
        endWeek: 12,
        completions: [
          { week: 1, weekday: 0, done: true },
          { week: 1, weekday: 1, done: true },
          { week: 1, weekday: 2, done: true },
        ],
      },
      { id: 2, weekdays: [3], startWeek: 1, endWeek: 12, completions: [] },
    ];

    const risk = assessExecutionRisk(tactics, 1, JUST_AFTER_MIDNIGHT_WEDNESDAY);

    expect(risk.totalScheduled).toBe(4);
    expect(risk.remainingScheduled).toBe(1); // Wednesday's, still there for the taking
    expect(risk.maximumAchievableScore).toBe(100);
    expect(risk.reasons).not.toContain('maximum_achievable_below_target');
    expect(risk.triggered).toBe(false);
  });

  it('once the day is over, skipping it does count against the week', () => {
    // The same shape as above, assessed a day later: Wednesday has now ended untouched, so
    // the warning it was suppressing legitimately fires.
    const tactics: TacticWithCompletions[] = [
      { id: 1, weekdays: [3], startWeek: 1, endWeek: 12, completions: [] },
    ];

    const risk = assessExecutionRisk(tactics, 1, THURSDAY);

    expect(risk.dueScheduled).toBe(1);
    expect(risk.dueCompleted).toBe(0);
    expect(risk.dueCompletionRate).toBe(0);
    expect(risk.reasons).toContain('due_completion_below_threshold');
    expect(risk.triggered).toBe(true);
  });
});
