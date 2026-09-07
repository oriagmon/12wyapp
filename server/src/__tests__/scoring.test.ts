import { describe, it, expect } from 'vitest';
import {
  computeWeekScores,
  remainingToTarget,
  isGoldWeek,
  averageScore,
  type TacticWithCompletions,
} from '../lib/scoring.js';

describe('scoring', () => {
  it('scores completed/scheduled * 100, rounded', () => {
    const tactics: TacticWithCompletions[] = [
      {
        id: 1,
        weekdays: [0, 2, 4], // Sun, Tue, Thu
        startWeek: 1,
        endWeek: 12,
        completions: [
          { week: 1, weekday: 0, done: true },
          { week: 1, weekday: 2, done: true },
          // Thursday week 1 not done -> 2/3 scheduled completed
        ],
      },
    ];
    const scores = computeWeekScores(tactics);
    const week1 = scores.find((w) => w.week === 1)!;
    expect(week1.scheduled).toBe(3);
    expect(week1.completed).toBe(2);
    expect(week1.score).toBe(67); // round(2/3*100) = 67
  });

  it('gives null score for a week with nothing scheduled (empty week)', () => {
    const tactics: TacticWithCompletions[] = [
      { id: 1, weekdays: [1], startWeek: 3, endWeek: 5, completions: [] },
    ];
    const scores = computeWeekScores(tactics);
    const week1 = scores.find((w) => w.week === 1)!;
    expect(week1.scheduled).toBe(0);
    expect(week1.score).toBeNull();
  });

  it('does not cross-contaminate completions between different tactics on the same weekday', () => {
    const tactics: TacticWithCompletions[] = [
      { id: 1, weekdays: [0], startWeek: 1, endWeek: 12, completions: [{ week: 1, weekday: 0, done: true }] },
      { id: 2, weekdays: [0], startWeek: 1, endWeek: 12, completions: [] },
    ];
    const scores = computeWeekScores(tactics);
    const week1 = scores.find((w) => w.week === 1)!;
    expect(week1.scheduled).toBe(2);
    expect(week1.completed).toBe(1);
    expect(week1.score).toBe(50);
  });

  it('uses a one-week override only for its specified week', () => {
    const tactics: TacticWithCompletions[] = [
      {
        id: 1,
        weekdays: [0],
        startWeek: 1,
        endWeek: 12,
        overrides: [{ week: 2, weekdays: [1, 2] }],
        completions: [],
      },
    ];

    const scores = computeWeekScores(tactics);
    expect(scores[0].scheduled).toBe(1);
    expect(scores[1].scheduled).toBe(2);
    expect(scores[2].scheduled).toBe(1);
  });

  it('remainingToTarget is max(0, 85 - score), and 85 for empty weeks', () => {
    expect(remainingToTarget(85)).toBe(0);
    expect(remainingToTarget(100)).toBe(0);
    expect(remainingToTarget(50)).toBe(35);
    expect(remainingToTarget(null)).toBe(85);
  });

  it('isGoldWeek requires score >= 85', () => {
    expect(isGoldWeek(85)).toBe(true);
    expect(isGoldWeek(84)).toBe(false);
    expect(isGoldWeek(null)).toBe(false);
    expect(isGoldWeek(100)).toBe(true);
  });

  it('averageScore excludes empty (null-score) weeks', () => {
    const avg = averageScore([
      { week: 1, scheduled: 2, completed: 2, score: 100 },
      { week: 2, scheduled: 0, completed: 0, score: null },
      { week: 3, scheduled: 2, completed: 1, score: 50 },
    ]);
    expect(avg).toBe(75);
  });

  it('averageScore is null when every week is empty', () => {
    const avg = averageScore([
      { week: 1, scheduled: 0, completed: 0, score: null },
      { week: 2, scheduled: 0, completed: 0, score: null },
    ]);
    expect(avg).toBeNull();
  });
});
