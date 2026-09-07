import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb } from '../db.js';

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  return { cookie: extractCookie(res), userId: undefined as number | undefined };
}

describe('cycles, goals, tactics', () => {
  let app: ReturnType<typeof freshApp>;
  let cookie: string;

  beforeEach(async () => {
    app = freshApp();
    ({ cookie } = await registerAndLogin(app, 'owner@a.com'));
  });

  afterAll(() => closeDb());

  it('creates a cycle with week 1 by default and enforces week bounds 1-12', async () => {
    const create = await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'מחזור 1' });
    expect(create.status).toBe(201);
    expect(create.body.current_week).toBe(1);

    const tooHigh = await request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek: 13 });
    expect(tooHigh.status).toBe(400);

    const tooLow = await request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek: 0 });
    expect(tooLow.status).toBe(400);

    const ok = await request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body.current_week).toBe(7);
  });

  it('only allows one active cycle per user', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const second = await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'B' });
    expect(second.status).toBe(409);
  });

  it('enforces a maximum of 3 goals per cycle', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    for (const title of ['G1', 'G2', 'G3']) {
      const res = await request(app).post('/api/goals').set('Cookie', cookie).send({ title });
      expect(res.status).toBe(201);
    }
    const fourth = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G4' });
    expect(fourth.status).toBe(409);
  });

  it('assigns stable distinct colors to goals', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const g1 = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const g2 = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G2' });
    expect(g1.body.color).not.toBe(g2.body.color);
  });

  it('deleting a goal requires confirm:true and cascades to tactics/completions', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'T1', weekdays: [0, 1], startWeek: 1, endWeek: 12 });
    expect(tactic.status).toBe(201);
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', cookie)
      .send({ tacticId: tactic.body.id, week: 1, weekday: 0, done: true });

    const refuse = await request(app).delete(`/api/goals/${goal.body.id}`).set('Cookie', cookie).send({});
    expect(refuse.status).toBe(400);

    const del = await request(app)
      .delete(`/api/goals/${goal.body.id}`)
      .set('Cookie', cookie)
      .send({ confirm: true });
    expect(del.status).toBe(204);

    // Tactic should be gone too (cascade)
    const patchGone = await request(app)
      .patch(`/api/tactics/${tactic.body.id}`)
      .set('Cookie', cookie)
      .send({ title: 'x' });
    expect(patchGone.status).toBe(404);
  });

  it('rejects tactic end week before start week', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const res = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'T', weekdays: [0], startWeek: 5, endWeek: 2 });
    expect(res.status).toBe(400);
  });

  it('applies tactic adaptations next week only or through the remaining cycle without changing past weeks', async () => {
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'Base', weekdays: [0], startWeek: 1, endWeek: 12 });

    const nextWeekOnly = await request(app)
      .put(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie)
      .send({ title: 'Week 2 only', weekdays: [1, 2], scope: 'nextWeek' });
    expect(nextWeekOnly.status).toBe(200);
    expect(nextWeekOnly.body.fromWeek).toBe(2);
    expect(nextWeekOnly.body.throughWeek).toBe(2);

    let dashboard = await request(app)
      .get(`/api/dashboard/${me.body.id}`)
      .set('Cookie', cookie);
    let bundledTactic = dashboard.body.goals[0].tactics[0];
    expect(bundledTactic.overrides).toEqual([
      { week: 2, title: 'Week 2 only', weekdays: [1, 2] },
    ]);
    expect(dashboard.body.weekScores[0].scheduled).toBe(1);
    expect(dashboard.body.weekScores[1].scheduled).toBe(2);
    expect(dashboard.body.weekScores[2].scheduled).toBe(1);

    const overrideDay = await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', cookie)
      .send({ tacticId: tactic.body.id, week: 2, weekday: 1, done: true });
    expect(overrideDay.status).toBe(200);
    const replacedBaseDay = await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', cookie)
      .send({ tacticId: tactic.body.id, week: 2, weekday: 0, done: true });
    expect(replacedBaseDay.status).toBe(400);

    await request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek: 3 });
    const restOfCycle = await request(app)
      .put(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie)
      .send({ title: 'Permanent future', weekdays: [4], scope: 'restOfCycle' });
    expect(restOfCycle.status).toBe(200);
    expect(restOfCycle.body.fromWeek).toBe(4);
    expect(restOfCycle.body.throughWeek).toBe(12);

    dashboard = await request(app)
      .get(`/api/dashboard/${me.body.id}`)
      .set('Cookie', cookie);
    bundledTactic = dashboard.body.goals[0].tactics[0];
    expect(bundledTactic.overrides.find((item: { week: number }) => item.week === 2).title).toBe(
      'Week 2 only'
    );
    expect(bundledTactic.overrides.find((item: { week: number }) => item.week === 4).title).toBe(
      'Permanent future'
    );
    expect(dashboard.body.weekScores[2].scheduled).toBe(1);
    expect(dashboard.body.weekScores[3].scheduled).toBe(1);
  });

  it('undoes only the upcoming week when an adaptation is taken back', async () => {
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'Base', weekdays: [0], startWeek: 1, endWeek: 12 });

    // Week 2 gets tuned during a meeting, then week 3 gets tuned a week later.
    await request(app)
      .put(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie)
      .send({ title: 'Lighter week', weekdays: [1], scope: 'nextWeek' });
    await request(app).patch('/api/cycle').set('Cookie', cookie).send({ currentWeek: 2 });
    await request(app)
      .put(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie)
      .send({ title: 'Heavier week', weekdays: [1, 2, 3], scope: 'nextWeek' });

    const undo = await request(app)
      .delete(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie);
    expect(undo.status).toBe(200);
    expect(undo.body).toEqual({ tacticId: tactic.body.id, week: 3, removed: true });

    const dashboard = await request(app).get(`/api/dashboard/${me.body.id}`).set('Cookie', cookie);
    const bundledTactic = dashboard.body.goals[0].tactics[0];
    // Week 2 already happened under its adaptation, so it keeps it; only week 3 reverts.
    expect(bundledTactic.overrides).toEqual([{ week: 2, title: 'Lighter week', weekdays: [1] }]);
    expect(dashboard.body.weekScores[2].scheduled).toBe(1);

    // Undoing again is harmless — the meeting can be reopened without an error.
    const repeat = await request(app)
      .delete(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie);
    expect(repeat.status).toBe(200);
    expect(repeat.body.removed).toBe(false);
  });

  it('refuses to undo an adaptation on someone else\'s tactic', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'Base', weekdays: [0], startWeek: 1, endWeek: 12 });

    const { cookie: strangerCookie } = await registerAndLogin(app, 'stranger-undo@example.com');
    const response = await request(app)
      .delete(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', strangerCookie);
    expect(response.status).toBe(404);
  });

  it('rejects tactic adaptations after the owning cycle is archived', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'Base', weekdays: [0], startWeek: 1, endWeek: 12 });
    await request(app)
      .post('/api/cycle/reset')
      .set('Cookie', cookie)
      .send({ name: 'B', confirm: true });

    const response = await request(app)
      .put(`/api/tactics/${tactic.body.id}/adaptation`)
      .set('Cookie', cookie)
      .send({ title: 'Forbidden', weekdays: [1], scope: 'nextWeek' });
    expect(response.status).toBe(400);
  });

  it('reset is transactional, confirmed, and wipes goals/tactics/completions', async () => {
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'G1' });
    await request(app)
      .post('/api/tactics')
      .set('Cookie', cookie)
      .send({ goalId: goal.body.id, title: 'T1', weekdays: [0], startWeek: 1, endWeek: 12 });

    const refuse = await request(app).post('/api/cycle/reset').set('Cookie', cookie).send({ name: 'New' });
    expect(refuse.status).toBe(400);

    const reset = await request(app)
      .post('/api/cycle/reset')
      .set('Cookie', cookie)
      .send({ name: 'New Cycle', confirm: true });
    expect(reset.status).toBe(201);
    expect(reset.body.name).toBe('New Cycle');
    expect(reset.body.current_week).toBe(1);

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
    const dash = await request(app).get(`/api/dashboard/${meRes.body.id}`).set('Cookie', cookie);
    expect(dash.body.goals.length).toBe(0);
  });

  it('per-user isolation: two users cycles/goals never leak into each other', async () => {
    const other = await registerAndLogin(app, 'other@a.com');
    await request(app).post('/api/cycle').set('Cookie', cookie).send({ name: 'Owner Cycle' });
    await request(app).post('/api/cycle').set('Cookie', other.cookie).send({ name: 'Other Cycle' });

    const ownerGoal = await request(app).post('/api/goals').set('Cookie', cookie).send({ title: 'Owner Goal' });
    // Other user must not be able to patch owner's goal.
    const forbidden = await request(app)
      .patch(`/api/goals/${ownerGoal.body.id}`)
      .set('Cookie', other.cookie)
      .send({ title: 'hijacked' });
    expect(forbidden.status).toBe(404);
  });
});
