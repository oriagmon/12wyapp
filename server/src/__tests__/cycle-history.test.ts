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

describe('multi-cycle history: archiving, immutability, and browsing', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('archives (never deletes) the previous cycle on reset, and lists it as history', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 1' });
    await request(app).patch('/api/cycle').set('Cookie', a.cookie).send({ currentWeek: 6 });
    const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Old Goal' });
    await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goal.body.id, title: 'Old Tactic', weekdays: [0], startWeek: 1, endWeek: 12 });

    const reset = await request(app)
      .post('/api/cycle/reset')
      .set('Cookie', a.cookie)
      .send({ name: 'Cycle 2', confirm: true });
    expect(reset.status).toBe(201);
    expect(reset.body.name).toBe('Cycle 2');

    const list = await request(app).get(`/api/cycles/${a.userId}`).set('Cookie', a.cookie);
    expect(list.status).toBe(200);
    expect(list.body.cycles.length).toBe(2);
    const archived = list.body.cycles.find((c: { name: string }) => c.name === 'Cycle 1');
    const active = list.body.cycles.find((c: { name: string }) => c.name === 'Cycle 2');
    expect(archived.isActive).toBe(false);
    expect(archived.currentWeek).toBe(6); // frozen at whatever it was when archived
    expect(active.isActive).toBe(true);

    // The archived cycle's goal/tactic data is still fully readable via the history detail view.
    const detail = await request(app)
      .get(`/api/cycles/${a.userId}/${archived.id}`)
      .set('Cookie', a.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.goals[0].title).toBe('Old Goal');
    expect(detail.body.goals[0].tactics[0].title).toBe('Old Tactic');
  });

  it('rejects any edit to goals/tactics/completions belonging to an archived cycle', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 1' });
    const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Old Goal' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goal.body.id, title: 'Old Tactic', weekdays: [0], startWeek: 1, endWeek: 12 });

    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle 2', confirm: true });

    const renameGoal = await request(app)
      .patch(`/api/goals/${goal.body.id}`)
      .set('Cookie', a.cookie)
      .send({ title: 'Renamed' });
    expect(renameGoal.status).toBe(400);

    const deleteGoal = await request(app)
      .delete(`/api/goals/${goal.body.id}`)
      .set('Cookie', a.cookie)
      .send({ confirm: true });
    expect(deleteGoal.status).toBe(400);

    const editTactic = await request(app)
      .patch(`/api/tactics/${tactic.body.id}`)
      .set('Cookie', a.cookie)
      .send({ title: 'x' });
    expect(editTactic.status).toBe(400);

    const deleteTactic = await request(app).delete(`/api/tactics/${tactic.body.id}`).set('Cookie', a.cookie);
    expect(deleteTactic.status).toBe(400);

    const addTacticToOldGoal = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goal.body.id, title: 'New tactic on old goal', weekdays: [1], startWeek: 1, endWeek: 12 });
    expect(addTacticToOldGoal.status).toBe(400);

    const toggleCompletion = await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: tactic.body.id, week: 1, weekday: 0, done: true });
    expect(toggleCompletion.status).toBe(400);
  });

  it('cycle history is readable by a partner (read-only) and denied to unrelated users', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');

    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 1' });
    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle 2', confirm: true });

    // Unrelated user: denied outright.
    const strangerList = await request(app).get(`/api/cycles/${a.userId}`).set('Cookie', stranger.cookie);
    expect(strangerList.status).toBe(403);

    // Direct pairing (no invitation/acceptance step) -> partner can now read (but never write) the history.
    await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });

    const pairedList = await request(app).get(`/api/cycles/${a.userId}`).set('Cookie', b.cookie);
    expect(pairedList.status).toBe(200);
    expect(pairedList.body.cycles.length).toBe(2);
  });

  it('a user can start a brand-new cycle at week 1 immediately after archiving the previous one', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 1' });
    await request(app).patch('/api/cycle').set('Cookie', a.cookie).send({ currentWeek: 12 });
    const reset = await request(app)
      .post('/api/cycle/reset')
      .set('Cookie', a.cookie)
      .send({ name: 'Cycle 2', confirm: true });
    expect(reset.body.current_week).toBe(1);

    const dash = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', a.cookie);
    expect(dash.body.cycle.name).toBe('Cycle 2');
    expect(dash.body.cycle.currentWeek).toBe(1);
    expect(dash.body.goals.length).toBe(0); // fresh cycle starts with no goals of its own
  });
});
