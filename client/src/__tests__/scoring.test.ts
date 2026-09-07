import { describe, it, expect } from 'vitest';
import {
  effectiveTacticForWeek,
  formatScore,
  remainingToTarget,
  isGoldWeek,
  todayWeekday,
} from '../lib/scoring';

describe('client scoring helpers', () => {
  it('remainingToTarget mirrors backend semantics', () => {
    expect(remainingToTarget(85)).toBe(0);
    expect(remainingToTarget(50)).toBe(35);
    expect(remainingToTarget(null)).toBe(85);
  });

  it('isGoldWeek requires score >= 85', () => {
    expect(isGoldWeek(85)).toBe(true);
    expect(isGoldWeek(84)).toBe(false);
    expect(isGoldWeek(null)).toBe(false);
  });

  it('formats scores as percentages', () => {
    expect(formatScore(86)).toBe('86%');
    expect(formatScore(null)).toBe('—');
  });

  it('todayWeekday returns a value in the JS Date#getDay range', () => {
    const d = todayWeekday();
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(6);
  });

  it('resolves a temporary tactic override only for its week', () => {
    const tactic = {
      title: 'Base',
      weekdays: [0],
      overrides: [{ week: 2, title: 'Adapted', weekdays: [1, 2] }],
    };
    expect(effectiveTacticForWeek(tactic, 2)).toEqual({
      title: 'Adapted',
      weekdays: [1, 2],
    });
    expect(effectiveTacticForWeek(tactic, 3)).toEqual({ title: 'Base', weekdays: [0] });
  });
});
