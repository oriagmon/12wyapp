import { describe, it, expect } from 'vitest';
import { israelWeekday } from '../lib/israelTime.js';

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
