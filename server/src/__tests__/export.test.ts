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

describe('authenticated JSON data export', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('requires authentication', async () => {
    const res = await request(app).get('/api/export');
    expect(res.status).toBe(401);
  });

  it('exports the caller\'s own profile, settings, every cycle (active and archived), and goals/tactics/completions', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 1' });
    const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal 1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goal.body.id, title: 'Tactic 1', weekdays: [0], startWeek: 1, endWeek: 12 });
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: tactic.body.id, week: 1, weekday: 0, done: true });
    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle 2', confirm: true });

    const res = await request(app).get('/api/export').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('a@a.com');
    expect(res.body.settings.theme).toBe('dark');
    expect(res.body.cycles.length).toBe(2);
    const archivedCycle = res.body.cycles.find((c: { name: string }) => c.name === 'Cycle 1');
    expect(archivedCycle.isActive).toBe(false);
    expect(archivedCycle.goals[0].title).toBe('Goal 1');
    expect(archivedCycle.goals[0].tactics[0].title).toBe('Tactic 1');
    expect(archivedCycle.goals[0].tactics[0].completions).toEqual([{ week: 1, weekday: 0, done: true }]);
    expect(res.body.partnership).toBeNull();
    expect(res.body.weeklyAccountabilityMeetings).toEqual([]);
  });

  it('exports safe profile metadata (display name, bio, avatar presence/version, success streak) but never avatar bytes or the password hash', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).patch('/api/profile').set('Cookie', a.cookie).send({ displayName: 'Alice', bio: 'Hi there' });
    await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', a.cookie)
      .set('Content-Type', 'image/png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const res = await request(app).get('/api/export').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: a.userId,
      email: 'a@a.com',
      displayName: 'Alice',
      bio: 'Hi there',
      hasAvatar: true,
      avatarVersion: 1,
      successStreak: 0,
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user).not.toHaveProperty('avatarData');
    expect(res.body.user).not.toHaveProperty('avatar_data');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/password/i);
  });

  it('never includes the partner\'s private goals/tactics/completions, only what the partner already shares via WAM review', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });

    await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'B Secret Cycle' });
    await request(app).post('/api/goals').set('Cookie', b.cookie).send({ title: 'B Private Goal' });
    await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

    const exportA = await request(app).get('/api/export').set('Cookie', a.cookie);
    expect(exportA.status).toBe(200);
    expect(exportA.body.partnership.inviteeEmail).toBe('b@a.com');
    expect(exportA.body.weeklyAccountabilityMeetings.length).toBe(1);
    const serialized = JSON.stringify(exportA.body);
    expect(serialized).not.toContain('B Secret Cycle');
    expect(serialized).not.toContain('B Private Goal');
  });

  it('includes WAM punishment data (label/author/assignee/due-binding/timestamps) in the export', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });

    const wam1 = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const created = await request(app)
      .post(`/api/wams/${wam1.body.id}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש לדוגמה', assignedUserId: b.userId });
    const wam2 = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 2 });
    await request(app)
      .patch(`/api/wams/${wam2.body.id}/due-punishments/${created.body.punishmentId}`)
      .set('Cookie', b.cookie)
      .send({ done: true });

    const exportA = await request(app).get('/api/export').set('Cookie', a.cookie);
    const wamExport = exportA.body.weeklyAccountabilityMeetings.find((w: { id: number }) => w.id === wam1.body.id);
    const punishment = wamExport.punishments[0];
    expect(punishment.label).toBe('עונש לדוגמה');
    expect(punishment.done).toBe(true);
    expect(punishment.authorUserId).toBe(a.userId);
    expect(punishment.isAuthorMe).toBe(true);
    expect(punishment.assignedUserId).toBe(b.userId);
    expect(punishment.isAssignedMe).toBe(false);
    expect(punishment.dueWamId).toBe(wam2.body.id);
    expect(punishment.completedAt).toEqual(expect.any(String));
    expect(punishment.createdAt).toEqual(expect.any(String));
    expect(punishment.updatedAt).toEqual(expect.any(String));
  });
});
