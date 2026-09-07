import { describe, it, expect } from 'vitest';
import { currentIsoWeek } from '../lib/isoWeek.js';

describe('currentIsoWeek', () => {
  it('formats as YYYY-Www', () => {
    expect(currentIsoWeek(new Date('2026-02-10T08:00:00.000Z'))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('is derived from the Asia/Jerusalem calendar date, not the host/UTC date', () => {
    // 22:30 UTC on a Monday is already Tuesday 00:30 in Asia/Jerusalem (UTC+2 in winter),
    // so this must report the Tuesday's ISO week, not the UTC Monday's.
    const mondayLateUtc = new Date('2026-02-09T22:30:00.000Z');
    const tuesdayEarlyUtc = new Date('2026-02-10T00:00:00.000Z');
    expect(currentIsoWeek(mondayLateUtc)).toBe(currentIsoWeek(tuesdayEarlyUtc));
  });

  it('matches known ISO week numbers', () => {
    // 2026-02-10 (Tuesday) is in ISO week 7 of 2026.
    expect(currentIsoWeek(new Date('2026-02-10T10:00:00.000Z'))).toBe('2026-W07');
    // Jan 1, 2026 (Thursday) belongs to ISO week 1 of 2026.
    expect(currentIsoWeek(new Date('2026-01-01T10:00:00.000Z'))).toBe('2026-W01');
  });

  it('rolls the ISO year/week across a year boundary correctly', () => {
    // Dec 29, 2025 (Monday) is ISO week 1 of 2026 (the first Thursday-containing week).
    expect(currentIsoWeek(new Date('2025-12-29T10:00:00.000Z'))).toBe('2026-W01');
  });
});
