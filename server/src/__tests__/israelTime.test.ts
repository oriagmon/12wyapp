import { describe, it, expect } from 'vitest';
import { israelWeekday, israelWeekStart } from '../lib/israelTime.js';

describe('israelWeekday', () => {
  // 2024-01-07 is a Sunday. Israel is on standard time (UTC+2, no DST) in January, so noon
  // UTC on each of these dates is mid-afternoon Israel time — safely within the same Israel
  // calendar day, making these deterministic, unambiguous fixtures.
  const sunday = new Date('2024-01-07T12:00:00Z');
  const monday = new Date('2024-01-08T12:00:00Z');
  const tuesday = new Date('2024-01-09T12:00:00Z');
  const wednesday = new Date('2024-01-10T12:00:00Z');
  const thursday = new Date('2024-01-11T12:00:00Z');
  const friday = new Date('2024-01-12T12:00:00Z');
  const saturday = new Date('2024-01-13T12:00:00Z');

  it('returns 0=Sunday..6=Saturday matching this app\'s weekday convention', () => {
    expect(israelWeekday(sunday)).toBe(0);
    expect(israelWeekday(monday)).toBe(1);
    expect(israelWeekday(tuesday)).toBe(2);
    expect(israelWeekday(wednesday)).toBe(3);
    expect(israelWeekday(thursday)).toBe(4);
    expect(israelWeekday(friday)).toBe(5);
    expect(israelWeekday(saturday)).toBe(6);
  });

  it('is correct near an Israel-local midnight boundary even when the UTC calendar date differs', () => {
    // 2024-01-07T22:30:00Z is already 2024-01-08 (Monday) at 00:30 Israel time (UTC+2).
    const justAfterIsraelMidnight = new Date('2024-01-07T22:30:00Z');
    expect(israelWeekday(justAfterIsraelMidnight)).toBe(1); // Monday, not Sunday
  });

  it('is correct during Israel daylight saving time (UTC+3, e.g. July)', () => {
    // 2024-07-10 is a Wednesday. Noon UTC in July is safely within Israel's DST calendar day.
    expect(israelWeekday(new Date('2024-07-10T12:00:00Z'))).toBe(3);
  });
});

describe('israelWeekStart', () => {
  it('names the whole week after the Sunday that started it', () => {
    // 2024-01-07 (Sun) through 2024-01-13 (Sat) are one week by this app's reckoning.
    for (const day of ['07', '08', '09', '10', '11', '12', '13']) {
      expect(israelWeekStart(new Date(`2024-01-${day}T12:00:00Z`)), day).toBe('2024-01-07');
    }
  });

  it('turns over on Sunday, not Monday', () => {
    // The whole reason this exists rather than reusing currentIsoWeek(): an ISO week would
    // still call this Saturday's week, and would then change again the next day, mid-week.
    expect(israelWeekStart(new Date('2024-01-13T12:00:00Z'))).toBe('2024-01-07'); // Sat
    expect(israelWeekStart(new Date('2024-01-14T12:00:00Z'))).toBe('2024-01-14'); // Sun — new
    expect(israelWeekStart(new Date('2024-01-15T12:00:00Z'))).toBe('2024-01-14'); // Mon — same
  });

  it('uses the Israel calendar day, not the UTC one', () => {
    // 22:30Z Saturday is already 00:30 Sunday in Israel — the start of a brand-new week.
    expect(israelWeekStart(new Date('2024-01-13T22:30:00Z'))).toBe('2024-01-14');
  });

  it('crosses a month and a year boundary cleanly', () => {
    // 2024-12-31 is a Tuesday; its week started Sunday 2024-12-29.
    expect(israelWeekStart(new Date('2024-12-31T12:00:00Z'))).toBe('2024-12-29');
    // 2025-01-01 is the Wednesday of that same week.
    expect(israelWeekStart(new Date('2025-01-01T12:00:00Z'))).toBe('2024-12-29');
  });

  it('is unaffected by Israel daylight saving time', () => {
    // 2024-07-10 is a Wednesday during DST (UTC+3); its week started Sunday 2024-07-07.
    expect(israelWeekStart(new Date('2024-07-10T12:00:00Z'))).toBe('2024-07-07');
    // The DST transition itself (2024-03-29) falls in the week starting Sunday 2024-03-24.
    expect(israelWeekStart(new Date('2024-03-30T12:00:00Z'))).toBe('2024-03-24');
  });
});
