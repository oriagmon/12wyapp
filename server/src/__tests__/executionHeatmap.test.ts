import { describe, expect, it } from 'vitest';
import { computeExecutionHeatmap } from '../lib/executionHeatmap.js';
import { computeWeekScores, type TacticWithCompletions } from '../lib/scoring.js';

const CYCLE = { id: 1, name: 'מחזור בדיקה', current_week: 1, is_active: 1, updated_at: '2026-09-02T12:00:00Z' };
const NOW = new Date('2026-09-02T12:00:00Z'); // Wednesday in Israel.

function tactic(overrides: Partial<TacticWithCompletions> = {}): TacticWithCompletions {
  return { id: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], startWeek: 1, endWeek: 12, completions: [], ...overrides };
}

function counts(completed: number, scheduled: number) {
  return Array.from({ length: scheduled }, (_, id) => tactic({
    id, weekdays: [0], endWeek: 1,
    completions: id < completed ? [{ week: 1, weekday: 0, done: true }] : [],
  }));
}

describe('execution heatmap exact scoring', () => {
  it.each([
    [84, 100, 'partial', 84, 3],
    [85, 100, 'success', 85, 4],
    [423, 500, 'partial', 84, 3],
    [17, 20, 'success', 85, 4],
    [100, 100, 'success', 100, 4],
    [1, 10, 'partial', 10, 1],
    [3, 10, 'partial', 30, 2],
    [5, 10, 'partial', 50, 3],
  ])('%i/%i has exact status %s, score %i and intensity %i', (completed, scheduled, state, score, intensity) => {
    const result = computeExecutionHeatmap(CYCLE, counts(completed as number, scheduled as number), NOW);
    expect(result.days[0]).toMatchObject({ completed, scheduled, state, score, intensity });
    expect(result.summary.successfulDays).toBe(state === 'success' ? 1 : 0);
  });

  it('renders 84 empty neutral days, null scores and no fabricated insight', () => {
    const result = computeExecutionHeatmap(CYCLE, [], NOW);
    expect(result.days).toHaveLength(84);
    expect(result.days.every((day) => day.state === 'unscheduled' && day.score === null && day.intensity === 0)).toBe(true);
    expect(result.summary).toEqual({
      currentStreak: 0, bestStreak: 0, successfulDays: 0, completedOccurrences: 0,
      scheduledOccurrences: 0, strongestWeekday: null,
    });
  });

  it('keeps future completions out of intensity, success, streaks and insight', () => {
    const result = computeExecutionHeatmap(CYCLE, [tactic({
      weekdays: [4], completions: [{ week: 1, weekday: 4, done: true }],
    })], NOW);
    expect(result.days[4]).toMatchObject({ state: 'future', phase: 'future', scheduled: 1, completed: 1, intensity: 0 });
    expect(result.summary.completedOccurrences).toBe(0);
    expect(result.summary.successfulDays).toBe(0);
    expect(result.summary.strongestWeekday).toBeNull();
  });

  it('respects effective week windows, empty/moved overrides, undone rows and deduplicated occurrences', () => {
    const tactics = [
      tactic({
        id: 1, weekdays: [0, 1], endWeek: 2,
        overrides: [{ week: 1, weekdays: [2] }, { week: 2, weekdays: [] }],
        completions: [
          { week: 1, weekday: 0, done: true },
          { week: 1, weekday: 2, done: true }, { week: 1, weekday: 2, done: true },
          { week: 2, weekday: 0, done: true },
        ],
      }),
      tactic({ id: 2, weekdays: [2], startWeek: 2, endWeek: 2, completions: [{ week: 1, weekday: 2, done: true }] }),
      tactic({ id: 3, weekdays: [2], endWeek: 1, completions: [{ week: 1, weekday: 2, done: false }] }),
    ];
    const result = computeExecutionHeatmap(CYCLE, tactics, NOW);
    expect(result.days[0]).toMatchObject({ scheduled: 0, completed: 0 });
    expect(result.days[2]).toMatchObject({ scheduled: 2, completed: 1, state: 'partial' });
    expect(result.days[7]).toMatchObject({ scheduled: 0, completed: 0 });
    for (const score of computeWeekScores(tactics)) {
      const days = result.days.filter((day) => day.week === score.week);
      expect(days.reduce((total, day) => total + day.scheduled, 0)).toBe(score.scheduled);
      expect(days.reduce((total, day) => total + day.completed, 0)).toBe(score.completed);
    }
  });
});

describe('daily streaks and honest insight', () => {
  it('bridges unscheduled rest days, preserving yesterday through unfinished today and all future days', () => {
    const result = computeExecutionHeatmap(CYCLE, [tactic({
      weekdays: [0, 2, 3, 5],
      completions: [{ week: 1, weekday: 0, done: true }, { week: 1, weekday: 2, done: true }],
    })], NOW);
    expect(result.days[1].state).toBe('unscheduled');
    expect(result.days[3].state).toBe('pending');
    expect(result.summary).toMatchObject({ currentStreak: 2, bestStreak: 2, successfulDays: 2 });
  });

  it('partial today preserves the streak, but the same partial yesterday breaks it', () => {
    const tactics = [
      tactic({ id: 1, completions: [0, 1, 2, 3].map((weekday) => ({ week: 1, weekday, done: true })) }),
      tactic({ id: 2, completions: [0, 1, 2].map((weekday) => ({ week: 1, weekday, done: true })) }),
    ];
    expect(computeExecutionHeatmap(CYCLE, tactics, NOW).summary).toMatchObject({ currentStreak: 3, bestStreak: 3 });
    expect(computeExecutionHeatmap(CYCLE, tactics, new Date('2026-09-03T12:00:00Z')).summary)
      .toMatchObject({ currentStreak: 0, bestStreak: 3 });
  });

  it('ends an unfinished scheduled day’s grace precisely at Israel midnight', () => {
    const tactics = [tactic({
      weekdays: [0, 1], completions: [{ week: 1, weekday: 0, done: true }],
    })];
    const before = computeExecutionHeatmap(CYCLE, tactics, new Date('2026-08-31T20:59:59Z'));
    const after = computeExecutionHeatmap(CYCLE, tactics, new Date('2026-08-31T21:00:00Z'));
    expect(before.days[1].state).toBe('pending');
    expect(before.summary.currentStreak).toBe(1);
    expect(after.days[1].state).toBe('failed');
    expect(after.summary.currentStreak).toBe(0);
    expect(after.summary.bestStreak).toBe(1);
  });

  it('breaks on a past scheduled failure and starts counting again on success today', () => {
    const result = computeExecutionHeatmap(CYCLE, [tactic({
      completions: [0, 1, 3].map((weekday) => ({ week: 1, weekday, done: true })),
    })], NOW);
    expect(result.days[2].state).toBe('failed');
    expect(result.summary).toMatchObject({ currentStreak: 1, bestStreak: 2, successfulDays: 3 });
  });

  it('keeps streaks cycle-local and treats unscheduled days in the first week as neutral', () => {
    const result = computeExecutionHeatmap(CYCLE, [tactic({ weekdays: [4] })], NOW);
    expect(result.summary.currentStreak).toBe(0);
    expect(result.summary.bestStreak).toBe(0);
  });

  it('chooses strongest finalized weekday by exact weighted score, then completion count, then Sunday-first', () => {
    const tactics = [
      tactic({ id: 1, weekdays: [0, 1, 2, 3], completions: [0, 1, 2, 3].map((weekday) => ({ week: 1, weekday, done: true })) }),
      tactic({ id: 2, weekdays: [1, 2, 3], completions: [1, 2, 3].map((weekday) => ({ week: 1, weekday, done: true })) }),
      tactic({ id: 3, weekdays: [3], completions: [{ week: 1, weekday: 3, done: true }] }),
    ];
    const result = computeExecutionHeatmap(CYCLE, tactics, NOW);
    expect(result.summary.strongestWeekday).toEqual({ weekday: 1, completed: 2, scheduled: 2, days: 1, score: 100 });
  });
});

describe('Israel calendar, manual week and archived boundaries', () => {
  it.each([
    ['2026-03-26T21:59:59Z', '2026-03-26', 4],
    ['2026-03-26T22:00:00Z', '2026-03-27', 5],
    ['2026-03-26T23:59:59Z', '2026-03-27', 5],
    ['2026-03-27T00:00:00Z', '2026-03-27', 5],
    ['2026-09-01T20:59:59Z', '2026-09-01', 2],
    ['2026-09-01T21:00:00Z', '2026-09-02', 3],
    ['2026-10-24T22:59:59Z', '2026-10-25', 0],
    ['2026-10-24T23:00:00Z', '2026-10-25', 0],
  ])('uses Israel date at %s', (instant, date, weekday) => {
    const result = computeExecutionHeatmap({ ...CYCLE, current_week: 3 }, [], new Date(instant as string));
    expect(result.today).toBe(date);
    expect(result.days.find((day) => day.phase === 'today')).toMatchObject({ date, weekday, week: 3 });
    expect(new Set(result.days.map((day) => day.date)).size).toBe(84);
  });

  it.each(['2024-02-29T12:00:00Z', '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z', '2026-03-31T12:00:00Z'])(
    'keeps consecutive calendar labels across leap/month/year boundaries at %s', (instant) => {
      const result = computeExecutionHeatmap({ ...CYCLE, current_week: 4 }, [], new Date(instant));
      for (let index = 1; index < result.days.length; index++) {
        expect(new Date(result.days[index].date).getTime() - new Date(result.days[index - 1].date).getTime()).toBe(86_400_000);
      }
      expect(result.days[0].weekday).toBe(0);
      expect(new Date(result.startDate).getUTCDay()).toBe(0);
    }
  );

  it('advancing the manual week at Sunday preserves the calendar anchor and Saturday streak', () => {
    const tactics = [tactic({
      weekdays: [6], completions: [{ week: 1, weekday: 6, done: true }],
    })];
    const saturday = computeExecutionHeatmap(CYCLE, tactics, new Date('2026-09-05T20:59:59Z'));
    const sunday = computeExecutionHeatmap({ ...CYCLE, current_week: 2 }, tactics, new Date('2026-09-05T21:00:00Z'));
    expect(sunday.startDate).toBe(saturday.startDate);
    expect(sunday.summary.currentStreak).toBe(1);
  });

  it('freezes archive dates and finalizes the entire recorded week, excluding later unplayed weeks', () => {
    const cycle = { ...CYCLE, is_active: 0, current_week: 2, updated_at: '2026-09-02T12:00:00Z' };
    const tactics = [tactic({ weekdays: [6], completions: [1, 2, 3].map((week) => ({ week, weekday: 6, done: true })) })];
    const first = computeExecutionHeatmap(cycle, tactics, NOW);
    const later = computeExecutionHeatmap(cycle, tactics, new Date('2030-01-01T12:00:00Z'));
    expect(first.startDate).toBe('2026-08-23');
    expect(later.days).toEqual(first.days);
    expect(first.days[13]).toMatchObject({ state: 'success', phase: 'past' });
    expect(first.days[20]).toMatchObject({ state: 'not-reached', phase: 'outside-cycle', intensity: 0 });
    expect(first.summary).toMatchObject({ currentStreak: 2, bestStreak: 2, successfulDays: 2, completedOccurrences: 2 });
    expect(first.dateBasis).toBe('archive-week-anchor');
  });

  it('does not grant an unfinished-day grace period to an archived failure', () => {
    const result = computeExecutionHeatmap({ ...CYCLE, is_active: 0 }, [tactic({
      weekdays: [0, 3], completions: [{ week: 1, weekday: 0, done: true }],
    })], NOW);
    expect(result.summary).toMatchObject({ currentStreak: 0, bestStreak: 1 });
    expect(result.days[3].state).toBe('failed');
  });
});
