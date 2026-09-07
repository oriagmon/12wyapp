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

describe('direct pairing and cross-user authorization', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('lists every other registered user as a discoverable pairing candidate', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await registerAndLogin(app, 'c@a.com');

    const res = await request(app).get('/api/partnerships/candidates').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    const emails = res.body.users.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(['b@a.com', 'c@a.com']);
    // Never includes the caller themself.
    expect(emails).not.toContain('a@a.com');
    expect(res.body.users[0]).toHaveProperty('id');
  });

  it('rejects self-pairing', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const res = await request(app)
      .post('/api/partnerships/pair')
      .set('Cookie', a.cookie)
      .send({ targetUserId: a.userId });
    expect(res.status).toBe(400);
  });

  it('rejects pairing with a non-existent user id', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: 999999 });
    expect(res.status).toBe(404);
  });

  it('selecting a candidate creates an immediate mutual partnership — no invitation/acceptance step', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');

    const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
    expect(res.status).toBe(201);
    expect(res.body.partner.email).toBe('b@a.com');

    // Immediately visible and mutual from both sides, with no pending state at all.
    const fromA = await request(app).get('/api/partnerships').set('Cookie', a.cookie);
    expect(fromA.body.partner.email).toBe('b@a.com');
    const fromB = await request(app).get('/api/partnerships').set('Cookie', b.cookie);
    expect(fromB.body.partner.email).toBe('a@a.com');
  });

  it('grants mutual read-only partner access immediately, and neither can modify the other\'s data', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'A Cycle' });
    const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Read Goal' });

    await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });

    const bReadsA = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', b.cookie);
    expect(bReadsA.status).toBe(200);
    expect(bReadsA.body.access).toBe('partner');
    expect(bReadsA.body.goals[0].title).toBe('Read Goal');

    const aReadsSelf = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', a.cookie);
    expect(aReadsSelf.body.access).toBe('owner');

    const hijack = await request(app)
      .patch(`/api/goals/${goal.body.id}`)
      .set('Cookie', b.cookie)
      .send({ title: 'hijacked' });
    expect(hijack.status).toBe(404);

    const bOwnDash = await request(app).get(`/api/dashboard/${b.userId}`).set('Cookie', a.cookie);
    expect(bOwnDash.body.access).toBe('partner');
    expect(bOwnDash.body.cycle).toBeNull();
  });

  it('denies dashboard access to a fully unrelated user', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'A Cycle' });

    const strangerDash = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', stranger.cookie);
    expect(strangerDash.status).toBe(403);
  });

  it('enforces one partner maximum for both the chooser and the chosen user, transactionally', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const c = await registerAndLogin(app, 'c@a.com');

    await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });

    // a already has a partner -> pairing with a third user is rejected.
    const secondPair = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: c.userId });
    expect(secondPair.status).toBe(409);

    // c tries to pick a, but a is already taken (by b) -> rejected from the other direction too.
    const thirdPair = await request(app).post('/api/partnerships/pair').set('Cookie', c.cookie).send({ targetUserId: a.userId });
    expect(thirdPair.status).toBe(409);

    // b (already paired with a) cannot be selected by c either.
    const fourthPair = await request(app).post('/api/partnerships/pair').set('Cookie', c.cookie).send({ targetUserId: b.userId });
    expect(fourthPair.status).toBe(409);

    // c remains free to pair with a brand-new, unpaired user.
    const d = await registerAndLogin(app, 'd@a.com');
    const fifthPair = await request(app).post('/api/partnerships/pair').set('Cookie', c.cookie).send({ targetUserId: d.userId });
    expect(fifthPair.status).toBe(201);
  });

  it('removing a partnership immediately revokes access for both sides', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'A Cycle' });
    const paired = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
    const partnershipId = paired.body.partner.partnershipId;

    const beforeRemoval = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', b.cookie);
    expect(beforeRemoval.status).toBe(200);

    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', b.cookie);

    const afterRemoval = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', b.cookie);
    expect(afterRemoval.status).toBe(403);

    // And both users are free to pair again afterward.
    const c = await registerAndLogin(app, 'c@a.com');
    const rePair = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: c.userId });
    expect(rePair.status).toBe(201);
  });

  it('rejects removal by a user who is not part of the partnership', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const paired = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
    const partnershipId = paired.body.partner.partnershipId;

    const res = await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', stranger.cookie);
    expect(res.status).toBe(403);
  });
});
