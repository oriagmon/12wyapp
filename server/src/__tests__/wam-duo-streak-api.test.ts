import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb } from '../db.js';

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

/** Gives a user a cycle with one tactic scheduled on Sunday (weekday 0) for week 1, optionally
 *  marking it complete — the simplest possible lever to get a real (not directly injected)
 *  live/frozen score of exactly 100 or 0 for that week via the real scoring pipeline. */
async function setupWeek1Tactic(app: ReturnType<typeof freshApp>, cookie: string, cycleName: string, complete: boolean) {
  await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: cycleName });
  const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'Goal' });
  const tactic = await request(app)
    .post('/api/tactics')
    .set('Cookie', cookie)
    .send({ goalId: goal.body.id, title: 'Tactic', weekdays: [0], startWeek: 1, endWeek: 12 });
  if (complete) {
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', cookie)
      .send({ tacticId: tactic.body.id, week: 1, weekday: 0, done: true });
  }
}

describe('Duo Streak + celebration API wiring', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  describe('duoStreak in list/detail responses', () => {
    it('is null in the list response when there is no accepted partnership', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
      expect(list.body.duoStreak).toBeNull();
    });

    it('is present with zeroed numbers and both participants when paired but no WAM has ever completed', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
      expect(list.body.duoStreak).toMatchObject({ currentStreak: 0, bestStreak: 0, totalDuoWins: 0, latestDuoSuccess: null });
      expect(list.body.duoStreak.participants).toHaveLength(2);
      const ids = list.body.duoStreak.participants.map((p: { userId: number }) => p.userId).sort((x: number, y: number) => x - y);
      expect(ids).toEqual([a.userId, b.userId].sort((x, y) => x - y));
    });

    it('participant profiles include displayName/email/hasAvatar/avatarVersion, never bio or avatar bytes', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
      const participant = list.body.duoStreak.participants[0];
      expect(participant).toHaveProperty('userId');
      expect(participant).toHaveProperty('displayName');
      expect(participant).toHaveProperty('email');
      expect(participant).toHaveProperty('hasAvatar');
      expect(participant).toHaveProperty('avatarVersion');
      expect(participant).not.toHaveProperty('bio');
      const serialized = JSON.stringify(list.body);
      expect(serialized).not.toMatch(/avatar_data|avatarData/);
    });

    it('the WAM detail response also includes duoStreak', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
      const detail = await request(app).get(`/api/wams/${created.body.id}`).set('Cookie', a.cookie);
      expect(detail.body.duoStreak).toBeTruthy();
      expect(detail.body.duoStreak.participants).toHaveLength(2);
    });

    it('reflects an updated currentStreak in the list after a successful duo completion', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
      await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});

      const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
      expect(list.body.duoStreak.currentStreak).toBe(1);
      expect(list.body.duoStreak.totalDuoWins).toBe(1);
    });
  });

  describe('celebration on POST /:id/complete', () => {
    it('is duo-success when both score >= 85, and includes both profiles/scores plus the post-completion current streak', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const res = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.celebration.type).toBe('duo-success');
      expect(res.body.celebration.currentStreak).toBe(1);
      expect(res.body.celebration.participants).toHaveLength(2);
      const scores = res.body.celebration.participants.map((p: { score: number }) => p.score).sort();
      expect(scores).toEqual([100, 100]);
      const userIds = res.body.celebration.participants.map((p: { userId: number }) => p.userId).sort((x: number, y: number) => x - y);
      expect(userIds).toEqual([a.userId, b.userId].sort((x, y) => x - y));
    });

    it('is spotlight when one score is strictly higher and not both >= 85, naming the winner and the other', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true); // A: 100
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', false); // B: 0 (scheduled but never completed)
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const res = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.celebration.type).toBe('spotlight');
      expect(res.body.celebration.winner.userId).toBe(a.userId);
      expect(res.body.celebration.winner.score).toBe(100);
      expect(res.body.celebration.other.userId).toBe(b.userId);
      expect(res.body.celebration.other.score).toBe(0);
    });

    it('is spotlight for the reverse orientation too (b strictly higher)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', false); // A: 0
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true); // B: 100
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const res = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(res.body.celebration.type).toBe('spotlight');
      expect(res.body.celebration.winner.userId).toBe(b.userId);
      expect(res.body.celebration.other.userId).toBe(a.userId);
    });

    it('is tie for exact equal scores below the duo-success threshold', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', false); // A: 0
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', false); // B: 0
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const res = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(res.body.celebration.type).toBe('tie');
      expect(res.body.celebration.participants).toHaveLength(2);
      expect(res.body.celebration.participants.every((p: { score: number }) => p.score === 0)).toBe(true);
    });

    it('is completion (fallback) when either score is unavailable (no cycle at all)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true); // A: 100, B: no cycle -> null
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const res = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(res.body.celebration).toEqual({ type: 'completion' });
    });

    it('never appears on GET /:id, even immediately after a successful completion (only the mutation response carries it)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
      await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});

      const reloaded = await request(app).get(`/api/wams/${created.body.id}`).set('Cookie', a.cookie);
      expect(reloaded.body).not.toHaveProperty('celebration');
    });

    it('never appears in the list response either', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
      await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});

      const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
      expect(JSON.stringify(list.body)).not.toContain('celebration');
    });

    it('a failed completion attempt (already complete) never returns a celebration', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
      await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});

      const secondAttempt = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(secondAttempt.status).toBe(409);
      expect(secondAttempt.body).not.toHaveProperty('celebration');
    });

    it('reopen + successful recompletion celebrates again (a fresh celebration each time)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setupWeek1Tactic(app, a.cookie, 'Cycle A', true);
      await setupWeek1Tactic(app, b.cookie, 'Cycle B', true);
      const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

      const first = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(first.body.celebration.type).toBe('duo-success');

      await request(app).post(`/api/wams/${created.body.id}/reopen`).set('Cookie', a.cookie);
      const second = await request(app).post(`/api/wams/${created.body.id}/complete`).set('Cookie', a.cookie).send({});
      expect(second.status).toBe(200);
      expect(second.body.celebration.type).toBe('duo-success');
    });
  });
});
