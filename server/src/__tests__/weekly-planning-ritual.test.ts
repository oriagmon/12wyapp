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

async function pair(app: ReturnType<typeof freshApp>, a: { cookie: string }, b: { userId: number }) {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  expect(res.status).toBe(201);
}

describe('weekly planning ritual', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };
  let cycleId: number;

  beforeEach(async () => {
    app = freshApp();
    owner = await registerAndLogin(app, 'owner@a.com');
    const cycle = await request(app).post('/api/cycle').set('Cookie', owner.cookie).send({ name: 'מחזור 1' });
    cycleId = cycle.body.id;
  });

  afterAll(() => closeDb());

  it('returns null for a ritual that was never saved', async () => {
    const res = await request(app).get(`/api/weekly-planning/${cycleId}/2`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access: 'owner', ritual: null });
  });

  it('owner can save a draft, read it back, and idempotently upsert without duplicating rows', async () => {
    const first = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'התמדתי בריצות', improveNext: 'לישון יותר' });
    expect(first.status).toBe(200);
    expect(first.body.ritual.workedWell).toBe('התמדתי בריצות');
    expect(first.body.ritual.improveNext).toBe('לישון יותר');
    expect(first.body.ritual.status).toBe('draft');
    const firstId = first.body.ritual.id;

    // Partial update — only touches the fields provided, keeps the rest.
    const second = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ tacticsReviewed: true });
    expect(second.status).toBe(200);
    expect(second.body.ritual.id).toBe(firstId);
    expect(second.body.ritual.workedWell).toBe('התמדתי בריצות');
    expect(second.body.ritual.tacticsReviewed).toBe(true);

    const read = await request(app).get(`/api/weekly-planning/${cycleId}/2`).set('Cookie', owner.cookie);
    expect(read.status).toBe(200);
    expect(read.body.ritual.id).toBe(firstId);
    expect(read.body.ritual.tacticsReviewed).toBe(true);
  });

  it('rejects completion until tactics-reviewed, weekly focus, and commitment are all present', async () => {
    const noDraft = await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);
    expect(noDraft.status).toBe(400);

    await request(app).put(`/api/weekly-planning/${cycleId}/2`).set('Cookie', owner.cookie).send({});
    const missingAll = await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);
    expect(missingAll.status).toBe(400);

    await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ tacticsReviewed: true, weeklyFocus: 'להתמקד בבריאות' });
    const missingCommitment = await request(app)
      .post(`/api/weekly-planning/${cycleId}/2/complete`)
      .set('Cookie', owner.cookie);
    expect(missingCommitment.status).toBe(400);

    await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ commitment: 'לרוץ שלוש פעמים' });
    const ok = await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.ritual.status).toBe('complete');
    expect(ok.body.ritual.completedAt).not.toBeNull();
  });

  it('completing twice without reopening is rejected, and edits are blocked until reopened', async () => {
    await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ tacticsReviewed: true, weeklyFocus: 'מיקוד', commitment: 'התחייבות' });
    await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);

    const completeAgain = await request(app)
      .post(`/api/weekly-planning/${cycleId}/2/complete`)
      .set('Cookie', owner.cookie);
    expect(completeAgain.status).toBe(409);

    const editAttempt = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ weeklyFocus: 'שינוי' });
    expect(editAttempt.status).toBe(400);

    const reopen = await request(app).post(`/api/weekly-planning/${cycleId}/2/reopen`).set('Cookie', owner.cookie);
    expect(reopen.status).toBe(200);
    expect(reopen.body.ritual.status).toBe('draft');
    expect(reopen.body.ritual.completedAt).toBeNull();
    // Previously saved content survives the reopen.
    expect(reopen.body.ritual.weeklyFocus).toBe('מיקוד');

    const editAfterReopen = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ weeklyFocus: 'שינוי' });
    expect(editAfterReopen.status).toBe(200);
    expect(editAfterReopen.body.ritual.weeklyFocus).toBe('שינוי');

    const reopenAgain = await request(app).post(`/api/weekly-planning/${cycleId}/2/reopen`).set('Cookie', owner.cookie);
    expect(reopenAgain.status).toBe(409);
  });

  it('rejects a target week that is not exactly current_week + 1', async () => {
    const skippedAhead = await request(app)
      .put(`/api/weekly-planning/${cycleId}/3`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'x' });
    expect(skippedAhead.status).toBe(400);

    const completeSkipped = await request(app)
      .post(`/api/weekly-planning/${cycleId}/3/complete`)
      .set('Cookie', owner.cookie);
    expect(completeSkipped.status).toBe(400);

    // Out-of-range params (below 2 or above 12) are rejected before any cycle lookup.
    const tooLow = await request(app).get(`/api/weekly-planning/${cycleId}/1`).set('Cookie', owner.cookie);
    expect(tooLow.status).toBe(400);
    const tooHigh = await request(app).get(`/api/weekly-planning/${cycleId}/13`).set('Cookie', owner.cookie);
    expect(tooHigh.status).toBe(400);
  });

  it('week 12 blocks any attempt to plan a nonexistent week 13', async () => {
    await request(app).patch('/api/cycle').set('Cookie', owner.cookie).send({ currentWeek: 12 });
    const res = await request(app)
      .put(`/api/weekly-planning/${cycleId}/13`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'x' });
    // targetWeek=13 is already outside the 2-12 schema range.
    expect(res.status).toBe(400);

    // Even a targetWeek that is otherwise in-range (2-12) is rejected once the cycle itself
    // has reached its final week 12 — there is no "week 13" to plan, only the current week 12
    // itself, which is not a valid ritual target (never re-targets an already-current week).
    const inRangeButFinished = await request(app)
      .put(`/api/weekly-planning/${cycleId}/12`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'x' });
    expect(inRangeButFinished.status).toBe(400);
    expect(inRangeButFinished.body.error).toMatch(/שבוע 12/);

    const completeInRangeButFinished = await request(app)
      .post(`/api/weekly-planning/${cycleId}/12/complete`)
      .set('Cookie', owner.cookie);
    expect(completeInRangeButFinished.status).toBe(400);
  });

  it('partner has read-only access: can GET but never mutate', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    await pair(app, owner, partner);

    await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'x', tacticsReviewed: true, weeklyFocus: 'מיקוד', commitment: 'התחייבות' });
    await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);

    const read = await request(app).get(`/api/weekly-planning/${cycleId}/2`).set('Cookie', partner.cookie);
    expect(read.status).toBe(200);
    expect(read.body.access).toBe('partner');
    expect(read.body.ritual.status).toBe('complete');

    const write = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', partner.cookie)
      .send({ workedWell: 'hijacked' });
    expect(write.status).toBe(403);

    const reopen = await request(app).post(`/api/weekly-planning/${cycleId}/2/reopen`).set('Cookie', partner.cookie);
    expect(reopen.status).toBe(403);

    const complete = await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', partner.cookie);
    expect(complete.status).toBe(403);
  });

  it('a stranger with no partnership is denied entirely', async () => {
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const read = await request(app).get(`/api/weekly-planning/${cycleId}/2`).set('Cookie', stranger.cookie);
    expect(read.status).toBe(403);
    const write = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', stranger.cookie)
      .send({ workedWell: 'x' });
    expect(write.status).toBe(403);
  });

  it('an archived cycle is immutable — reads keep working but writes are rejected', async () => {
    await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'קודם הארכוב' });
    await request(app).post('/api/cycle/reset').set('Cookie', owner.cookie).send({ name: 'מחזור חדש', confirm: true });

    const read = await request(app).get(`/api/weekly-planning/${cycleId}/2`).set('Cookie', owner.cookie);
    expect(read.status).toBe(200);
    expect(read.body.ritual.workedWell).toBe('קודם הארכוב');

    const write = await request(app)
      .put(`/api/weekly-planning/${cycleId}/2`)
      .set('Cookie', owner.cookie)
      .send({ workedWell: 'ניסיון עריכה' });
    expect(write.status).toBe(400);

    const complete = await request(app).post(`/api/weekly-planning/${cycleId}/2/complete`).set('Cookie', owner.cookie);
    expect(complete.status).toBe(400);

    const reopen = await request(app).post(`/api/weekly-planning/${cycleId}/2/reopen`).set('Cookie', owner.cookie);
    expect(reopen.status).toBe(400);
  });

  it('per-user isolation: another user cannot read or write a cycle they do not own or partner with', async () => {
    const other = await registerAndLogin(app, 'other@a.com');
    const otherCycle = await request(app).post('/api/cycle').set('Cookie', other.cookie).send({ name: 'Other' });

    const crossRead = await request(app)
      .get(`/api/weekly-planning/${otherCycle.body.id}/2`)
      .set('Cookie', owner.cookie);
    expect(crossRead.status).toBe(403);
  });

  it('rejects an invalid or non-existent cycle id', async () => {
    const badId = await request(app).get('/api/weekly-planning/not-a-number/2').set('Cookie', owner.cookie);
    expect(badId.status).toBe(400);

    const missing = await request(app).get('/api/weekly-planning/999999/2').set('Cookie', owner.cookie);
    expect(missing.status).toBe(404);
  });
});
