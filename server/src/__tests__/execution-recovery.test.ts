import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

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
): Promise<number> {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

async function createCycle(app: ReturnType<typeof freshApp>, owner: { cookie: string }, name = 'Cycle') {
  const res = await request(app).post('/api/cycle').set('Cookie', owner.cookie).send({ name });
  return res.body as { id: number; current_week: number };
}

async function createTactic(
  app: ReturnType<typeof freshApp>,
  owner: { cookie: string },
  values: { title: string; weekdays: number[]; startWeek: number; endWeek: number }
) {
  const goal = await request(app).post('/api/goals').set('Cookie', owner.cookie).send({ title: 'Goal' });
  const tactic = await request(app)
    .post('/api/tactics')
    .set('Cookie', owner.cookie)
    .send({ goalId: goal.body.id, ...values });
  return tactic.body as { id: number; weekdays: string; startWeek: number; endWeek: number; title: string };
}

describe('execution recovery: GET risk + plan', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('returns nulls gracefully when the owner has no active cycle', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const res = await request(app).get(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access: 'owner', cycle: null, risk: null, plan: null });
  });

  it('owner sees risk + plan for their own active cycle', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const cycle = await createCycle(app, a);
    await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2, 3, 4, 5, 6], startWeek: 1, endWeek: 12 });

    const res = await request(app).get(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.access).toBe('owner');
    expect(res.body.cycle).toEqual({ id: cycle.id, week: 1 });
    expect(res.body.risk.totalScheduled).toBe(7); // scheduled every day of the week
    expect(res.body.plan).toBeNull();
  });

  it('an accepted partner can read the same risk/plan, read-only', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await createCycle(app, a);

    const res = await request(app).get(`/api/execution-recovery/${a.userId}`).set('Cookie', b.cookie);
    expect(res.status).toBe(200);
    expect(res.body.access).toBe('partner');
    expect(res.body.risk).not.toBeNull();
  });

  it('a stranger (no partnership) is denied', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await createCycle(app, a);
    const res = await request(app).get(`/api/execution-recovery/${a.userId}`).set('Cookie', stranger.cookie);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid userId', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const res = await request(app).get('/api/execution-recovery/not-a-number').set('Cookie', a.cookie);
    expect(res.status).toBe(400);
  });
});

describe('execution recovery: maneuver plan (PUT / resolve / reopen)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('owner creates a maneuver plan; rejects an empty note', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);

    const empty = await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: '   ' });
    expect(empty.status).toBe(400);

    const res = await request(app)
      .put(`/api/execution-recovery/${a.userId}`)
      .set('Cookie', a.cookie)
      .send({ note: 'לדבר עם השותף ולתאם זמן נוסף בסוף השבוע' });
    expect(res.status).toBe(200);
    expect(res.body.access).toBe('owner');
    expect(res.body.plan).toMatchObject({
      strategy: 'maneuver',
      note: 'לדבר עם השותף ולתאם זמן נוסף בסוף השבוע',
      status: 'active',
      resolvedAt: null,
    });
  });

  it('a partner cannot create/edit a plan (read-only)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await createCycle(app, a);

    const res = await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', b.cookie).send({ note: 'ניסיון עריכה' });
    expect(res.status).toBe(403);
  });

  it('a stranger cannot create/edit a plan', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await createCycle(app, a);
    const res = await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', stranger.cookie).send({ note: 'x' });
    expect(res.status).toBe(403);
  });

  it('one plan per cycle/week: a second PUT updates the same row rather than creating a new one', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'טיוטה ראשונה' });
    const second = await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'טיוטה מעודכנת' });
    expect(second.body.plan.note).toBe('טיוטה מעודכנת');

    const count = getDb().prepare('SELECT COUNT(*) as count FROM execution_recovery_plans').get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('editing an already-resolved plan requires reopening it first', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך ראשוני' });
    await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);

    const editAttempt = await request(app)
      .put(`/api/execution-recovery/${a.userId}`)
      .set('Cookie', a.cookie)
      .send({ note: 'ניסיון עריכה אחרי פתרון' });
    expect(editAttempt.status).toBe(400);

    await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    const afterReopen = await request(app)
      .put(`/api/execution-recovery/${a.userId}`)
      .set('Cookie', a.cookie)
      .send({ note: 'עריכה אחרי פתיחה מחדש' });
    expect(afterReopen.status).toBe(200);
    expect(afterReopen.body.plan.note).toBe('עריכה אחרי פתיחה מחדש');
  });

  it('resolve requires an existing plan (404) and is rejected if already resolved (409)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const noPlan = await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);
    expect(noPlan.status).toBe(404);

    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך' });
    const firstResolve = await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);
    expect(firstResolve.status).toBe(200);
    expect(firstResolve.body.plan.status).toBe('resolved');
    expect(typeof firstResolve.body.plan.resolvedAt).toBe('string');

    const secondResolve = await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);
    expect(secondResolve.status).toBe(409);
  });

  it('reopen requires an existing plan (404) and is rejected if already active (409)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const noPlan = await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    expect(noPlan.status).toBe(404);

    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך' });
    const stillActive = await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    expect(stillActive.status).toBe(409);
  });

  it('a resolved plan remains readable via GET as retained history (never deleted/hidden)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך' });
    await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);

    const res = await request(app).get(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie);
    expect(res.body.plan.status).toBe('resolved');
    expect(res.body.plan.note).toBe('מהלך');
  });

  it('an archived cycle is immutable: no active cycle means the mutation endpoints have nothing to act on', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'New cycle', confirm: true });

    // The user now has a brand-new active cycle (week 1, no plan yet) — the *old* (now
    // archived) cycle's plan, if any, is simply unreachable through this router at all.
    const res = await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך' });
    expect(res.status).toBe(200); // succeeds against the NEW active cycle, not the archived one
    const plans = getDb().prepare('SELECT cycle_id FROM execution_recovery_plans').all() as { cycle_id: number }[];
    expect(plans.length).toBe(1); // only the new cycle's plan exists
  });
});

describe('execution recovery: reduce-next-week (transactional adjustment)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('requires ownership (partner/stranger denied)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await createCycle(app, a);
    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', b.cookie)
      .send({ tactics: [] });
    expect(res.status).toBe(403);
  });

  it('rejects when the cycle is already at week 12 (only maneuver is available)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).patch('/api/cycle').set('Cookie', a.cookie).send({ currentWeek: 12 });
    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a selection missing one of next week\'s effective tactics', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    await createTactic(app, a, { title: 'T2', weekdays: [3, 4], startWeek: 1, endWeek: 12 });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] }); // T2 missing
    expect(res.status).toBe(400);
  });

  it('rejects a selection with an extra/unrelated tacticId', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }, { tacticId: 999999, weekdays: [1] }] });
    expect(res.status).toBe(400);
  });

  it('rejects a selection that does not strictly decrease the total scheduled count', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    const same = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0, 1, 2] }] }); // unchanged, not a reduction
    expect(same.status).toBe(400);

    const increased = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0, 1, 2, 3] }] });
    expect(increased.status).toBe(400);
  });

  it('rejects a selection that would leave zero total scheduled occurrences overall', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1], startWeek: 1, endWeek: 12 });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [] }] }); // removes the only tactic entirely
    expect(res.status).toBe(400);
  });

  it('successfully applies a valid reduction: upserts tactic_week_overrides for next week only, records a resolved plan with a before/after snapshot, and never touches the base tactic/current/past/later weeks', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const cycle = await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2, 3, 4], startWeek: 1, endWeek: 12 });
    const t2 = await createTactic(app, a, { title: 'T2', weekdays: [5, 6], startWeek: 1, endWeek: 12 });

    // Some current-week (week 1) completions/history that must remain untouched.
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: t1.id, week: 1, weekday: 0, done: true });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({
        note: 'מצמצם את השבוע הבא',
        tactics: [
          { tacticId: t1.id, weekdays: [0, 1] }, // 5 -> 2
          { tacticId: t2.id, weekdays: [5] }, // 2 -> 1
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({
      strategy: 'reduce_next_week',
      status: 'resolved',
      note: 'מצמצם את השבוע הבא',
      week: 1, // the AT-RISK week (current week), not the target week being adjusted
    });
    expect(res.body.plan.resolvedAt).not.toBeNull();
    expect(res.body.plan.adjustment).toMatchObject({ targetWeek: 2 });

    const db = getDb();
    // Base tactics are completely unchanged.
    const baseT1 = db.prepare('SELECT title, weekdays, start_week, end_week FROM tactics WHERE id = ?').get(t1.id) as {
      title: string;
      weekdays: string;
      start_week: number;
      end_week: number;
    };
    expect(JSON.parse(baseT1.weekdays)).toEqual([0, 1, 2, 3, 4]);
    expect(baseT1.title).toBe('T1');

    // Only week 2 (next week) has overrides; no override for week 1 (current) or any other week.
    const overrides = db
      .prepare('SELECT tactic_id, week, weekdays FROM tactic_week_overrides WHERE tactic_id IN (?, ?) ORDER BY tactic_id, week')
      .all(t1.id, t2.id) as { tactic_id: number; week: number; weekdays: string }[];
    expect(overrides.length).toBe(2);
    expect(overrides.every((o) => o.week === 2)).toBe(true);
    expect(JSON.parse(overrides.find((o) => o.tactic_id === t1.id)!.weekdays)).toEqual([0, 1]);
    expect(JSON.parse(overrides.find((o) => o.tactic_id === t2.id)!.weekdays)).toEqual([5]);

    // Current week's completion history is untouched.
    const completion = db
      .prepare('SELECT done FROM completions WHERE tactic_id = ? AND week = 1 AND weekday = 0')
      .get(t1.id) as { done: number };
    expect(completion.done).toBe(1);

    void cycle;
  });

  it('reopening a reduce_next_week plan is rejected outright (a completed, one-way action — overrides are never undone)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });

    const db = getDb();
    const overridesBefore = db.prepare('SELECT weekdays FROM tactic_week_overrides WHERE tactic_id = ?').get(t1.id) as {
      weekdays: string;
    };
    const planBefore = db.prepare('SELECT status FROM execution_recovery_plans').get() as {
      status: string;
    };
    expect(planBefore.status).toBe('resolved');

    const reopen = await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    expect(reopen.status).toBe(400);

    const planAfter = db.prepare('SELECT status FROM execution_recovery_plans').get() as {
      status: string;
    };
    expect(planAfter.status).toBe('resolved'); // unchanged — rejection never mutated it

    const overridesAfter = db.prepare('SELECT weekdays FROM tactic_week_overrides WHERE tactic_id = ?').get(t1.id) as {
      weekdays: string;
    };
    expect(overridesAfter.weekdays).toBe(overridesBefore.weekdays);
  });

  it('an existing per-week override effective for next week is respected as the "before" baseline', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    // Adapt next week (week 2) to a larger set via the normal tactic-adaptation endpoint first.
    await request(app)
      .put(`/api/tactics/${t1.id}/adaptation`)
      .set('Cookie', a.cookie)
      .send({ title: 'T1', weekdays: [0, 1, 2, 3, 4], scope: 'nextWeek' });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0, 1] }] }); // 5 (overridden) -> 2
    expect(res.status).toBe(200);
    expect(res.body.plan.adjustment.before[0].weekdays).toEqual([0, 1, 2, 3, 4]);
    expect(res.body.plan.adjustment.after[0].weekdays).toEqual([0, 1]);
  });
});

describe('execution recovery: duplicate tacticId exploit protection', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('rejects a submission with a duplicate tacticId before any before/after math runs', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({
        tactics: [
          { tacticId: t1.id, weekdays: [0] },
          { tacticId: t1.id, weekdays: [1] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('EXPLOIT REGRESSION: a duplicate tacticId (one small entry + one larger entry for the same tactic) cannot disguise a real increase as a claimed reduction', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    // Before: 3 scheduled occurrences (Sun/Mon/Tue).
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    // Exploit attempt: submit T1 twice — first with 1 day (claims part of a "reduction"),
    // then again with 4 days (the value that would actually get persisted, a real increase
    // from 3 to 4). If totalBefore were double-counted (3+3=6) while totalAfter only summed
    // the smaller entry, this could look like a valid reduction (e.g. 6 -> 1) on paper while
    // the real persisted schedule (4 days) is actually larger than the true baseline (3 days).
    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({
        tactics: [
          { tacticId: t1.id, weekdays: [0] },
          { tacticId: t1.id, weekdays: [0, 1, 2, 3] },
        ],
      });
    expect(res.status).toBe(400);

    // No override was ever written — the exploit attempt must leave zero trace.
    const db = getDb();
    const override = db.prepare('SELECT * FROM tactic_week_overrides WHERE tactic_id = ?').get(t1.id);
    expect(override).toBeUndefined();
    const planCount = db.prepare('SELECT COUNT(*) as count FROM execution_recovery_plans').get() as { count: number };
    expect(planCount.count).toBe(0);
  });

  it('rejects a tactics array larger than the maximum allowed size', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const tactics = Array.from({ length: 101 }, (_, i) => ({ tacticId: i + 1, weekdays: [0] }));
    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics });
    expect(res.status).toBe(400);
  });
});

describe('execution recovery: reduction plan lifecycle (reduce_next_week can never reopen)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('reopen rejects a reduce_next_week plan with a clear, specific message, regardless of its (already-resolved) status', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });

    const reopen = await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    expect(reopen.status).toBe(400);
    expect(reopen.body.error).toBeTruthy();
  });
});

describe('execution recovery: plan overwrite/consistency (no silent overwrite/rebaseline)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('reduce-next-week rejects outright if a plan already exists for the current cycle/week (any strategy/status)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך קיים' });

    const res = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });
    expect(res.status).toBe(409);

    // The existing maneuver plan must be completely untouched.
    const plan = getDb().prepare('SELECT strategy, note FROM execution_recovery_plans').get() as {
      strategy: string;
      note: string;
    };
    expect(plan.strategy).toBe('maneuver');
    expect(plan.note).toBe('מהלך קיים');
  });

  it('STALE-TAB RACE: a stale client unaware a maneuver plan now exists cannot silently overwrite it via reduce-next-week', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });

    // Tab A loaded the page when there was no plan yet. Meanwhile (in another tab/device),
    // a maneuver plan gets created for the same week.
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'נוצר בטאב אחר' });

    // Tab A, still believing no plan exists, submits a reduction anyway.
    const staleAttempt = await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });
    expect(staleAttempt.status).toBe(409);

    const db = getDb();
    const override = db.prepare('SELECT * FROM tactic_week_overrides WHERE tactic_id = ?').get(t1.id);
    expect(override).toBeUndefined(); // no override was applied by the rejected stale attempt
    const plan = db.prepare('SELECT strategy FROM execution_recovery_plans').get() as { strategy: string };
    expect(plan.strategy).toBe('maneuver'); // untouched
  });

  it('PUT maneuver rejects outright against an existing reduce_next_week plan, with a distinct message from the "reopen first" case', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });

    const res = await request(app)
      .put(`/api/execution-recovery/${a.userId}`)
      .set('Cookie', a.cookie)
      .send({ note: 'ניסיון להמיר למהלך' });
    expect(res.status).toBe(400);

    const plan = getDb().prepare('SELECT strategy, note FROM execution_recovery_plans').get() as {
      strategy: string;
      note: string;
    };
    expect(plan.strategy).toBe('reduce_next_week'); // untouched — never converted
  });

  it('adjustment_json is always NULL for a maneuver plan, and resolved_at stays consistent with status', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    await request(app).put(`/api/execution-recovery/${a.userId}`).set('Cookie', a.cookie).send({ note: 'מהלך' });

    const db = getDb();
    const active = db.prepare('SELECT adjustment_json, resolved_at, status FROM execution_recovery_plans').get() as {
      adjustment_json: string | null;
      resolved_at: string | null;
      status: string;
    };
    expect(active.adjustment_json).toBeNull();
    expect(active.status).toBe('active');
    expect(active.resolved_at).toBeNull();

    await request(app).post(`/api/execution-recovery/${a.userId}/resolve`).set('Cookie', a.cookie);
    const resolved = db.prepare('SELECT adjustment_json, resolved_at, status FROM execution_recovery_plans').get() as {
      adjustment_json: string | null;
      resolved_at: string | null;
      status: string;
    };
    expect(resolved.adjustment_json).toBeNull();
    expect(resolved.status).toBe('resolved');
    expect(typeof resolved.resolved_at).toBe('string');

    await request(app).post(`/api/execution-recovery/${a.userId}/reopen`).set('Cookie', a.cookie);
    const reopened = db.prepare('SELECT adjustment_json, resolved_at, status FROM execution_recovery_plans').get() as {
      adjustment_json: string | null;
      resolved_at: string | null;
      status: string;
    };
    expect(reopened.adjustment_json).toBeNull();
    expect(reopened.status).toBe('active');
    expect(reopened.resolved_at).toBeNull();
  });

  it('reduce_next_week plan always has a non-null adjustment_json and a non-null resolved_at (created already resolved)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await createCycle(app, a);
    const t1 = await createTactic(app, a, { title: 'T1', weekdays: [0, 1, 2], startWeek: 1, endWeek: 12 });
    await request(app)
      .post(`/api/execution-recovery/${a.userId}/reduce-next-week`)
      .set('Cookie', a.cookie)
      .send({ tactics: [{ tacticId: t1.id, weekdays: [0] }] });

    const row = getDb().prepare('SELECT adjustment_json, resolved_at, status FROM execution_recovery_plans').get() as {
      adjustment_json: string | null;
      resolved_at: string | null;
      status: string;
    };
    expect(row.status).toBe('resolved');
    expect(row.adjustment_json).not.toBeNull();
    expect(row.resolved_at).not.toBeNull();
  });
});
