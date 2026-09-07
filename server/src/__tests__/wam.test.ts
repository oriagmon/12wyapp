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

async function pairUsers(app: ReturnType<typeof freshApp>, a: { cookie: string; userId: number }, b: { cookie: string; userId: number }) {
  const res = await request(app)
    .post('/api/partnerships/pair')
    .set('Cookie', a.cookie)
    .send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

describe('Weekly Accountability Meetings (WAMs)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('requires an accepted partnership to create a WAM', async () => {
    const a = await registerAndLogin(app, 'solo@a.com');
    const res = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 3 });
    expect(res.status).toBe(409);
  });

  it('creates exactly one shared WAM per partnership per week (idempotent create)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    const first = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 5 });
    expect(first.status).toBe(201);
    const wamId = first.body.id;

    // Same user creating again for the same week returns the existing meeting, not a duplicate.
    const second = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 5 });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(wamId);

    // The partner creating for the same week also gets the same shared meeting.
    const third = await request(app).post('/api/wams').set('Cookie', b.cookie).send({ week: 5 });
    expect(third.status).toBe(200);
    expect(third.body.id).toBe(wamId);

    const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
    expect(list.body.wams.filter((w: { week: number }) => w.week === 5).length).toBe(1);
  });

  it('allows both partners to mutually edit shared content fields', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const patchA = await request(app)
      .patch(`/api/wams/${wamId}`)
      .set('Cookie', a.cookie)
      .send({ wins: 'ניצחונות של A' });
    expect(patchA.status).toBe(200);
    expect(patchA.body.wins).toBe('ניצחונות של A');

    const patchB = await request(app)
      .patch(`/api/wams/${wamId}`)
      .set('Cookie', b.cookie)
      .send({ misses: 'החמצות לפי B', notes: 'הערה משותפת' });
    expect(patchB.status).toBe(200);
    expect(patchB.body.misses).toBe('החמצות לפי B');
    expect(patchB.body.wins).toBe('ניצחונות של A'); // previous edit preserved
    expect(patchB.body.notes).toBe('הערה משותפת');
  });

  it('lets each participant edit only their own rating, while both ratings stay visible', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const ratedA = await request(app).patch(`/api/wams/${wamId}/rating`).set('Cookie', a.cookie).send({ rating: 8 });
    expect(ratedA.status).toBe(200);
    expect(ratedA.body.reviews.a.rating).toBe(8);
    expect(ratedA.body.reviews.b.rating).toBeNull();

    const ratedB = await request(app).patch(`/api/wams/${wamId}/rating`).set('Cookie', b.cookie).send({ rating: 4 });
    expect(ratedB.status).toBe(200);
    // A's rating from earlier is untouched, and both are now visible together.
    expect(ratedB.body.reviews.a.rating).toBe(8);
    expect(ratedB.body.reviews.b.rating).toBe(4);

    // Out-of-range ratings are rejected.
    const invalid = await request(app).patch(`/api/wams/${wamId}/rating`).set('Cookie', a.cookie).send({ rating: 11 });
    expect(invalid.status).toBe(400);
  });

  it('freezes both score snapshots on completion; later completion edits do not change the frozen snapshot', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    // Give A a tactic scheduled on Sunday (weekday 0) for week 1, complete it -> 100.
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const goalA = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
    const tacticA = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goalA.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: tacticA.body.id, week: 1, weekday: 0, done: true });

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    expect(created.body.reviews.a.live.score).toBe(100);
    expect(created.body.reviews.a.scoreSnapshot).toBeNull();

    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', b.cookie);
    expect(completed.status).toBe(200);
    expect(completed.body.wam.status).toBe('complete');
    expect(completed.body.wam.reviews.a.scoreSnapshot).toBe(100);

    // Completing again without reopening is rejected.
    const doubleComplete = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie);
    expect(doubleComplete.status).toBe(409);

    // Now un-complete the tactic for week 1 -> live score drops to 0, but the frozen snapshot must stay 100.
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: tacticA.body.id, week: 1, weekday: 0, done: false });

    const afterEdit = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(afterEdit.body.reviews.a.scoreSnapshot).toBe(100); // frozen, unchanged
    expect(afterEdit.body.reviews.a.live.score).toBe(0); // live reflects the new state

    // Content edits are blocked while complete; reopening unblocks them.
    const blockedEdit = await request(app).patch(`/api/wams/${wamId}`).set('Cookie', a.cookie).send({ wins: 'x' });
    expect(blockedEdit.status).toBe(400);

    const reopened = await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('draft');

    const editAfterReopen = await request(app).patch(`/api/wams/${wamId}`).set('Cookie', a.cookie).send({ wins: 'x' });
    expect(editAfterReopen.status).toBe(200);
    expect(editAfterReopen.body.wins).toBe('x');
  });

  it('surfaces a mismatch warning when the two partners are on different current weeks, without ever auto-syncing them', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle B' });
    await request(app).patch('/api/cycle').set('Cookie', a.cookie).send({ currentWeek: 3 });
    // B stays on week 1.

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    expect(created.body.mismatch).toBe(true);
    expect(created.body.reviews.a.live.currentWeek).toBe(3);
    expect(created.body.reviews.b.live.currentWeek).toBe(1);

    // Confirm neither user's cycle was mutated by creating/viewing the WAM.
    const aCycle = await request(app).get(`/api/dashboard/${a.userId}`).set('Cookie', a.cookie);
    const bCycle = await request(app).get(`/api/dashboard/${b.userId}`).set('Cookie', b.cookie);
    expect(aCycle.body.cycle.currentWeek).toBe(3);
    expect(bCycle.body.cycle.currentWeek).toBe(1);
  });

  it('denies access to unrelated users', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');

    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const strangerRead = await request(app).get(`/api/wams/${wamId}`).set('Cookie', stranger.cookie);
    expect(strangerRead.status).toBe(404);
    const strangerPatch = await request(app).patch(`/api/wams/${wamId}`).set('Cookie', stranger.cookie).send({ wins: 'x' });
    expect(strangerPatch.status).toBe(404);
  });

  it('immediately revokes WAM access when the partnership is removed', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const beforeRemoval = await request(app).get(`/api/wams/${wamId}`).set('Cookie', b.cookie);
    expect(beforeRemoval.status).toBe(200);

    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', b.cookie);

    const afterRemovalA = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    const afterRemovalB = await request(app).get(`/api/wams/${wamId}`).set('Cookie', b.cookie);
    expect(afterRemovalA.status).toBe(404);
    expect(afterRemovalB.status).toBe(404);
  });

  it('commitments: either partner can add/edit/toggle any item, labeled a/b/shared', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const addByA = await request(app)
      .post(`/api/wams/${wamId}/commitments`)
      .set('Cookie', a.cookie)
      .send({ label: 'משימה של A', scope: 'a' });
    expect(addByA.status).toBe(201);
    const commitmentId = addByA.body.commitmentId;

    // B can toggle/edit A's labeled commitment.
    const toggledByB = await request(app)
      .patch(`/api/wams/${wamId}/commitments/${commitmentId}`)
      .set('Cookie', b.cookie)
      .send({ done: true });
    expect(toggledByB.status).toBe(200);
    expect(toggledByB.body.commitments[0].done).toBe(true);

    const addShared = await request(app)
      .post(`/api/wams/${wamId}/commitments`)
      .set('Cookie', b.cookie)
      .send({ label: 'משימה משותפת', scope: 'shared' });
    expect(addShared.status).toBe(201);
    expect(addShared.body.wam.commitments.length).toBe(2);

    // Toggling remains allowed even after the meeting is completed...
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie);
    const toggleAfterComplete = await request(app)
      .patch(`/api/wams/${wamId}/commitments/${commitmentId}`)
      .set('Cookie', a.cookie)
      .send({ done: false });
    expect(toggleAfterComplete.status).toBe(200);

    // ...but adding a new commitment or editing its label/scope requires reopening first.
    const blockedAdd = await request(app)
      .post(`/api/wams/${wamId}/commitments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עוד משימה', scope: 'b' });
    expect(blockedAdd.status).toBe(400);
    const blockedEdit = await request(app)
      .patch(`/api/wams/${wamId}/commitments/${commitmentId}`)
      .set('Cookie', a.cookie)
      .send({ label: 'טקסט חדש' });
    expect(blockedEdit.status).toBe(400);
  });

  it('goal/tactic adjustments from a WAM still go through the normal owner-only API: partners can never edit each other\'s goals', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });

    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const goalA = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });

    // A can edit their own goal...
    const ownEdit = await request(app).patch(`/api/goals/${goalA.body.id}`).set('Cookie', a.cookie).send({ title: 'Renamed' });
    expect(ownEdit.status).toBe(200);

    // ...but B (the accepted partner) can never edit it, even from within the shared WAM flow.
    const partnerEdit = await request(app).patch(`/api/goals/${goalA.body.id}`).set('Cookie', b.cookie).send({ title: 'Hijacked' });
    expect(partnerEdit.status).toBe(404);
  });

  it('a WAM becomes permanently read-only history once either referenced cycle is archived, and starting a new cycle produces a fresh, independent meeting for the same week number', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A1' });
    await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle B1' });

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    expect(created.status).toBe(201);
    const wamId = created.body.id;
    await request(app).patch(`/api/wams/${wamId}`).set('Cookie', a.cookie).send({ wins: 'ניצחון ראשון' });

    // A archives their cycle (starts a new one) — the old meeting must now be fully locked.
    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle A2', confirm: true });

    const detailAfterArchive = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(detailAfterArchive.status).toBe(200);
    expect(detailAfterArchive.body.isHistorical).toBe(true);
    expect(detailAfterArchive.body.wins).toBe('ניצחון ראשון'); // still fully readable

    const blockedPatch = await request(app).patch(`/api/wams/${wamId}`).set('Cookie', b.cookie).send({ wins: 'x' });
    expect(blockedPatch.status).toBe(400);
    const blockedRating = await request(app).patch(`/api/wams/${wamId}/rating`).set('Cookie', a.cookie).send({ rating: 5 });
    expect(blockedRating.status).toBe(400);
    const blockedComplete = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', b.cookie);
    expect(blockedComplete.status).toBe(400);
    const blockedCommitment = await request(app)
      .post(`/api/wams/${wamId}/commitments`)
      .set('Cookie', a.cookie)
      .send({ label: 'x', scope: 'shared' });
    expect(blockedCommitment.status).toBe(400);

    // Starting week 1 again now creates a brand-new meeting (A is on Cycle A2), independent
    // of the old, now-historical one — never colliding with or reinterpreting it.
    const secondCreate = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    expect(secondCreate.status).toBe(201);
    expect(secondCreate.body.id).not.toBe(wamId);
    expect(secondCreate.body.wins).toBe(''); // fresh meeting, no leaked content from the old one
    expect(secondCreate.body.isHistorical).toBe(false);

    // Both meetings remain visible side by side in the shared history list.
    const list = await request(app).get('/api/wams').set('Cookie', b.cookie);
    const week1Entries = list.body.wams.filter((w: { week: number }) => w.week === 1);
    expect(week1Entries.length).toBe(2);
  });
});
