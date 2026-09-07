import { describe, it, expect, afterEach } from 'vitest';
import { formatIsraelWallTime, israelWallTimeToUtcIso, nearestFridayWallTime, utcIsoToIsraelWallTime } from '../lib/israelTime';

describe('israelWallTimeToUtcIso', () => {
  it('converts a winter (Israel Standard Time, UTC+2) wall-clock time to UTC', () => {
    expect(israelWallTimeToUtcIso('2026-01-15T10:00')).toBe('2026-01-15T08:00:00.000Z');
  });

  it('converts a summer (Israel Daylight Time, UTC+3) wall-clock time to UTC', () => {
    expect(israelWallTimeToUtcIso('2026-07-15T10:00')).toBe('2026-07-15T07:00:00.000Z');
  });

  it('is correct independent of any assumption about the host/browser timezone (no local Date getters used)', () => {
    // Two calendar dates straddling the same UTC offset boundary in different ways —
    // regression guard against accidentally using local Date getters/constructors.
    expect(israelWallTimeToUtcIso('2026-12-31T23:30')).toBe('2026-12-31T21:30:00.000Z');
    expect(israelWallTimeToUtcIso('2026-06-01T00:15')).toBe('2026-05-31T21:15:00.000Z');
  });

  it('rejects a wall-clock time that does not exist due to the Israel spring-forward DST gap', () => {
    // Israel's clocks jump from 01:59:59 straight to 03:00:00 local time at the 2026 DST
    // start (2026-03-27 02:00 local never occurs).
    expect(israelWallTimeToUtcIso('2026-03-27T02:30')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(israelWallTimeToUtcIso('not-a-date')).toBeNull();
    expect(israelWallTimeToUtcIso('2026-13-40T99:99')).toBeNull();
    expect(israelWallTimeToUtcIso('')).toBeNull();
  });

  it('round-trips through utcIsoToIsraelWallTime for both winter and summer', () => {
    const winterIso = israelWallTimeToUtcIso('2026-01-15T10:00')!;
    expect(utcIsoToIsraelWallTime(winterIso)).toBe('2026-01-15T10:00');
    const summerIso = israelWallTimeToUtcIso('2026-07-15T10:00')!;
    expect(utcIsoToIsraelWallTime(summerIso)).toBe('2026-07-15T10:00');
  });
});

describe('utcIsoToIsraelWallTime / formatIsraelWallTime', () => {
  it('renders Israel local wall time for a UTC instant, independent of host timezone', () => {
    expect(utcIsoToIsraelWallTime('2026-01-15T08:00:00.000Z')).toBe('2026-01-15T10:00');
    expect(utcIsoToIsraelWallTime('2026-07-15T07:00:00.000Z')).toBe('2026-07-15T10:00');
  });

  it('formatIsraelWallTime agrees with utcIsoToIsraelWallTime for the same instant', () => {
    const date = new Date('2026-07-15T07:00:00.000Z');
    expect(formatIsraelWallTime(date)).toBe(utcIsoToIsraelWallTime(date.toISOString()));
  });
});

describe('host/browser timezone independence', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('produces identical results under a non-Israel host timezone (America/New_York)', () => {
    process.env.TZ = 'America/New_York';
    expect(israelWallTimeToUtcIso('2026-01-15T10:00')).toBe('2026-01-15T08:00:00.000Z');
    expect(israelWallTimeToUtcIso('2026-07-15T10:00')).toBe('2026-07-15T07:00:00.000Z');
    expect(israelWallTimeToUtcIso('2026-03-27T02:30')).toBeNull();
    expect(utcIsoToIsraelWallTime('2026-01-15T08:00:00.000Z')).toBe('2026-01-15T10:00');
    expect(utcIsoToIsraelWallTime('2026-07-15T07:00:00.000Z')).toBe('2026-07-15T10:00');
  });

  it('produces identical results under a non-Israel host timezone (Pacific/Auckland, ahead of UTC)', () => {
    process.env.TZ = 'Pacific/Auckland';
    expect(israelWallTimeToUtcIso('2026-01-15T10:00')).toBe('2026-01-15T08:00:00.000Z');
    expect(israelWallTimeToUtcIso('2026-07-15T10:00')).toBe('2026-07-15T07:00:00.000Z');
    expect(utcIsoToIsraelWallTime('2026-01-15T08:00:00.000Z')).toBe('2026-01-15T10:00');
  });
});

describe('nearestFridayWallTime', () => {
  it.each([
    ['Sunday', '2026-09-06T08:00:00+03:00', '2026-09-11T13:05'],
    ['Thursday', '2026-09-10T23:59:00+03:00', '2026-09-11T13:05'],
    ['Friday, before the slot', '2026-09-11T13:04:59+03:00', '2026-09-11T13:05'],
    ['Friday, exactly at the slot', '2026-09-11T13:05:00+03:00', '2026-09-18T13:05'],
    ['Friday, after the slot', '2026-09-11T18:00:00+03:00', '2026-09-18T13:05'],
    ['Saturday', '2026-09-12T00:01:00+03:00', '2026-09-18T13:05'],
    ['across a month boundary', '2026-09-28T09:00:00+03:00', '2026-10-02T13:05'],
    ['across a year boundary', '2026-12-28T09:00:00+02:00', '2027-01-01T13:05'],
  ])('suggests the nearest upcoming Friday 13:05 from %s', (_label, now, expected) => {
    expect(nearestFridayWallTime(new Date(now))).toBe(expected);
  });

  it('is derived from the Israel calendar date, not the host timezone', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — a full calendar day ahead of Israel
    try {
      // Israel is still Thursday here, so the suggestion must stay on the same-week Friday.
      expect(nearestFridayWallTime(new Date('2026-09-10T22:00:00+03:00'))).toBe('2026-09-11T13:05');
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('always returns an existing Israel wall-clock time', () => {
    // The DST transitions fall on Fridays in Israel, so every suggestion must round-trip.
    for (let week = 0; week < 60; week += 1) {
      const now = new Date(Date.UTC(2026, 0, 4) + week * 7 * 86_400_000);
      const suggestion = nearestFridayWallTime(now);
      expect(israelWallTimeToUtcIso(suggestion)).not.toBeNull();
      expect(suggestion).toMatch(/T13:05$/);
      expect(new Date(israelWallTimeToUtcIso(suggestion)!).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('honours an explicit hour and minute', () => {
    expect(nearestFridayWallTime(new Date('2026-09-06T08:00:00+03:00'), 9, 0)).toBe('2026-09-11T09:00');
  });
});
