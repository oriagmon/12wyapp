import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { freshApp } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { computeSuccessStreak } from '../lib/successStreak.js';

/**
 * Focused unit tests for computeSuccessStreak, seeded directly through raw SQL on top of the
 * freshApp() isolated in-memory database (per the repo's standard test pattern) — this gives
 * exact, deterministic control over per-week scheduled/completed counts (and thus exact
 * per-week scores) without needing dozens of completion-toggle API calls for precision.
 */

function insertCycle(
  db: Database.Database,
  userId: number,
  name: string,
  currentWeek: number,
  isActive: boolean
): number {
  const info = db
    .prepare('INSERT INTO cycles (user_id, name, current_week, is_active) VALUES (?, ?, ?, ?)')
    .run(userId, name, currentWeek, isActive ? 1 : 0);
  return Number(info.lastInsertRowid);
}

function insertGoal(db: Database.Database, cycleId: number): number {
  const info = db
    .prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)')
    .run(cycleId, 'G', 'emerald');
  return Number(info.lastInsertRowid);
}

function insertTacticForWeek(db: Database.Database, goalId: number, week: number): number {
  const info = db
    .prepare('INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, ?, ?)')
    .run(goalId, 'T', JSON.stringify([0]), week, week);
  return Number(info.lastInsertRowid);
}

/** Seeds an exact week score of round(completed/scheduled*100) by creating `scheduled`
 *  single-weekday tactics confined to that one week, and marking the first `completed` of
 *  them done. Leaves the week with score=null entirely if scheduled is 0 (never inserts
 *  anything for that week). */
function seedWeekScore(db: Database.Database, goalId: number, week: number, scheduled: number, completed: number): void {
  for (let i = 0; i < scheduled; i++) {
    const tacticId = insertTacticForWeek(db, goalId, week);
    if (i < completed) {
      db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, ?, 0, 1)').run(tacticId, week);
    }
  }
}

async function registerUser(app: ReturnType<typeof freshApp>, email: string): Promise<number> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  return res.body.id as number;
}

describe('computeSuccessStreak', () => {
  let app: ReturnType<typeof freshApp>;
  let db: Database.Database;

  beforeEach(() => {
    app = freshApp();
    db = getDb();
  });

  afterAll(() => closeDb());

  it('is 0 for a user with no cycles at all', async () => {
    const userId = await registerUser(app, 'a@a.com');
    expect(computeSuccessStreak(db, userId)).toBe(0);
  });

  it('is 0 when the only cycle has no finished weeks yet (still on week 1)', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 1, true);
    const goalId = insertGoal(db, cycleId);
    // Even if week 1 itself (the in-progress week) is fully "scheduled+completed", it must
    // never count — only weeks 1..current_week-1 are finished, which here is an empty range.
    seedWeekScore(db, goalId, 1, 4, 4);
    expect(computeSuccessStreak(db, userId)).toBe(0);
  });

  it('threshold: a finished week scoring exactly 85% counts toward the streak', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 2, true); // finished: week 1 only
    const goalId = insertGoal(db, cycleId);
    seedWeekScore(db, goalId, 1, 100, 85); // exactly 85%
    expect(computeSuccessStreak(db, userId)).toBe(1);
  });

  it('threshold: a finished week scoring exactly 84% does not count (breaks immediately)', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 2, true); // finished: week 1 only
    const goalId = insertGoal(db, cycleId);
    seedWeekScore(db, goalId, 1, 100, 84); // exactly 84%
    expect(computeSuccessStreak(db, userId)).toBe(0);
  });

  it('break/reset: only counts the trailing run of passing weeks, stopping at the first failing week', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 5, true); // finished: weeks 1-4
    const goalId = insertGoal(db, cycleId);
    seedWeekScore(db, goalId, 1, 4, 4); // pass (100%) — irrelevant, before the break
    seedWeekScore(db, goalId, 2, 4, 0); // fail (0%) — breaks the streak here
    seedWeekScore(db, goalId, 3, 4, 4); // pass
    seedWeekScore(db, goalId, 4, 4, 4); // pass
    // Counting backward from week 4: week4 pass, week3 pass, week2 fail -> stop. Streak = 2.
    expect(computeSuccessStreak(db, userId)).toBe(2);
  });

  it('the current in-progress week never breaks (or extends) the streak, regardless of its own data', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 3, true); // finished: weeks 1-2; week 3 in progress
    const goalId = insertGoal(db, cycleId);
    seedWeekScore(db, goalId, 1, 4, 4); // pass
    seedWeekScore(db, goalId, 2, 4, 4); // pass
    seedWeekScore(db, goalId, 3, 4, 0); // in-progress week scoring 0% — must be excluded entirely
    expect(computeSuccessStreak(db, userId)).toBe(2);
  });

  it('an empty (null-score) finished week breaks the streak even if earlier weeks passed', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 4, true); // finished: weeks 1-3
    const goalId = insertGoal(db, cycleId);
    seedWeekScore(db, goalId, 1, 4, 4); // pass
    seedWeekScore(db, goalId, 2, 4, 4); // pass
    // Week 3: nothing scheduled at all -> score is null (no seedWeekScore call for week 3).
    expect(computeSuccessStreak(db, userId)).toBe(0);
  });

  it('an archived cycle counts weeks 1..current_week as finished (not current_week - 1)', async () => {
    const userId = await registerUser(app, 'a@a.com');
    const cycleId = insertCycle(db, userId, 'C1', 12, false); // archived, ended at week 12
    const goalId = insertGoal(db, cycleId);
    for (let week = 1; week <= 12; week++) {
      seedWeekScore(db, goalId, week, 4, 4); // every week passes
    }
    // All 12 weeks are finished (archived), all passing -> streak = 12.
    expect(computeSuccessStreak(db, userId)).toBe(12);
  });

  it('continues across an archived cycle into the next (chronologically later) active cycle', async () => {
    const userId = await registerUser(app, 'a@a.com');

    const archivedId = insertCycle(db, userId, 'Old cycle', 12, false); // archived: finished weeks 1-12
    const archivedGoal = insertGoal(db, archivedId);
    for (let week = 1; week <= 9; week++) {
      seedWeekScore(db, archivedGoal, week, 4, 0); // weeks 1-9 fail/irrelevant
    }
    seedWeekScore(db, archivedGoal, 10, 4, 0); // week 10 fails — this is where the streak must stop
    seedWeekScore(db, archivedGoal, 11, 4, 4); // pass
    seedWeekScore(db, archivedGoal, 12, 4, 4); // pass

    const activeId = insertCycle(db, userId, 'New cycle', 3, true); // active: finished weeks 1-2
    const activeGoal = insertGoal(db, activeId);
    seedWeekScore(db, activeGoal, 1, 4, 4); // pass
    seedWeekScore(db, activeGoal, 2, 4, 4); // pass
    // week 3 (in progress) intentionally left unseeded/irrelevant.

    // Chronological finished-week timeline: [...9 fails, week10 fail, week11 pass, week12
    // pass, new-week1 pass, new-week2 pass]. Counting backward: 2 (new cycle) + 2 (old
    // cycle's last two weeks) = 4, stopping at old cycle's failing week 10.
    expect(computeSuccessStreak(db, userId)).toBe(4);
  });

  it('per-user isolation: one user’s streak never leaks into another user’s computation', async () => {
    const userA = await registerUser(app, 'a@a.com');
    const userB = await registerUser(app, 'b@a.com');

    const cycleA = insertCycle(db, userA, 'A', 2, true);
    seedWeekScore(db, insertGoal(db, cycleA), 1, 4, 4); // A: 1-week streak

    const cycleB = insertCycle(db, userB, 'B', 2, true);
    seedWeekScore(db, insertGoal(db, cycleB), 1, 4, 0); // B: broken immediately

    expect(computeSuccessStreak(db, userA)).toBe(1);
    expect(computeSuccessStreak(db, userB)).toBe(0);
  });
});
