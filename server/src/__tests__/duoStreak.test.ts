import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { computeDuoStreak, classifyWamOutcome, DUO_STREAK_THRESHOLD } from '../lib/duoStreak.js';

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(
  app: ReturnType<typeof freshApp>,
  a: { cookie: string; userId: number },
  b: { cookie: string; userId: number }
) {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

async function createWam(app: ReturnType<typeof freshApp>, cookie: string, week: number) {
  const res = await request(app).post('/api/wams').set('Cookie', cookie).send({ week });
  return res.body.id as number;
}

/** Directly forces a completed WAM's frozen review scores in the DB — bypassing the real
 *  scoring pipeline (goals/tactics/completions) entirely, so each streak scenario can set up
 *  exact, deterministic scores without needing to construct a full week of real actions. This
 *  is legitimate here because `computeDuoStreak` itself only ever reads
 *  `wams.status`/`wam_reviews.score_snapshot` — the exact same columns the real completion
 *  route freezes — so it is agnostic to how those columns got populated. */
function forceCompletedWam(
  wamId: number,
  initiatorId: number,
  inviteeId: number,
  scoreA: number | null,
  scoreB: number | null
) {
  const db = getDb();
  db.prepare(`UPDATE wams SET status = 'complete', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
    wamId
  );
  db.prepare('UPDATE wam_reviews SET score_snapshot = ? WHERE wam_id = ? AND user_id = ?').run(scoreA, wamId, initiatorId);
  db.prepare('UPDATE wam_reviews SET score_snapshot = ? WHERE wam_id = ? AND user_id = ?').run(scoreB, wamId, inviteeId);
}

describe('classifyWamOutcome (pure)', () => {
  it('is duo-success when both scores are exactly the threshold', () => {
    expect(classifyWamOutcome(85, 85)).toBe('duo-success');
  });

  it('is duo-success when both scores are above the threshold, even if unequal', () => {
    expect(classifyWamOutcome(90, 86)).toBe('duo-success');
  });

  it('is spotlight-a when a is just below threshold and b is at or above, with a strictly higher', () => {
    expect(classifyWamOutcome(85, 84)).toBe('spotlight-a');
  });

  it('is spotlight-b when b is strictly higher and neither both clear the threshold', () => {
    expect(classifyWamOutcome(84, 85)).toBe('spotlight-b');
  });

  it('is tie for exact equal scores below the threshold', () => {
    expect(classifyWamOutcome(60, 60)).toBe('tie');
  });

  it('is duo-success for equal scores that are both >= threshold (never tie)', () => {
    expect(classifyWamOutcome(85, 85)).toBe('duo-success');
    expect(classifyWamOutcome(100, 100)).toBe('duo-success');
  });

  it('is completion when either score is null', () => {
    expect(classifyWamOutcome(null, 90)).toBe('completion');
    expect(classifyWamOutcome(90, null)).toBe('completion');
    expect(classifyWamOutcome(null, null)).toBe('completion');
  });

  it('DUO_STREAK_THRESHOLD is 85', () => {
    expect(DUO_STREAK_THRESHOLD).toBe(85);
  });
});

describe('computeDuoStreak (pure, over realistic WAM fixtures)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('returns all-zero/null defaults when there is no partnership or no completed WAMs yet', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary).toEqual({ currentStreak: 0, bestStreak: 0, totalDuoWins: 0, latestDuoSuccess: null });
  });

  it('a single successful WAM (both exactly 85) yields streak 1 and total 1', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 85, 85);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(1);
    expect(summary.bestStreak).toBe(1);
    expect(summary.totalDuoWins).toBe(1);
    expect(summary.latestDuoSuccess).toMatchObject({ wamId: wam1, week: 1, scoreA: 85, scoreB: 85 });
  });

  it('84/85 (one just under threshold) is not a success', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 84, 85);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(0);
    expect(summary.totalDuoWins).toBe(0);
    expect(summary.latestDuoSuccess).toBeNull();
  });

  it('both strictly above 85 is a success', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 92, 97);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(1);
  });

  it('repeated completed successes accumulate current/best/total correctly', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    const wam2 = await createWam(app, a.cookie, 2);
    const wam3 = await createWam(app, a.cookie, 3);
    forceCompletedWam(wam1, a.userId, b.userId, 90, 90);
    forceCompletedWam(wam2, a.userId, b.userId, 86, 88);
    forceCompletedWam(wam3, a.userId, b.userId, 95, 85);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(3);
    expect(summary.bestStreak).toBe(3);
    expect(summary.totalDuoWins).toBe(3);
    expect(summary.latestDuoSuccess?.wamId).toBe(wam3);
  });

  it('a failing middle WAM breaks the streak, restarting the run afterward', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    const wam2 = await createWam(app, a.cookie, 2);
    const wam3 = await createWam(app, a.cookie, 3);
    const wam4 = await createWam(app, a.cookie, 4);
    forceCompletedWam(wam1, a.userId, b.userId, 90, 90); // success
    forceCompletedWam(wam2, a.userId, b.userId, 90, 90); // success
    forceCompletedWam(wam3, a.userId, b.userId, 50, 90); // fails — breaks the streak
    forceCompletedWam(wam4, a.userId, b.userId, 88, 88); // success again, new run of 1

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(1); // only the trailing run counts as "current"
    expect(summary.bestStreak).toBe(2); // the earlier 2-run is still the best ever
    expect(summary.totalDuoWins).toBe(3); // wam1, wam2, wam4
    expect(summary.latestDuoSuccess?.wamId).toBe(wam4);
  });

  it('draft WAMs between/after completed ones are ignored entirely — a trailing draft never erases the streak', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 90, 90);
    await createWam(app, a.cookie, 2); // a fresh trailing draft, never completed

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(1);
    expect(summary.latestDuoSuccess?.wamId).toBe(wam1);
  });

  it('reopening a completed WAM removes it from the derivation until it is completed again', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 90, 90);
    expect(computeDuoStreak(getDb(), partnershipId, a.userId, b.userId).currentStreak).toBe(1);

    await request(app).post(`/api/wams/${wam1}/reopen`).set('Cookie', a.cookie);
    const whileReopened = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(whileReopened.currentStreak).toBe(0);
    expect(whileReopened.totalDuoWins).toBe(0);
    expect(whileReopened.latestDuoSuccess).toBeNull();

    forceCompletedWam(wam1, a.userId, b.userId, 92, 92); // recompleted with a fresh snapshot
    const afterRecomplete = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(afterRecomplete.currentStreak).toBe(1);
    expect(afterRecomplete.latestDuoSuccess?.scoreA).toBe(92);
  });

  it('a reversed partnership orientation (b is initiator) still classifies correctly regardless of argument order', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    // b pairs with a — b becomes the initiator this time.
    const partnershipId = await pairUsers(app, b, a);
    const wam1 = await createWam(app, b.cookie, 1);
    forceCompletedWam(wam1, b.userId, a.userId, 90, 86);

    const summary = computeDuoStreak(getDb(), partnershipId, b.userId, a.userId);
    expect(summary.currentStreak).toBe(1);
  });

  it('an exact tie below the threshold is never counted as a duo success', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, 60, 60);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(0);
    expect(summary.totalDuoWins).toBe(0);
  });

  it('a null score (no cycle / nothing scheduled) is never a success', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam1, a.userId, b.userId, null, 90);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(0);
    expect(summary.totalDuoWins).toBe(0);
  });

  it('history order follows WAM id, not week number — remains correct across a cycle reset with reused week numbers', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle B' });
    const wam1 = await createWam(app, a.cookie, 12);
    forceCompletedWam(wam1, a.userId, b.userId, 90, 90);

    // Reset both cycles — a brand-new week 1 WAM is created next, reusing week number 1 in a
    // totally new cycle generation, but with a strictly later WAM id.
    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle A2', confirm: true });
    await request(app).post('/api/cycle/reset').set('Cookie', b.cookie).send({ name: 'Cycle B2', confirm: true });
    const wam2 = await createWam(app, a.cookie, 1);
    forceCompletedWam(wam2, a.userId, b.userId, 88, 88);

    const summary = computeDuoStreak(getDb(), partnershipId, a.userId, b.userId);
    expect(summary.currentStreak).toBe(2); // continues seamlessly across the cycle reset
    expect(summary.bestStreak).toBe(2);
    expect(summary.latestDuoSuccess?.wamId).toBe(wam2);
  });
});
