import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { finalizeClosedWeekScores } from '../lib/weekScoreFinalization.js';

type App = ReturnType<typeof freshApp>;

async function registerAndLogin(app: App, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number };
}

async function pair(app: App, a: { cookie: string }, b: { userId: number }) {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  expect(res.status).toBe(201);
}

/**
 * Four scheduled weekdays makes every tick worth exactly 25%, so a test can land precisely on
 * the 85 threshold's two sides (50 vs 100) and show the finalized value is a genuinely
 * different number rather than a coincidence.
 */
function seedPlan(userId: number, currentWeek = 1, weekdays: number[] = [0, 1, 2, 3]): number {
  const db = getDb();
  const cycle = db
    .prepare('INSERT INTO cycles (user_id, name, current_week, is_active) VALUES (?, ?, ?, 1)')
    .run(userId, 'Test cycle', currentWeek);
  const goal = db
    .prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)')
    .run(Number(cycle.lastInsertRowid), 'Goal', '#3b82f6');
  const tactic = db
    .prepare('INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, 1, 12)')
    .run(Number(goal.lastInsertRowid), 'Tactic', JSON.stringify(weekdays));
  return Number(tactic.lastInsertRowid);
}

function tick(app: App, cookie: string, tacticId: number, weekday: number, week = 1) {
  return request(app).post('/api/completions/toggle').set('Cookie', cookie)
    .send({ tacticId, week, weekday, done: true }).expect(200);
}

function setWeek(app: App, cookie: string, currentWeek: number) {
  return request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek }).expect(200);
}

function reviewOf(wamId: number, userId: number) {
  return getDb()
    .prepare('SELECT score_snapshot, score_finalized_at FROM wam_reviews WHERE wam_id = ? AND user_id = ?')
    .get(wamId, userId) as { score_snapshot: number | null; score_finalized_at: string | null };
}

/**
 * Reproduces the real-world sequence that motivated all of this: the meeting is held on a
 * Friday morning, two of the week's four days still unticked, and the rest of the week is
 * finished afterwards.
 */
async function meetOnFridayThenFinishTheWeek(app: App) {
  const a = await registerAndLogin(app, 'a@example.com');
  const b = await registerAndLogin(app, 'b@example.com');
  await pair(app, a, b);
  const tacticA = seedPlan(a.userId);
  const tacticB = seedPlan(b.userId);

  // Half the week done at meeting time.
  await tick(app, a.cookie, tacticA, 0);
  await tick(app, a.cookie, tacticA, 1);
  await tick(app, b.cookie, tacticB, 0);
  await tick(app, b.cookie, tacticB, 1);

  const started = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
  const wamId = started.body.id as number;
  await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({}).expect(200);

  // ...and then they actually finish the week.
  await tick(app, a.cookie, tacticA, 2);
  await tick(app, a.cookie, tacticA, 3);
  await tick(app, b.cookie, tacticB, 2);
  await tick(app, b.cookie, tacticB, 3);

  return { a, b, wamId };
}

afterAll(() => closeDb());

describe('A meeting held before the week ends must not freeze a half-finished week', () => {
  it('leaves the mid-week score provisional, then finalizes it when the cycle moves on', async () => {
    const app = freshApp();
    const { a, wamId } = await meetOnFridayThenFinishTheWeek(app);

    // Frozen at the moment of the Friday meeting: 2 of 4 days.
    expect(reviewOf(wamId, a.userId)).toEqual({ score_snapshot: 50, score_finalized_at: null });

    await setWeek(app, a.cookie, 2);

    const after = reviewOf(wamId, a.userId);
    expect(after.score_snapshot).toBe(100);
    expect(after.score_finalized_at).not.toBeNull();
  });

  // The whole point: 85 is DUO_STREAK_THRESHOLD, so a week finished at 100% that was frozen
  // at 50% did not merely look wrong, it cost them the streak and the celebration.
  it('restores the duo streak that the premature score had silently broken', async () => {
    const app = freshApp();
    const { a, b, wamId } = await meetOnFridayThenFinishTheWeek(app);

    const before = await request(app).get('/api/wams').set('Cookie', a.cookie).expect(200);
    expect(before.body.duoStreak.currentStreak).toBe(0);

    await setWeek(app, a.cookie, 2);
    await setWeek(app, b.cookie, 2);

    expect(reviewOf(wamId, a.userId).score_snapshot).toBe(100);
    expect(reviewOf(wamId, b.userId).score_snapshot).toBe(100);
    const after = await request(app).get('/api/wams').set('Cookie', a.cookie).expect(200);
    expect(after.body.duoStreak.currentStreak).toBe(1);
  });

  // Each partner is scored against their own cycle, and they are routinely on different
  // weeks. One person moving on must not finalize the other person's still-open week.
  it('finalizes each partner independently, on their own cycle timeline', async () => {
    const app = freshApp();
    const { a, b, wamId } = await meetOnFridayThenFinishTheWeek(app);

    await setWeek(app, a.cookie, 2);

    expect(reviewOf(wamId, a.userId).score_finalized_at).not.toBeNull();
    expect(reviewOf(wamId, b.userId)).toEqual({ score_snapshot: 50, score_finalized_at: null });

    await setWeek(app, b.cookie, 2);
    expect(reviewOf(wamId, b.userId).score_snapshot).toBe(100);
  });

  it('never re-freezes an already-final score, so later edits cannot rewrite history', async () => {    const app = freshApp();
    const { a, wamId } = await meetOnFridayThenFinishTheWeek(app);
    await setWeek(app, a.cookie, 2);
    const finalizedAt = reviewOf(wamId, a.userId).score_finalized_at;
    expect(reviewOf(wamId, a.userId).score_snapshot).toBe(100);

    // Retroactively undo a day of week 1 and advance again — the frozen result must not move.
    const tacticA = getDb()
      .prepare(`SELECT t.id FROM tactics t JOIN goals g ON g.id = t.goal_id
                JOIN cycles c ON c.id = g.cycle_id WHERE c.user_id = ?`)
      .get(a.userId) as { id: number };
    await request(app).post('/api/completions/toggle').set('Cookie', a.cookie)
      .send({ tacticId: tacticA.id, week: 1, weekday: 3, done: false }).expect(200);
    await setWeek(app, a.cookie, 3);

    expect(reviewOf(wamId, a.userId)).toEqual({ score_snapshot: 100, score_finalized_at: finalizedAt });
  });

  it('stamps the score as final straight away when the meeting is held after the week closed', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'late-a@example.com');
    const b = await registerAndLogin(app, 'late-b@example.com');
    await pair(app, a, b);
    const tacticA = seedPlan(a.userId);
    seedPlan(b.userId);
    await tick(app, a.cookie, tacticA, 0);
    await tick(app, a.cookie, tacticA, 1);
    await tick(app, a.cookie, tacticA, 2);
    await tick(app, a.cookie, tacticA, 3);
    await setWeek(app, a.cookie, 2);

    const started = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = started.body.id as number;
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({}).expect(200);

    const review = reviewOf(wamId, a.userId);
    expect(review.score_snapshot).toBe(100);
    expect(review.score_finalized_at).not.toBeNull();
  });

  // Finalization is triggered by saving the cycle, but only *moving past* the week means the
  // week is over. Saving any other field while still inside the week must leave the score
  // provisional — otherwise renaming your cycle on a Friday would permanently freeze a
  // half-finished week, which is the exact bug this whole mechanism exists to remove.
  it('does not finalize the week you are still in when the cycle is saved for another reason', async () => {
    const app = freshApp();
    const { a, wamId } = await meetOnFridayThenFinishTheWeek(app);

    await request(app).patch('/api/cycle').set('Cookie', a.cookie).send({ name: 'Renamed' }).expect(200);

    expect(reviewOf(wamId, a.userId)).toEqual({ score_snapshot: 50, score_finalized_at: null });
  });

  it('ignores drafts, which have never frozen a score to finalize', async () => {    const app = freshApp();
    const a = await registerAndLogin(app, 'draft-a@example.com');
    const b = await registerAndLogin(app, 'draft-b@example.com');
    await pair(app, a, b);
    seedPlan(a.userId);
    seedPlan(b.userId);
    const started = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = started.body.id as number;

    await setWeek(app, a.cookie, 3);

    expect(reviewOf(wamId, a.userId)).toEqual({ score_snapshot: null, score_finalized_at: null });
  });

  it('backfills every already-closed week in one pass and reports what changed', async () => {
    const app = freshApp();
    const { a, b, wamId } = await meetOnFridayThenFinishTheWeek(app);
    // Move both cycles on *without* going through the route, so nothing is finalized yet —
    // this is the state the live database is in before the one-off backfill runs.
    getDb().prepare('UPDATE cycles SET current_week = 2').run();

    const changed = finalizeClosedWeekScores(getDb());

    expect(changed).toHaveLength(2);
    expect(changed.every((row) => row.previousScore === 50 && row.finalScore === 100)).toBe(true);
    expect(changed.map((row) => row.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(reviewOf(wamId, a.userId).score_snapshot).toBe(100);
    // Idempotent: a second pass has nothing left to do.
    expect(finalizeClosedWeekScores(getDb())).toHaveLength(0);
  });
});
