import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import { freshApp } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import {
  computeCycleWeek,
  anchorUnanchoredCycles,
  advanceDueCycleWeeks,
  CYCLE_WEEKS,
} from '../lib/cycleWeekAdvance.js';

let db: Database.Database;

/** An Israel-local instant. Israel is UTC+3 in September, so 12:00 local is 09:00 UTC. */
function israelNoon(isoDate: string): Date {
  return new Date(`${isoDate}T09:00:00.000Z`);
}

function makeUser(email: string): number {
  return Number(
    db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'x')").run(email).lastInsertRowid
  );
}

function makeCycle(userId: number, currentWeek: number, startedOn: string | null, createdAt?: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO cycles (user_id, name, current_week, is_active, started_on, created_at)
         VALUES (?, 'c', ?, 1, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
      )
      .run(userId, currentWeek, startedOn, createdAt ?? null).lastInsertRowid
  );
}

beforeEach(() => {
  freshApp();
  db = getDb();
});

afterAll(() => closeDb());

describe('computeCycleWeek', () => {
  // 2026-08-30 is a Sunday.
  it('is week 1 on the anchor Sunday itself', () => {
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-08-30'))).toBe(1);
  });

  it('stays week 1 through the Saturday that ends week 1', () => {
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-09-05'))).toBe(1);
  });

  it('turns over to week 2 on the next Sunday', () => {
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-09-06'))).toBe(2);
  });

  it('counts a mid-week day into the right week', () => {
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-09-09'))).toBe(2);
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-09-13'))).toBe(3);
  });

  it('caps at week 12 instead of running off the end of the cycle', () => {
    // 2026-11-22 is the Sunday that would otherwise start week 13.
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-11-15'))).toBe(CYCLE_WEEKS);
    expect(computeCycleWeek('2026-08-30', israelNoon('2026-11-22'))).toBe(CYCLE_WEEKS);
    expect(computeCycleWeek('2026-08-30', israelNoon('2027-05-01'))).toBe(CYCLE_WEEKS);
  });

  it('clamps a future anchor to week 1 rather than returning zero or negative', () => {
    expect(computeCycleWeek('2026-10-04', israelNoon('2026-09-06'))).toBe(1);
  });

  it('returns null for an unparseable anchor so a corrupt row is left alone', () => {
    expect(computeCycleWeek('not-a-date', israelNoon('2026-09-06'))).toBeNull();
    expect(computeCycleWeek('', israelNoon('2026-09-06'))).toBeNull();
  });

  // Israel switches from UTC+3 to UTC+2 on 2026-10-25 (a Sunday). An implementation that
  // subtracted raw timestamps instead of collapsing both sides to their Sunday would be an
  // hour short across this boundary and could report the previous week for the whole day.
  it('is unaffected by the DST transition', () => {
    expect(computeCycleWeek('2026-08-30', new Date('2026-10-25T00:30:00.000Z'))).toBe(9);
    expect(computeCycleWeek('2026-08-30', new Date('2026-10-25T21:30:00.000Z'))).toBe(9);
  });

  // The rollover must follow *Israel* midnight, not UTC midnight. At 22:30 UTC on Saturday
  // it is already 01:30 Sunday in Israel, so the week has turned over.
  it('rolls over at Israel midnight, not UTC midnight', () => {
    expect(computeCycleWeek('2026-08-30', new Date('2026-09-05T20:00:00.000Z'))).toBe(1);
    expect(computeCycleWeek('2026-08-30', new Date('2026-09-05T22:30:00.000Z'))).toBe(2);
  });
});

describe('anchorUnanchoredCycles', () => {
  // The critical property: adopting the calendar must not move anybody's week number on the
  // day it happens. A cycle left on week 1 for a month has every completion filed under
  // week 1, so jumping it forward would declare the weeks in between finished-and-empty.
  it('anchors so the current week does not change', () => {
    const user = makeUser('a@example.com');
    const cycle = makeCycle(user, 1, null, '2026-08-04T13:06:35.677Z');

    const anchored = anchorUnanchoredCycles(db, israelNoon('2026-09-13'));

    expect(anchored).toEqual([{ cycleId: cycle, userId: user, startedOn: '2026-09-13' }]);
    expect(computeCycleWeek('2026-09-13', israelNoon('2026-09-13'))).toBe(1);
  });

  it('does not retroactively finish any week, however old the cycle is', () => {
    const user = makeUser('a2@example.com');
    makeCycle(user, 1, null, '2026-01-01T00:00:00.000Z');

    anchorUnanchoredCycles(db, israelNoon('2026-09-13'));
    const advances = advanceDueCycleWeeks(db, israelNoon('2026-09-13'));

    expect(advances).toEqual([]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE user_id = ?').get(user)).toEqual({
      current_week: 1,
    });
  });

  it('anchors a cycle already on a later week back by that many weeks', () => {
    const user = makeUser('a3@example.com');
    const cycle = makeCycle(user, 4, null);

    const anchored = anchorUnanchoredCycles(db, israelNoon('2026-09-13'));

    // 3 whole weeks before 2026-09-13 is 2026-08-23, so today is still week 4.
    expect(anchored).toEqual([{ cycleId: cycle, userId: user, startedOn: '2026-08-23' }]);
    expect(computeCycleWeek('2026-08-23', israelNoon('2026-09-13'))).toBe(4);
  });

  it('rolls over to the next week on the following Sunday, not sooner', () => {
    const user = makeUser('a4@example.com');
    makeCycle(user, 1, null);
    anchorUnanchoredCycles(db, israelNoon('2026-09-13'));

    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-19'))).toEqual([]);
    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-20'))).toMatchObject([
      { previousWeek: 1, newWeek: 2 },
    ]);
  });

  it('never re-anchors a cycle that already has a start date', () => {
    const user = makeUser('b@example.com');
    const cycle = makeCycle(user, 3, '2026-07-05', '2026-09-04T13:06:35.677Z');

    expect(anchorUnanchoredCycles(db, israelNoon('2026-09-12'))).toEqual([]);
    expect(db.prepare('SELECT started_on FROM cycles WHERE id = ?').get(cycle)).toEqual({
      started_on: '2026-07-05',
    });
  });

  it('ignores archived cycles', () => {
    const user = makeUser('c@example.com');
    const cycle = makeCycle(user, 5, null, '2026-09-04T13:06:35.677Z');
    db.prepare('UPDATE cycles SET is_active = 0 WHERE id = ?').run(cycle);

    expect(anchorUnanchoredCycles(db, israelNoon('2026-09-12'))).toEqual([]);
    expect(db.prepare('SELECT started_on FROM cycles WHERE id = ?').get(cycle)).toEqual({ started_on: null });
  });
});

describe('advanceDueCycleWeeks', () => {
  it('moves a cycle stuck on week 1 onto its real calendar week', () => {
    const user = makeUser('d@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');

    const advances = advanceDueCycleWeeks(db, israelNoon('2026-09-13'));

    expect(advances).toMatchObject([{ cycleId: cycle, userId: user, previousWeek: 1, newWeek: 3 }]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({ current_week: 3 });
  });

  it('does nothing when the cycle is already on the right week', () => {
    const user = makeUser('e@example.com');
    makeCycle(user, 2, '2026-08-30');

    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-09'))).toEqual([]);
  });

  // Stepping back to review an earlier week is normal in the UI. A worker that "corrected"
  // that would fight the user and yank the dashboard out from under them mid-session.
  it('never moves a cycle backwards', () => {
    const user = makeUser('f@example.com');
    const cycle = makeCycle(user, 8, '2026-08-30');

    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-09'))).toEqual([]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({ current_week: 8 });
  });

  it('anchors an unanchored cycle without advancing it in the same pass', () => {
    const user = makeUser('g@example.com');
    const cycle = makeCycle(user, 1, null, '2026-09-04T13:06:35.677Z');

    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-13'))).toEqual([]);
    expect(db.prepare('SELECT started_on, current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({
      started_on: '2026-09-13',
      current_week: 1,
    });
  });

  it('leaves archived cycles alone', () => {
    const user = makeUser('h@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');
    db.prepare('UPDATE cycles SET is_active = 0 WHERE id = ?').run(cycle);

    expect(advanceDueCycleWeeks(db, israelNoon('2026-09-13'))).toEqual([]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({ current_week: 1 });
  });

  it('never exceeds week 12, respecting the CHECK constraint', () => {
    const user = makeUser('i@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');

    expect(() => advanceDueCycleWeeks(db, israelNoon('2027-05-01'))).not.toThrow();
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({
      current_week: CYCLE_WEEKS,
    });
  });

  // The whole point of recomputing rather than incrementing: running the worker repeatedly
  // (per-minute timer, plus the recap worker's own call) must be indistinguishable from
  // running it once.
  it('is idempotent across repeated runs in the same week', () => {
    const user = makeUser('j@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');
    const now = israelNoon('2026-09-13');

    expect(advanceDueCycleWeeks(db, now)).toHaveLength(1);
    expect(advanceDueCycleWeeks(db, now)).toEqual([]);
    expect(advanceDueCycleWeeks(db, now)).toEqual([]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({ current_week: 3 });
  });

  // A missed run must not cause permanent drift — the anchor, not a counter, defines the week.
  it('self-heals after an outage instead of drifting by the number of missed runs', () => {
    const user = makeUser('k@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');

    // Worker was down for six weeks; the first run back lands on the correct week directly.
    const advances = advanceDueCycleWeeks(db, israelNoon('2026-10-11'));

    expect(advances).toMatchObject([{ previousWeek: 1, newWeek: 7 }]);
    expect(db.prepare('SELECT current_week FROM cycles WHERE id = ?').get(cycle)).toEqual({ current_week: 7 });
  });

  it('advances each partner independently', () => {
    const a = makeUser('l@example.com');
    const b = makeUser('m@example.com');
    makeCycle(a, 1, '2026-08-30');
    makeCycle(b, 1, '2026-09-06');

    const advances = advanceDueCycleWeeks(db, israelNoon('2026-09-13'));

    expect(advances.map((x) => ({ userId: x.userId, newWeek: x.newWeek }))).toEqual([
      { userId: a, newWeek: 3 },
      { userId: b, newWeek: 2 },
    ]);
  });

  it('reports the scores it froze when the week closed', () => {
    const user = makeUser('n@example.com');
    const cycle = makeCycle(user, 1, '2026-08-30');

    const advances = advanceDueCycleWeeks(db, israelNoon('2026-09-13'));

    // No meetings exist here, so nothing to finalize — but the field must be present so the
    // worker can report it rather than crashing on undefined.
    expect(advances[0].finalizedScores).toEqual([]);
    expect(cycle).toBeGreaterThan(0);
  });
});

describe('Sunday-boundary invariant', () => {
  // Anchors are always *written* as Sundays, but a hand-edited row must not get its own
  // private week boundary: weeks have to keep turning over on Sunday so they stay aligned
  // with the 0=Sun..6=Sat `completions` grid the scores are computed from. 2026-09-02 is a
  // Wednesday, and is treated exactly like its Sunday, 2026-08-30.
  it('treats a mid-week anchor as that week Sunday', () => {
    expect(computeCycleWeek('2026-09-02', israelNoon('2026-09-05'))).toBe(1);
    expect(computeCycleWeek('2026-09-02', israelNoon('2026-09-06'))).toBe(2);
    expect(computeCycleWeek('2026-09-02', israelNoon('2026-09-09'))).toBe(2);
    expect(computeCycleWeek('2026-09-02', israelNoon('2026-09-13'))).toBe(3);
  });

  it('agrees with the equivalent Sunday anchor on every day of a 4-week span', () => {
    for (let offset = 0; offset < 28; offset += 1) {
      const day = new Date(Date.UTC(2026, 7, 30) + offset * 86_400_000);
      const iso = day.toISOString().slice(0, 10);
      expect(computeCycleWeek('2026-09-02', israelNoon(iso))).toBe(computeCycleWeek('2026-08-30', israelNoon(iso)));
    }
  });
});
