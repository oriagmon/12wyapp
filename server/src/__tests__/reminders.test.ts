import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the
// claiming/idempotency/retry/lease business logic in lib/scheduledReminders.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import { runDueScheduledReminders, MAX_ATTEMPTS } from '../lib/scheduledReminders.js';
import { israelWallTimeToUtcIso } from '../lib/israelTime.js';

const sendEmailMock = vi.mocked(sendEmail);

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

/** Simulates the delivery worker claiming a reminder (flips it to 'sending' with a fresh
 *  lease) — used to deterministically exercise the API's compare-and-swap race guard without
 *  any real concurrency: the CAS UPDATE only cares about the row's status at the moment of
 *  its own write, so mutating it directly beforehand is equivalent to "another process
 *  claimed it first." */
function simulateWorkerClaim(db: ReturnType<typeof getDb>, id: number): void {
  db.prepare(`UPDATE scheduled_email_reminders SET status = 'sending', claimed_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  );
}

/** A wall-clock string comfortably in the future relative to any real test run. */
const FUTURE_WALL_TIME = '2099-06-15T10:00';
const FUTURE_ISO = israelWallTimeToUtcIso(FUTURE_WALL_TIME)!;

describe('scheduled email reminders: API', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    owner = await registerAndLogin(app, 'owner@a.com');
  });

  afterAll(() => closeDb());

  it('requires authentication for every route', async () => {
    expect((await request(app).get('/api/reminders')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/reminders')
          .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: 1 })
      ).status
    ).toBe(401);
    expect((await request(app).patch('/api/reminders/1').send({ title: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/reminders/1/cancel')).status).toBe(401);
  });

  it('creates a self-addressed reminder', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'לזכור לרוץ', body: 'לפני העבודה', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('לזכור לרוץ');
    expect(res.body.body).toBe('לפני העבודה');
    expect(res.body.status).toBe('pending');
    expect(res.body.scheduledFor).toBe(FUTURE_ISO);
    expect(res.body.recipient).toEqual({ id: owner.userId, email: 'owner@a.com', isSelf: true });
    expect(res.body.reminders).toBeUndefined();
  });

  it('creates a reminder addressed to the current accepted partner', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    await pair(app, owner, partner);

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'תזכורת לשותף', scheduledFor: FUTURE_WALL_TIME, recipientUserId: partner.userId });
    expect(res.status).toBe(201);
    expect(res.body.recipient).toEqual({ id: partner.userId, email: 'partner@a.com', isSelf: false });
  });

  describe('batch creation', () => {
    function postBatch(recipientUserIds: unknown) {
      return request(app)
        .post('/api/reminders')
        .set('Cookie', owner.cookie)
        .send({ title: '  תזכורת לשנינו  ', body: '  לצאת לריצה  ', scheduledFor: FUTURE_WALL_TIME, recipientUserIds });
    }

    function rows() {
      return getDb().prepare('SELECT * FROM scheduled_email_reminders ORDER BY id').all();
    }

    it('persists two independent pending rows with identical content/time and returns both', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pair(app, owner, partner);

      const res = await postBatch([owner.userId, partner.userId]);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeUndefined();
      expect(res.body.reminders).toHaveLength(2);
      expect(new Set(res.body.reminders.map((reminder: { id: number }) => reminder.id)).size).toBe(2);
      expect(res.body.reminders.map((reminder: { recipient: unknown }) => reminder.recipient)).toEqual([
        { id: owner.userId, email: owner.email, isSelf: true },
        { id: partner.userId, email: partner.email, isSelf: false },
      ]);
      for (const reminder of res.body.reminders) {
        expect(reminder).toMatchObject({
          title: 'תזכורת לשנינו', body: 'לצאת לריצה', scheduledFor: FUTURE_ISO,
          scheduledForIsraelWallTime: FUTURE_WALL_TIME, status: 'pending',
          attemptCount: 0, lastError: null, sentAt: null,
        });
      }
      expect(rows()).toEqual([owner.userId, partner.userId].map((recipientUserId) => expect.objectContaining({
        creator_user_id: owner.userId,
        recipient_user_id: recipientUserId,
        title: 'תזכורת לשנינו',
        body: 'לצאת לריצה',
        scheduled_for: FUTURE_ISO,
        next_attempt_at: FUTURE_ISO,
        status: 'pending',
        attempt_count: 0,
      })));
    });

    it('accepts a one-recipient array while keeping the batch response envelope', async () => {
      const res = await postBatch([owner.userId]);
      expect(res.status).toBe(201);
      expect(res.body.reminders).toHaveLength(1);
      expect(res.body.reminders[0].recipient.id).toBe(owner.userId);
      expect(res.body.id).toBeUndefined();
      expect(rows()).toHaveLength(1);
    });

    it.each([
      { name: 'empty', ids: [] },
      { name: 'more than two', ids: [1, 2, 3] },
      { name: 'zero', ids: [0] },
      { name: 'negative', ids: [-1] },
      { name: 'fractional', ids: [1.5] },
      { name: 'string', ids: ['1'] },
      { name: 'null member', ids: [null] },
      { name: 'missing', ids: undefined },
      { name: 'null', ids: null },
      { name: 'non-array', ids: 1 },
    ])('rejects $name recipient arrays without inserting anything', async ({ ids }) => {
      expect((await postBatch(ids)).status).toBe(400);
      expect(rows()).toEqual([]);
    });

    it('rejects duplicate self IDs rather than creating two copies', async () => {
      const res = await postBatch([owner.userId, owner.userId]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('יותר מפעם אחת');
      expect(rows()).toEqual([]);
    });

    it('rejects ambiguous single and batch fields even when both targets are valid', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pair(app, owner, partner);
      const res = await request(app)
        .post('/api/reminders')
        .set('Cookie', owner.cookie)
        .send({
          title: 'ambiguous', scheduledFor: FUTURE_WALL_TIME,
          recipientUserId: owner.userId, recipientUserIds: [owner.userId, partner.userId],
        });
      expect(res.status).toBe(400);
      expect(rows()).toEqual([]);
    });

    it('rejects an unpaired/unaccepted recipient without creating the self-addressed row', async () => {
      const unpaired = await registerAndLogin(app, 'unpaired@a.com');
      expect((await postBatch([owner.userId, unpaired.userId])).status).toBe(400);
      expect(rows()).toEqual([]);
    });

    it('rejects a foreign recipient even when another member of the batch is the current partner', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      await pair(app, owner, partner);
      expect((await postBatch([partner.userId, stranger.userId])).status).toBe(400);
      expect(rows()).toEqual([]);
    });

    it('rejects the entire batch if the chosen partnership has disappeared', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      const pairing = await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie)
        .send({ targetUserId: partner.userId });
      expect(pairing.status).toBe(201);
      expect((await request(app).delete(`/api/partnerships/${pairing.body.partner.partnershipId}`)
        .set('Cookie', owner.cookie)).status).toBe(204);
      expect((await postBatch([owner.userId, partner.userId])).status).toBe(400);
      expect(rows()).toEqual([]);
    });

    it.each(['not-a-date', '2020-01-01T10:00', '2026-03-27T02:30'])(
      'rejects invalid/past schedule %s before inserting either row',
      async (scheduledFor) => {
        const partner = await registerAndLogin(app, 'partner@a.com');
        await pair(app, owner, partner);
        const res = await request(app).post('/api/reminders').set('Cookie', owner.cookie)
          .send({ title: 'invalid schedule', scheduledFor, recipientUserIds: [owner.userId, partner.userId] });
        expect(res.status).toBe(400);
        expect(rows()).toEqual([]);
      }
    );

    it.each([
      { active: 99, expectedStatus: 429, inserted: 0 },
      { active: 98, expectedStatus: 201, inserted: 2 },
    ])('counts both new rows against the cap with $active active reminders', async ({ active, expectedStatus, inserted }) => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pair(app, owner, partner);
      const insert = getDb().prepare(
        `INSERT INTO scheduled_email_reminders
           (creator_user_id, recipient_user_id, title, body, scheduled_for, status, next_attempt_at)
         VALUES (?, ?, 'existing', '', ?, ?, ?)`
      );
      const statuses = ['pending', 'sending', 'failed'];
      for (let i = 0; i < active; i++) {
        insert.run(owner.userId, owner.userId, FUTURE_ISO, statuses[i % statuses.length], FUTURE_ISO);
      }

      const res = await postBatch([owner.userId, partner.userId]);
      expect(res.status).toBe(expectedStatus);
      expect(rows()).toHaveLength(active + inserted);
      expect(getDb().prepare("SELECT id FROM scheduled_email_reminders WHERE title = 'תזכורת לשנינו'").all())
        .toHaveLength(inserted);
      if (inserted) expect(res.body.reminders).toHaveLength(2);
    });

    it('rolls back the first row when a synchronous insert failure occurs for the second', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pair(app, owner, partner);
      const db = getDb();
      db.exec(`
        CREATE TRIGGER reject_second_batch_recipient
        BEFORE INSERT ON scheduled_email_reminders
        WHEN NEW.recipient_user_id <> NEW.creator_user_id
        BEGIN
          SELECT RAISE(ABORT, 'synthetic second-recipient failure');
        END;
      `);
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await postBatch([owner.userId, partner.userId]);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'שגיאת שרת פנימית' });
        expect(rows()).toEqual([]);
        expect(db.inTransaction).toBe(false);
      } finally {
        db.exec('DROP TRIGGER reject_second_batch_recipient');
        errorLog.mockRestore();
      }
    });

    it('keeps both rows creator-scoped, including against the addressed partner', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      await pair(app, owner, partner);
      const created = await postBatch([owner.userId, partner.userId]);
      expect(created.status).toBe(201);

      for (const viewer of [partner, stranger]) {
        const list = await request(app).get('/api/reminders').set('Cookie', viewer.cookie);
        expect(list.body.reminders).toEqual([]);
        for (const reminder of created.body.reminders) {
          expect((await request(app).patch(`/api/reminders/${reminder.id}`).set('Cookie', viewer.cookie)
            .send({ title: 'not allowed' })).status).toBe(404);
          expect((await request(app).post(`/api/reminders/${reminder.id}/cancel`).set('Cookie', viewer.cookie)).status).toBe(404);
        }
      }
      const ownList = await request(app).get('/api/reminders').set('Cookie', owner.cookie);
      expect(ownList.body.reminders).toHaveLength(2);
      expect(ownList.body.reminders.map((reminder: { status: string }) => reminder.status)).toEqual(['pending', 'pending']);
    });

    it('preserves per-row edits, cancellation, and worker CAS protection after batch creation', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pair(app, owner, partner);
      const created = await postBatch([owner.userId, partner.userId]);
      expect(created.status).toBe(201);
      const [selfReminder, partnerReminder] = created.body.reminders;
      simulateWorkerClaim(getDb(), selfReminder.id);

      expect((await request(app).patch(`/api/reminders/${selfReminder.id}`).set('Cookie', owner.cookie)
        .send({ title: 'too late' })).status).toBe(409);
      expect((await request(app).post(`/api/reminders/${selfReminder.id}/cancel`).set('Cookie', owner.cookie)).status).toBe(409);
      const edited = await request(app).patch(`/api/reminders/${partnerReminder.id}`).set('Cookie', owner.cookie)
        .send({ title: 'partner only' });
      expect(edited.status).toBe(200);
      expect(edited.body.recipient.id).toBe(partner.userId);
      expect((await request(app).post(`/api/reminders/${partnerReminder.id}/cancel`).set('Cookie', owner.cookie)).status).toBe(200);
      expect(rows()).toEqual([
        expect.objectContaining({ id: selfReminder.id, title: 'תזכורת לשנינו', status: 'sending' }),
        expect.objectContaining({ id: partnerReminder.id, title: 'partner only', status: 'cancelled' }),
      ]);
    });

    it('rejects batch recipients on PATCH without altering or duplicating an existing row', async () => {
      const created = await postBatch([owner.userId]);
      const id = created.body.reminders[0].id;
      const before = rows();
      const res = await request(app).patch(`/api/reminders/${id}`).set('Cookie', owner.cookie)
        .send({ title: 'do not apply', recipientUserIds: [owner.userId] });
      expect(res.status).toBe(400);
      expect(rows()).toEqual(before);
    });
  });

  it('rejects a recipient who is neither self nor the current accepted partner', async () => {
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: stranger.userId });
    expect(res.status).toBe(400);
  });

  it('rejects a recipient who WAS the partner but the partnership has since been removed', async () => {
    const exPartner = await registerAndLogin(app, 'ex@a.com');
    const pairRes = await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie).send({ targetUserId: exPartner.userId });
    await request(app).delete(`/api/partnerships/${pairRes.body.partner.partnershipId}`).set('Cookie', owner.cookie);

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: exPartner.userId });
    expect(res.status).toBe(400);
  });

  it('rejects an empty title, an over-length title, and an over-length body', async () => {
    const empty = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: '   ', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(empty.status).toBe(400);

    const longTitle = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'א'.repeat(201), scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(longTitle.status).toBe(400);

    const longBody = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', body: 'א'.repeat(2001), scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(longBody.status).toBe(400);
  });

  it('rejects a scheduled time in the past', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: '2020-01-01T10:00', recipientUserId: owner.userId });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed scheduledFor string', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: 'not-a-date', recipientUserId: owner.userId });
    expect(res.status).toBe(400);
  });

  it('rejects an Israel wall-clock time that does not exist (DST spring-forward gap), independent of server TZ', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // Israel's clocks jump from 01:59:59 straight to 03:00:00 local time at the 2026 DST
      // start — 2026-03-27T02:30 never occurs.
      const res = await request(app)
        .post('/api/reminders')
        .set('Cookie', owner.cookie)
        .send({ title: 'x', scheduledFor: '2026-03-27T02:30', recipientUserId: owner.userId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/שעון קיץ|לא תקין/);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('converts winter (UTC+2) and summer (UTC+3) Israel wall-clock times to the correct UTC instant', async () => {
    const winter = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'winter', scheduledFor: '2099-01-15T10:00', recipientUserId: owner.userId });
    expect(winter.body.scheduledFor).toBe('2099-01-15T08:00:00.000Z');

    const summer = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'summer', scheduledFor: '2099-07-15T10:00', recipientUserId: owner.userId });
    expect(summer.body.scheduledFor).toBe('2099-07-15T07:00:00.000Z');
  });

  it('lists only reminders this user created — never another creator\'s', async () => {
    const other = await registerAndLogin(app, 'other@a.com');
    await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'mine', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    await request(app)
      .post('/api/reminders')
      .set('Cookie', other.cookie)
      .send({ title: 'not mine', scheduledFor: FUTURE_WALL_TIME, recipientUserId: other.userId });

    const list = await request(app).get('/api/reminders').set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    expect(list.body.reminders).toHaveLength(1);
    expect(list.body.reminders[0].title).toBe('mine');
  });

  it('updates a pending reminder\'s title/body/schedule/recipient, resetting it to a fresh pending state', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    await pair(app, owner, partner);
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'orig', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });

    const updated = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'updated', body: 'new body', recipientUserId: partner.userId, scheduledFor: '2099-08-20T09:00' });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('updated');
    expect(updated.body.body).toBe('new body');
    expect(updated.body.recipient.id).toBe(partner.userId);
    expect(updated.body.status).toBe('pending');
  });

  it('a partial update only touches the fields provided', async () => {
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'orig', body: 'orig body', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });

    const updated = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'only title changed' });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('only title changed');
    expect(updated.body.body).toBe('orig body');
    expect(updated.body.scheduledFor).toBe(FUTURE_ISO);
  });

  it('rejects (409 Conflict) updating a reminder that already sent (or is otherwise not pending/failed)', async () => {
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'orig', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    const db = getDb();
    db.prepare(`UPDATE scheduled_email_reminders SET status = 'sent' WHERE id = ?`).run(created.body.id);

    const res = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'nope' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBeTruthy();
  });

  it('404s updating/cancelling another user\'s reminder — never exposes it', async () => {
    const other = await registerAndLogin(app, 'other@a.com');
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', other.cookie)
      .send({ title: 'other', scheduledFor: FUTURE_WALL_TIME, recipientUserId: other.userId });

    const patchRes = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'hijacked' });
    expect(patchRes.status).toBe(404);

    const cancelRes = await request(app).post(`/api/reminders/${created.body.id}/cancel`).set('Cookie', owner.cookie);
    expect(cancelRes.status).toBe(404);

    // Never leaked in the list either.
    const list = await request(app).get('/api/reminders').set('Cookie', owner.cookie);
    expect(list.body.reminders).toHaveLength(0);
  });

  it('cancels a pending reminder; cancellation is terminal', async () => {
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });

    const cancelled = await request(app).post(`/api/reminders/${created.body.id}/cancel`).set('Cookie', owner.cookie);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    const cancelAgain = await request(app).post(`/api/reminders/${created.body.id}/cancel`).set('Cookie', owner.cookie);
    expect(cancelAgain.status).toBe(409);

    const editAfterCancel = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'nope' });
    expect(editAfterCancel.status).toBe(409);
  });

  it('rejects an invalid reminder id', async () => {
    const res = await request(app).patch('/api/reminders/not-a-number').set('Cookie', owner.cookie).send({ title: 'x' });
    expect(res.status).toBe(400);
  });

  it('CAS race: PATCH returns 409 Conflict if the worker has claimed/sent the row since it was last read, and never overwrites it', async () => {
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'orig', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });

    // Simulates the delivery worker claiming this exact row in the narrow window between the
    // client reading it and this PATCH request's own compare-and-swap write — deterministic,
    // no real concurrency needed, since the CAS guard only cares about the row's status at
    // the moment of its own write, not about wall-clock timing.
    simulateWorkerClaim(getDb(), created.body.id);

    const res = await request(app)
      .patch(`/api/reminders/${created.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'should not apply' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBeTruthy();

    // Never overwritten — still exactly as the worker left it.
    const row = getDb().prepare('SELECT title, status FROM scheduled_email_reminders WHERE id = ?').get(created.body.id) as {
      title: string;
      status: string;
    };
    expect(row.title).toBe('orig');
    expect(row.status).toBe('sending');
  });

  it('CAS race: cancel returns 409 Conflict if the worker has claimed/sent the row since it was last read, and never overwrites it', async () => {
    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });

    simulateWorkerClaim(getDb(), created.body.id);

    const res = await request(app).post(`/api/reminders/${created.body.id}/cancel`).set('Cookie', owner.cookie);
    expect(res.status).toBe(409);

    const row = getDb().prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(created.body.id) as { status: string };
    expect(row.status).toBe('sending'); // never flipped to 'cancelled'
  });

  it('enforces a cap on active (pending/sending/failed) reminders per creator', async () => {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO scheduled_email_reminders
         (creator_user_id, recipient_user_id, title, body, scheduled_for, status, next_attempt_at)
       VALUES (?, ?, 'bulk', '', ?, 'pending', ?)`
    );
    for (let i = 0; i < 100; i++) {
      insert.run(owner.userId, owner.userId, FUTURE_ISO, FUTURE_ISO);
    }

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'one too many', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(res.status).toBe(429);
    expect(res.body.error).toBeTruthy();
  });

  it('the active-reminder cap does not count sent/cancelled reminders', async () => {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO scheduled_email_reminders
         (creator_user_id, recipient_user_id, title, body, scheduled_for, status, next_attempt_at, sent_at)
       VALUES (?, ?, 'bulk', '', ?, 'sent', NULL, ?)`
    );
    for (let i = 0; i < 100; i++) {
      insert.run(owner.userId, owner.userId, FUTURE_ISO, FUTURE_ISO);
    }

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'still fine', scheduledFor: FUTURE_WALL_TIME, recipientUserId: owner.userId });
    expect(res.status).toBe(201);
  });

  it('round-trips scheduledForIsraelWallTime exactly back to what was sent for both winter and summer', async () => {
    const winter = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'w', scheduledFor: '2099-01-15T10:00', recipientUserId: owner.userId });
    expect(winter.body.scheduledForIsraelWallTime).toBe('2099-01-15T10:00');

    const summer = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 's', scheduledFor: '2099-07-15T10:00', recipientUserId: owner.userId });
    expect(summer.body.scheduledForIsraelWallTime).toBe('2099-07-15T10:00');
  });

  it('accepts an ambiguous Israel wall-clock time (fall-back DST "occurs twice" case) with a deterministic, repeatable resolution', async () => {
    // 2026-10-25T01:30 occurs twice in Israel (clocks fall back from 02:00 to 01:00 local at
    // 2026-10-24T23:00:00Z) — unlike the nonexistent spring-forward gap, this must not be
    // rejected; it must resolve to some single, stable instant every time.
    const first = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'ambiguous 1', scheduledFor: '2026-10-25T01:30', recipientUserId: owner.userId });
    expect(first.status).toBe(201);
    expect(first.body.scheduledFor).toBe('2026-10-24T23:30:00.000Z');

    const second = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'ambiguous 2', scheduledFor: '2026-10-25T01:30', recipientUserId: owner.userId });
    expect(second.body.scheduledFor).toBe(first.body.scheduledFor); // deterministic, not random
  });
});

describe('scheduled email reminders: delivery worker (runDueScheduledReminders)', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
    owner = await registerAndLogin(app, 'owner@a.com');
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  async function createReminder(overrides: { title?: string; body?: string; recipientUserId?: number } = {}) {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({
        title: overrides.title ?? 'לזכור משהו',
        body: overrides.body,
        scheduledFor: FUTURE_WALL_TIME,
        recipientUserId: overrides.recipientUserId ?? owner.userId,
      });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  /** Makes a reminder immediately due by directly moving its schedule/next_attempt_at into
   *  the past — bypasses the API's "must be in the future" rule, which is exactly right for
   *  testing the worker in isolation from that unrelated create-time validation. */
  function makeDueNow(id: number) {
    const db = getDb();
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    db.prepare(`UPDATE scheduled_email_reminders SET scheduled_for = ?, next_attempt_at = ? WHERE id = ?`).run(
      pastIso,
      pastIso,
      id
    );
    return pastIso;
  }

  it('does not attempt a reminder that is not yet due', async () => {
    await createReminder(); // scheduled far in the future, never made due
    const result = await runDueScheduledReminders(getDb());
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends a due reminder successfully: marks it sent, clears next_attempt_at, records sentAt', async () => {
    const reminderId = await createReminder();
    makeDueNow(reminderId);

    const result = await runDueScheduledReminders(getDb());
    expect(result.attempted).toBe(1);
    expect(result.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const list = await request(app).get('/api/reminders').set('Cookie', owner.cookie);
    const sent = list.body.reminders.find((r: { id: number }) => r.id === reminderId);
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeTruthy();

    const row = getDb().prepare('SELECT next_attempt_at FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as {
      next_attempt_at: string | null;
    };
    expect(row.next_attempt_at).toBeNull();
  });

  it('never marks a reminder sent unless sendEmail actually resolved (a rejected send never becomes "sent")', async () => {
    sendEmailMock.mockRejectedValue(new Error('ACS outage'));
    const reminderId = await createReminder();
    makeDueNow(reminderId);

    const result = await runDueScheduledReminders(getDb());
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    const row = getDb().prepare('SELECT status, last_error, attempt_count, next_attempt_at FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as {
      status: string;
      last_error: string | null;
      attempt_count: number;
      next_attempt_at: string | null;
    };
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('ACS outage');
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at).not.toBeNull(); // still eligible for a bounded retry
  });

  it('retries a failed reminder on a later run once its backoff next_attempt_at is due', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('first failure'));
    const reminderId = await createReminder();
    makeDueNow(reminderId);

    const first = await runDueScheduledReminders(getDb());
    expect(first.failed).toBe(1);

    // Not due yet immediately after (backoff pushed next_attempt_at into the future).
    const second = await runDueScheduledReminders(getDb());
    expect(second.attempted).toBe(0);

    // Force the backoff window to have elapsed, then retry succeeds.
    sendEmailMock.mockResolvedValue(undefined);
    const db = getDb();
    db.prepare(`UPDATE scheduled_email_reminders SET next_attempt_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      reminderId
    );
    const third = await runDueScheduledReminders(db);
    expect(third.sent).toBe(1);

    const row = db.prepare('SELECT attempt_count, status FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as {
      attempt_count: number;
      status: string;
    };
    expect(row.attempt_count).toBe(2);
    expect(row.status).toBe('sent');
  });

  it('stops automatic retries after MAX_ATTEMPTS, leaving a terminal failed state (next_attempt_at null)', async () => {
    sendEmailMock.mockRejectedValue(new Error('permanent outage'));
    const reminderId = await createReminder();
    const db = getDb();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      db.prepare(`UPDATE scheduled_email_reminders SET next_attempt_at = ? WHERE id = ?`).run(
        new Date(Date.now() - 1000).toISOString(),
        reminderId
      );
      // eslint-disable-next-line no-await-in-loop
      await runDueScheduledReminders(db);
    }

    const row = db.prepare('SELECT attempt_count, status, next_attempt_at FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as {
      attempt_count: number;
      status: string;
      next_attempt_at: string | null;
    };
    expect(row.attempt_count).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe('failed');
    expect(row.next_attempt_at).toBeNull();

    // The worker's own due-query requires next_attempt_at IS NOT NULL, so simply running it
    // again (without anything externally forcing a new next_attempt_at) touches nothing
    // further automatically — the terminal state is durable on its own.
    const afterMax = await runDueScheduledReminders(db);
    expect(afterMax.attempted).toBe(0);
  });

  it('recovers a reminder stuck in "sending" from a crashed worker once its lease is stale, without ever double-sending on a fresh (non-stale) claim', async () => {
    const reminderId = await createReminder();
    const db = getDb();
    const staleClaimedAt = new Date(Date.now() - 15 * 60_000).toISOString(); // >10min stale-lease threshold
    db.prepare(
      `UPDATE scheduled_email_reminders SET status = 'sending', claimed_at = ?, next_attempt_at = ?, attempt_count = 1 WHERE id = ?`
    ).run(staleClaimedAt, new Date(Date.now() - 60_000).toISOString(), reminderId);

    const result = await runDueScheduledReminders(db);
    expect(result.sent).toBe(1);
    const row = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as { status: string };
    expect(row.status).toBe('sent');
  });

  it('never reclaims (or double-sends) a reminder whose "sending" lease is still fresh (not stale)', async () => {
    const reminderId = await createReminder();
    const db = getDb();
    const freshClaimedAt = new Date().toISOString(); // well within the 10min stale-lease threshold
    db.prepare(
      `UPDATE scheduled_email_reminders SET status = 'sending', claimed_at = ?, next_attempt_at = ?, attempt_count = 1 WHERE id = ?`
    ).run(freshClaimedAt, new Date(Date.now() - 60_000).toISOString(), reminderId);

    const result = await runDueScheduledReminders(db);
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('safely claims a due reminder exactly once even when two worker runs race on the same row (no real timers needed)', async () => {
    const reminderId = await createReminder();
    makeDueNow(reminderId);
    const db = getDb();

    // sendEmail resolves asynchronously (a microtask, not a real timer) — this is the yield
    // point that lets the second run's synchronous claim-check interleave before the first
    // run's send actually completes, exactly like two overlapping systemd timer invocations.
    const [first, second] = await Promise.all([runDueScheduledReminders(db), runDueScheduledReminders(db)]);

    expect(first.attempted + second.attempted).toBe(1); // claimed and attempted exactly once
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const row = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(reminderId) as { status: string };
    expect(row.status).toBe('sent');
  });

  it('includes the reminder title/body, an Israel-time scheduled label, and identifies the scheduler when the recipient differs from the creator', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    await pair(app, owner, partner);
    await request(app).patch('/api/profile').set('Cookie', owner.cookie).send({ displayName: 'אורי' });

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'כותרת בדיקה', body: 'תוכן מפורט', scheduledFor: FUTURE_WALL_TIME, recipientUserId: partner.userId });
    makeDueNow(res.body.id);

    await runDueScheduledReminders(getDb());

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('partner@a.com');
    expect(call.subject).toContain('כותרת בדיקה');
    expect(call.html).toContain('כותרת בדיקה');
    expect(call.html).toContain('תוכן מפורט');
    expect(call.html).toContain('אורי'); // scheduled-by identity (display name)
    expect(call.attachments).toBeDefined();
    expect(call.attachments?.length).toBeGreaterThan(0);
  });

  it('falls back to the creator\'s email as the "scheduled by" identity when no display name is set', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    await pair(app, owner, partner);

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'x', scheduledFor: FUTURE_WALL_TIME, recipientUserId: partner.userId });
    makeDueNow(res.body.id);

    await runDueScheduledReminders(getDb());
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.html).toContain('owner@a.com');
  });

  it('never claims a cancelled reminder', async () => {
    const reminderId = await createReminder();
    await request(app).post(`/api/reminders/${reminderId}/cancel`).set('Cookie', owner.cookie);
    makeDueNow(reminderId);

    const result = await runDueScheduledReminders(getDb());
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('re-checks the recipient at delivery time: a reminder addressed to a partner who has since been unpaired is auto-cancelled, never sent', async () => {
    const partner = await registerAndLogin(app, 'partner@a.com');
    const pairRes = await request(app)
      .post('/api/partnerships/pair')
      .set('Cookie', owner.cookie)
      .send({ targetUserId: partner.userId });

    const created = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'לשותף', scheduledFor: FUTURE_WALL_TIME, recipientUserId: partner.userId });
    expect(created.status).toBe(201);

    // Unpair after creation but before the reminder becomes due — exactly the scenario the
    // delivery-time re-check exists for.
    await request(app).delete(`/api/partnerships/${pairRes.body.partner.partnershipId}`).set('Cookie', owner.cookie);
    makeDueNow(created.body.id);

    const result = await runDueScheduledReminders(getDb());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.autoCancelled).toBe(1);

    const row = getDb().prepare('SELECT status, last_error, next_attempt_at FROM scheduled_email_reminders WHERE id = ?').get(
      created.body.id
    ) as { status: string; last_error: string | null; next_attempt_at: string | null };
    expect(row.status).toBe('cancelled');
    expect(row.last_error).toBeTruthy();
    expect(row.next_attempt_at).toBeNull();
  });

  it('a self-addressed reminder is never affected by the delivery-time recipient re-check (no partnership involved at all)', async () => {
    const reminderId = await createReminder({ recipientUserId: owner.userId });
    makeDueNow(reminderId);
    const result = await runDueScheduledReminders(getDb());
    expect(result.sent).toBe(1);
    expect(result.autoCancelled).toBe(0);
  });

  it('one due reminder throwing during send does not abort the run — a later due reminder is still attempted and sent', async () => {
    const first = await createReminder({ title: 'first (will fail)' });
    // A distinctly earlier scheduled_for so findDueReminderIds (ORDER BY scheduled_for ASC)
    // processes this one first, deterministically.
    const db = getDb();
    const firstPast = new Date(Date.now() - 120_000).toISOString();
    db.prepare('UPDATE scheduled_email_reminders SET scheduled_for = ?, next_attempt_at = ? WHERE id = ?').run(
      firstPast,
      firstPast,
      first
    );
    const second = await createReminder({ title: 'second (will succeed)' });
    makeDueNow(second);

    sendEmailMock.mockRejectedValueOnce(new Error('boom on first'));
    sendEmailMock.mockResolvedValueOnce(undefined);

    const result = await runDueScheduledReminders(db);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);

    const firstRow = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(first) as { status: string };
    const secondRow = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(second) as { status: string };
    expect(firstRow.status).toBe('failed');
    expect(secondRow.status).toBe('sent');
  });

  it('an orphaned/missing recipient at delivery time is caught by the re-check (auto-cancelled) and does not abort the run — a later due reminder still sends', async () => {
    const db = getDb();
    const orphanRecipient = await registerAndLogin(app, 'orphan@a.com');
    await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie).send({ targetUserId: orphanRecipient.userId });
    const orphanReminderRes = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({ title: 'orphaned', scheduledFor: FUTURE_WALL_TIME, recipientUserId: orphanRecipient.userId });
    expect(orphanReminderRes.status).toBe(201);
    const orphanId = orphanReminderRes.body.id as number;
    makeDueNow(orphanId);

    // Simulates a data-integrity edge case (recipient row missing) without deleting via FK
    // cascade, which would delete the reminder row too — briefly disable FK enforcement to
    // create an orphaned reference. The delivery-time recipient re-check (resolveAllowedRecipient)
    // catches this before ever reaching sendEmail, exactly like an unpaired partner would.
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM users WHERE id = ?').run(orphanRecipient.userId);
    db.pragma('foreign_keys = ON');

    const healthyId = await createReminder({ title: 'healthy' });
    makeDueNow(healthyId);

    const result = await runDueScheduledReminders(db);
    expect(result.autoCancelled).toBe(1);
    expect(result.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // never attempted for the orphaned one

    const orphanRow = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(orphanId) as { status: string };
    const healthyRow = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(healthyId) as { status: string };
    expect(orphanRow.status).toBe('cancelled');
    expect(healthyRow.status).toBe('sent');
  });

  it('a missing creator row past the delivery-time recheck (defensive guard) is marked failed without aborting the run — a later due reminder still sends', async () => {
    // getAcceptedPartner (used by the delivery-time recheck) matches partnerships by raw id
    // equality, not by re-joining against the creator's own users row — so unlike a missing
    // *recipient* (caught by the recheck itself), a missing *creator* slips past it and is
    // only caught by the defensive "recipient/creator missing" guard right after.
    const db = getDb();
    const doomed = await registerAndLogin(app, 'doomed@a.com');
    const partnerOfDoomed = await registerAndLogin(app, 'partner-of-doomed@a.com');
    const pairRes = await request(app)
      .post('/api/partnerships/pair')
      .set('Cookie', doomed.cookie)
      .send({ targetUserId: partnerOfDoomed.userId });
    expect(pairRes.status).toBe(201);

    const doomedReminderRes = await request(app)
      .post('/api/reminders')
      .set('Cookie', doomed.cookie)
      .send({ title: 'doomed creator', scheduledFor: FUTURE_WALL_TIME, recipientUserId: partnerOfDoomed.userId });
    expect(doomedReminderRes.status).toBe(201);
    const doomedId = doomedReminderRes.body.id as number;
    makeDueNow(doomedId);

    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM users WHERE id = ?').run(doomed.userId);
    db.pragma('foreign_keys = ON');

    const healthyId = await createReminder({ title: 'healthy' });
    makeDueNow(healthyId);

    const result = await runDueScheduledReminders(db);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // never attempted for the doomed one

    const doomedRow = db.prepare('SELECT status, last_error FROM scheduled_email_reminders WHERE id = ?').get(doomedId) as {
      status: string;
      last_error: string | null;
    };
    const healthyRow = db.prepare('SELECT status FROM scheduled_email_reminders WHERE id = ?').get(healthyId) as { status: string };
    expect(doomedRow.status).toBe('failed');
    expect(doomedRow.last_error).toBeTruthy();
    expect(healthyRow.status).toBe('sent');
  });

  it('escapes HTML in the title, body, and creator display name so none of them can inject markup into the email', async () => {
    await request(app).patch('/api/profile').set('Cookie', owner.cookie).send({ displayName: '<b>Owner</b>' });
    const partner = await registerAndLogin(app, 'partner@a.com');
    await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie).send({ targetUserId: partner.userId });

    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', owner.cookie)
      .send({
        title: '<script>alert("title")</script>',
        body: '<img src=x onerror=alert(1)>',
        scheduledFor: FUTURE_WALL_TIME,
        recipientUserId: partner.userId,
      });
    makeDueNow(res.body.id);

    await runDueScheduledReminders(getDb());

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<script>');
    expect(call.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(call.html).not.toContain('<b>Owner</b>');
    expect(call.html).toContain('&lt;script&gt;');
    expect(call.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(call.html).toContain('&lt;b&gt;Owner&lt;/b&gt;');
  });
});
