import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the
// business logic in lib/broosts.ts and routes/broosts.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import {
  BROOST_PRESETS,
  MAX_ATTEMPTS,
  MAX_BROOSTS_PER_PAIR_PER_WINDOW,
  runDueBroostEmails,
  type BroostRow,
} from '../lib/broosts.js';

const sendEmailMock = vi.mocked(sendEmail);

/** The email send is deliberately deferred (via setImmediate) until after the response has
 *  already been sent (see routes/broosts.ts's POST / handler). Awaiting one macrotask tick
 *  from the test side is enough to deterministically observe it having run to completion: it
 *  was scheduled *before* this call, so by the time this later-scheduled setImmediate
 *  callback fires, every microtask the earlier one produced (including its own awaited
 *  sendEmail call) has already fully drained — Node always drains the microtask queue
 *  completely between macrotasks. (Mirrors the identical helper in password-reset.test.ts.) */
function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pair(app: ReturnType<typeof freshApp>, a: { cookie: string }, b: { userId: number }): Promise<number> {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  expect(res.status).toBe(201);
  return res.body.partner.partnershipId as number;
}

/** Inserts a partner_broosts row directly, bypassing the API/rate-limit/immediate-send path
 *  entirely — used to set up worker-specific scenarios (stale lease, exact due state, a
 *  particular attempt count) in full isolation from API concerns. */
function insertBroostRow(
  db: ReturnType<typeof getDb>,
  fields: {
    senderId: number;
    recipientId: number;
    partnershipId: number | null;
    message?: string;
    presetKey?: string | null;
    emailStatus?: string;
    emailNextAttemptAt?: string | null;
    emailClaimedAt?: string | null;
    emailAttemptCount?: number;
    createdAt?: string;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO partner_broosts
         (sender_id, recipient_id, partnership_id, preset_key, message, email_status,
          email_next_attempt_at, email_claimed_at, email_attempt_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
    )
    .run(
      fields.senderId,
      fields.recipientId,
      fields.partnershipId,
      fields.presetKey ?? null,
      fields.message ?? 'הודעת בדיקה',
      fields.emailStatus ?? 'pending',
      fields.emailNextAttemptAt ?? new Date().toISOString(),
      fields.emailClaimedAt ?? null,
      fields.emailAttemptCount ?? 0,
      fields.createdAt ?? null
    );
  return Number(info.lastInsertRowid);
}

describe('BROOST: API — sending', () => {
  let app: ReturnType<typeof freshApp>;
  let a: { cookie: string; userId: number; email: string };
  let b: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
    a = await registerAndLogin(app, 'a@a.com');
    b = await registerAndLogin(app, 'b@a.com');
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  it('requires authentication', async () => {
    const res = await request(app).post('/api/broosts').send({ presetKey: 'great_job' });
    expect(res.status).toBe(401);
  });

  it('rejects sending when the sender has no current accepted partner', async () => {
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(400);
  });

  it('sends a preset BROOST to the current accepted partner; responds immediately with a pending email status, then the email is sent asynchronously off the response path', async () => {
    await pair(app, a, b);
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(201);
    expect(res.body.presetKey).toBe('great_job');
    expect(res.body.message).toBe(BROOST_PRESETS.find((p) => p.key === 'great_job')!.message);
    expect(res.body.direction).toBe('sent');
    // The HTTP response must never wait on the email provider — it reflects the row exactly
    // as committed, before the (deliberately deferred) send attempt has necessarily run.
    expect(res.body.emailStatus).toBe('pending');
    expect(res.body.emailHasError).toBe(false);

    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe('b@a.com');
    expect(sendEmailMock.mock.calls[0][0].subject).toContain('BROOST');
    const row = getDb().prepare('SELECT * FROM partner_broosts WHERE id = ?').get(res.body.id) as BroostRow;
    expect(row.email_status).toBe('sent');
  });

  it('the HTTP response is sent before the email attempt even starts — a never-resolving sendEmail cannot block the request', async () => {
    await pair(app, a, b);
    sendEmailMock.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(201);
    expect(res.body.emailStatus).toBe('pending');
    // Give the scheduled setImmediate a chance to fire and call the (never-resolving) mock —
    // proves the response above did not wait for it.
    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // The row is left claimed/"sending" — a future worker run (once its lease goes stale)
    // would eventually recover it. Nothing about this test asserts that far ahead; it only
    // proves the request/response path itself never blocked on the provider call.
    const row = getDb().prepare('SELECT * FROM partner_broosts WHERE id = ?').get(res.body.id) as BroostRow;
    expect(row.email_status).toBe('sending');
  });

  it('POST / responds with a safe JSON 500 (and the process keeps serving requests) if the DB insert fails unexpectedly', async () => {
    await pair(app, a, b);
    const db = getDb();
    db.exec('DROP TABLE partner_broosts');
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/no such table/i);
    // The process (and this same Express app instance) must still be able to serve requests —
    // proving the forced failure never became an unhandled rejection/crash.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });

  it('sends a custom message (trimmed) when no preset is chosen', async () => {
    await pair(app, a, b);
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ customMessage: '  את/ה פשוט מדהים/ה!  ' });
    expect(res.status).toBe(201);
    expect(res.body.presetKey).toBeNull();
    expect(res.body.message).toBe('את/ה פשוט מדהים/ה!');
  });

  it('replies to the original sender without marking the received notification read', async () => {
    const partnershipId = await pair(app, a, b);
    const originalId = insertBroostRow(getDb(), {
      senderId: b.userId, recipientId: a.userId, partnershipId, emailStatus: 'sent',
    });
    const response = await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: originalId, customMessage: '  תודה!  ' });
    expect(response.status).toBe(201);
    expect(response.body.recipient.id).toBe(b.userId);
    expect(response.body.message).toBe('תודה!');
    expect(response.body.presetKey).toBeNull();
    expect((getDb().prepare('SELECT read_at FROM partner_broosts WHERE id = ?').get(originalId) as { read_at: string | null }).read_at).toBeNull();
    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe(b.email);
  });

  it('does not reveal or reply to a notification addressed to somebody else', async () => {
    const partnershipId = await pair(app, a, b);
    const sentId = insertBroostRow(getDb(), {
      senderId: a.userId, recipientId: b.userId, partnershipId, emailStatus: 'sent',
    });
    const denied = await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: sentId, customMessage: 'תגובה' });
    const missing = await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: sentId + 1000, customMessage: 'תגובה' });
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(denied.body).toEqual(missing.body);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('never redirects a reply to a new partner when the original partnership changed', async () => {
    const partnershipId = await pair(app, a, b);
    const originalId = insertBroostRow(getDb(), {
      senderId: b.userId, recipientId: a.userId, partnershipId, emailStatus: 'sent',
    });
    const c = await registerAndLogin(app, 'c@a.com');
    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', a.cookie).expect(204);
    await pair(app, a, c);
    const response = await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: originalId, customMessage: 'רק לשולח המקורי' });
    expect(response.status).toBe(409);
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM partner_broosts WHERE sender_id = ?').get(a.userId) as { count: number }).count).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid reply reference %s', async (replyToBroostId) => {
    await pair(app, a, b);
    const response = await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId, customMessage: 'תגובה' });
    expect(response.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('applies the existing cooldown to replies rather than creating an unlimited send path', async () => {
    const partnershipId = await pair(app, a, b);
    const originalId = insertBroostRow(getDb(), {
      senderId: b.userId, recipientId: a.userId, partnershipId, emailStatus: 'sent',
    });
    await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: originalId, customMessage: 'תגובה ראשונה' }).expect(201);
    await request(app).post('/api/broosts').set('Cookie', a.cookie)
      .send({ replyToBroostId: originalId, customMessage: 'תגובה חוזרת' }).expect(429);
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM partner_broosts WHERE sender_id = ?').get(a.userId) as { count: number }).count).toBe(1);
  });

  it('rejects both a preset and a custom message together', async () => {
    await pair(app, a, b);
    const res = await request(app)
      .post('/api/broosts')
      .set('Cookie', a.cookie)
      .send({ presetKey: 'great_job', customMessage: 'גם וגם' });
    expect(res.status).toBe(400);
  });

  it('rejects neither a preset nor a custom message', async () => {
    await pair(app, a, b);
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unknown preset key', async () => {
    await pair(app, a, b);
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'not-a-real-preset' });
    expect(res.status).toBe(400);
  });

  it('accepts a custom message at exactly the 500-character limit, rejects 501', async () => {
    await pair(app, a, b);
    const at500 = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ customMessage: 'א'.repeat(500) });
    expect(at500.status).toBe(201);

    const at501 = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ customMessage: 'א'.repeat(501) });
    expect(at501.status).toBe(400);
  });

  it('never rolls back the in-app BROOST when the email send fails — it still exists with a failed email status', async () => {
    await pair(app, a, b);
    sendEmailMock.mockRejectedValueOnce(new Error('ACS outage: internal detail'));
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(201);
    expect(res.body.emailStatus).toBe('pending');

    await flushSetImmediate();
    const row = getDb().prepare('SELECT * FROM partner_broosts WHERE id = ?').get(res.body.id) as BroostRow;
    expect(row).toBeTruthy();
    expect(row.email_status).toBe('failed');

    // The client-facing shape (fetched via history, since the original POST response never
    // carries the final failed status) exposes only a boolean, never the raw provider error.
    const historyRes = await request(app).get('/api/broosts/history').set('Cookie', a.cookie);
    const item = historyRes.body.items.find((i: { id: number }) => i.id === res.body.id);
    expect(item.emailStatus).toBe('failed');
    expect(item.emailHasError).toBe(true);
    expect(JSON.stringify(historyRes.body)).not.toMatch(/ACS outage|internal detail/);
  });

  it('escapes HTML in a custom message and in the sender display name in the email body', async () => {
    await pair(app, a, b);
    await request(app).patch('/api/profile').set('Cookie', a.cookie).send({ displayName: '<script>alert(1)</script>' });
    const res = await request(app)
      .post('/api/broosts')
      .set('Cookie', a.cookie)
      .send({ customMessage: '<b>bold</b> & "quoted"' });
    expect(res.status).toBe(201);
    await flushSetImmediate();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<script>alert(1)</script>');
    expect(call.html).not.toContain('<b>bold</b>');
    expect(call.html).toContain('&lt;script&gt;');
  });
});

describe('BROOST: anti-spam (rolling 24h cap + 60s cooldown)', () => {
  let app: ReturnType<typeof freshApp>;
  let a: { cookie: string; userId: number; email: string };
  let b: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    a = await registerAndLogin(app, 'a@a.com');
    b = await registerAndLogin(app, 'b@a.com');
    await pair(app, a, b);
  });

  afterAll(() => closeDb());

  it('allows exactly MAX_BROOSTS_PER_PAIR_PER_WINDOW sends when spaced beyond the cooldown, then blocks the next one with 429', async () => {
    const db = getDb();
    for (let i = 0; i < MAX_BROOSTS_PER_PAIR_PER_WINDOW; i++) {
      // Directly insert rather than going through the 60s cooldown in real time — this test
      // isolates the *count* boundary from the cooldown boundary (covered separately below).
      insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: new Date(Date.now() - (i + 10) * 60_000).toISOString() });
    }
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBeTruthy();
  });

  it('the count cap is scoped per (sender, recipient) pair — does not block a different sender/recipient direction', async () => {
    const db = getDb();
    for (let i = 0; i < MAX_BROOSTS_PER_PAIR_PER_WINDOW; i++) {
      insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: new Date(Date.now() - (i + 10) * 60_000).toISOString() });
    }
    // b -> a is a completely different directed pair, unaffected by a -> b's cap.
    const res = await request(app).post('/api/broosts').set('Cookie', b.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(201);
  });

  it('a send older than the 24h window does not count toward the cap', async () => {
    const db = getDb();
    insertBroostRow(db, {
      senderId: a.userId,
      recipientId: b.userId,
      partnershipId: null,
      createdAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    });
    for (let i = 0; i < MAX_BROOSTS_PER_PAIR_PER_WINDOW - 1; i++) {
      insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: new Date(Date.now() - (i + 10) * 60_000).toISOString() });
    }
    // Total rows = MAX, but only MAX-1 are within the rolling window, so one more is allowed.
    const res = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(res.status).toBe(201);
  });

  it('blocks a second send within the 60s cooldown, even well under the count cap', async () => {
    const first = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'crushing_it' });
    expect(second.status).toBe(429);
  });

  it('allows a second send once the cooldown has elapsed', async () => {
    const first = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(first.status).toBe(201);
    const db = getDb();
    db.prepare('UPDATE partner_broosts SET created_at = ? WHERE id = ?').run(
      new Date(Date.now() - 61_000).toISOString(),
      first.body.id
    );
    const second = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'crushing_it' });
    expect(second.status).toBe(201);
  });

  it('CONCURRENCY (60s cooldown boundary): several near-simultaneous sends from a cold start all race the *cooldown*, not the count cap — exactly one succeeds', async () => {
    // With no prior BROOSTs between this pair, every one of these fires within the same
    // 60-second cooldown window of each other (they're all issued concurrently) — so the
    // cooldown, not the 24h count cap (which is nowhere near its limit), is what bounds the
    // outcome down to exactly one success, proving the two checks compose correctly under a
    // real race rather than one silently masking the other.
    const attempts = MAX_BROOSTS_PER_PAIR_PER_WINDOW + 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, () => request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' }))
    );
    const succeeded = results.filter((r) => r.status === 201).length;
    const rateLimited = results.filter((r) => r.status === 429).length;
    expect(succeeded).toBe(1);
    expect(succeeded + rateLimited).toBe(attempts);
    const countRow = getDb().prepare('SELECT COUNT(*) as count FROM partner_broosts').get() as { count: number };
    expect(countRow.count).toBe(1);
  });

  it('CONCURRENCY (24h count-cap boundary): with the cooldown already satisfied by 4 pre-seeded sends, only one more concurrent attempt succeeds out of many', async () => {
    // Pre-seed MAX-1 sends, all safely outside the 60s cooldown, so the *count cap* (not the
    // cooldown) is the only thing standing between these concurrent attempts and success —
    // exactly one of them should win the race to become the 5th (and last allowed) send.
    const db = getDb();
    for (let i = 0; i < MAX_BROOSTS_PER_PAIR_PER_WINDOW - 1; i++) {
      insertBroostRow(db, {
        senderId: a.userId,
        recipientId: b.userId,
        partnershipId: null,
        createdAt: new Date(Date.now() - (i + 10) * 60_000).toISOString(),
      });
    }
    const preseeded = MAX_BROOSTS_PER_PAIR_PER_WINDOW - 1;
    const attempts = 5;
    const results = await Promise.all(
      Array.from({ length: attempts }, () => request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' }))
    );
    const succeeded = results.filter((r) => r.status === 201).length;
    const rateLimited = results.filter((r) => r.status === 429).length;
    expect(succeeded).toBe(1);
    expect(succeeded + rateLimited).toBe(attempts);
    const countRow = getDb().prepare('SELECT COUNT(*) as count FROM partner_broosts').get() as { count: number };
    expect(countRow.count).toBe(preseeded + 1);
    expect(countRow.count).toBe(MAX_BROOSTS_PER_PAIR_PER_WINDOW);
  });
});

describe('BROOST: presets catalog', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('exposes eight short playful presets with all existing keys and no slash-gender copy', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const res = await request(app).get('/api/broosts/presets').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.presets.map((preset: { key: string }) => preset.key)).toEqual([
      'great_job', 'crushing_it', 'keep_going', 'proud_of_you',
      'daily_boost', 'you_got_this', 'king_queen', 'sending_love',
    ]);
    for (const preset of res.body.presets) {
      expect(typeof preset.key).toBe('string');
      expect(typeof preset.message).toBe('string');
      expect(preset.message.length).toBeGreaterThan(0);
      expect(preset.message.length).toBeLessThan(80);
      expect(preset.message).not.toContain('/');
    }
    expect(res.body.presets[0].message).toBe('יש ביצועים ויש את זה. ריספקט 🫡');
    expect(res.body.presets[3].message).toBe('85%? יש קבלות 🧾');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/broosts/presets');
    expect(res.status).toBe(401);
  });
});

describe('BROOST: history + unread + read', () => {
  let app: ReturnType<typeof freshApp>;
  let a: { cookie: string; userId: number; email: string };
  let b: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    a = await registerAndLogin(app, 'a@a.com');
    b = await registerAndLogin(app, 'b@a.com');
  });

  afterAll(() => closeDb());

  it('keeps old saved preset messages unchanged after the catalog copy is refreshed', async () => {
    const oldMessage = 'כל הכבוד! את/ה עושה עבודה מעולה השבוע 💪';
    const id = insertBroostRow(getDb(), {
      senderId: a.userId, recipientId: b.userId, partnershipId: null,
      presetKey: 'great_job', message: oldMessage, emailStatus: 'sent',
    });
    for (const cookie of [a.cookie, b.cookie]) {
      const history = await request(app).get('/api/broosts/history').set('Cookie', cookie);
      expect(history.body.items.find((item: { id: number }) => item.id === id))
        .toMatchObject({ presetKey: 'great_job', message: oldMessage });
    }
    expect(BROOST_PRESETS.find((preset) => preset.key === 'great_job')!.message).not.toBe(oldMessage);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('a stranger sees nothing for another pair\'s BROOST (direct lookup or listing)', async () => {
    await pair(app, a, b);
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const history = await request(app).get('/api/broosts/history').set('Cookie', stranger.cookie);
    expect(history.body.items).toEqual([]);
    const readAttempt = await request(app).post(`/api/broosts/${sent.body.id}/read`).set('Cookie', stranger.cookie);
    expect(readAttempt.status).toBe(404);
  });

  it('history includes both sent and received items for the caller, each correctly labeled by direction', async () => {
    await pair(app, a, b);
    await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    await request(app).post('/api/broosts').set('Cookie', b.cookie).send({ presetKey: 'crushing_it' });

    const aHistory = await request(app).get('/api/broosts/history').set('Cookie', a.cookie);
    expect(aHistory.body.items.length).toBe(2);
    const sentItem = aHistory.body.items.find((i: { direction: string }) => i.direction === 'sent');
    const receivedItem = aHistory.body.items.find((i: { direction: string }) => i.direction === 'received');
    expect(sentItem.presetKey).toBe('great_job');
    expect(receivedItem.presetKey).toBe('crushing_it');
    // Profile-safe identity only — no raw email field, no bio.
    expect(sentItem.recipient).not.toHaveProperty('email');
    expect(sentItem.recipient).not.toHaveProperty('bio');
    expect(typeof sentItem.recipient.label).toBe('string');
  });

  it('history is paginated and capped (limit/offset/total)', async () => {
    await pair(app, a, b);
    const db = getDb();
    for (let i = 0; i < 7; i++) {
      insertBroostRow(db, {
        senderId: a.userId,
        recipientId: b.userId,
        partnershipId: null,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    const page1 = await request(app).get('/api/broosts/history?limit=3&offset=0').set('Cookie', a.cookie);
    expect(page1.body.items.length).toBe(3);
    expect(page1.body.total).toBe(7);
    const page2 = await request(app).get('/api/broosts/history?limit=3&offset=3').set('Cookie', a.cookie);
    expect(page2.body.items.length).toBe(3);
    const page3 = await request(app).get('/api/broosts/history?limit=3&offset=6').set('Cookie', a.cookie);
    expect(page3.body.items.length).toBe(1);
  });

  it('history remains visible to the two original participants after they unpair — no new sends, but old history persists', async () => {
    const partnershipId = await pair(app, a, b);
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(sent.status).toBe(201);

    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', a.cookie);

    const historyAfter = await request(app).get('/api/broosts/history').set('Cookie', a.cookie);
    expect(historyAfter.body.items.length).toBe(1);

    const newSendAttempt = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'crushing_it' });
    expect(newSendAttempt.status).toBe(400); // no current partner anymore
  });

  it('GET /unread returns the recipient\'s unread count and a recent preview', async () => {
    await pair(app, a, b);
    await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    const unread = await request(app).get('/api/broosts/unread').set('Cookie', b.cookie);
    expect(unread.body.count).toBe(1);
    expect(unread.body.recent.length).toBe(1);
    expect(unread.body.recent[0].direction).toBe('received');

    // The sender's own unread count is unaffected by their own sent BROOST.
    const senderUnread = await request(app).get('/api/broosts/unread').set('Cookie', a.cookie);
    expect(senderUnread.body.count).toBe(0);
  });

  it('the recipient can mark one BROOST read; the sender cannot mark it read on the recipient\'s behalf', async () => {
    await pair(app, a, b);
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });

    const senderAttempt = await request(app).post(`/api/broosts/${sent.body.id}/read`).set('Cookie', a.cookie);
    expect(senderAttempt.status).toBe(403);

    const recipientMark = await request(app).post(`/api/broosts/${sent.body.id}/read`).set('Cookie', b.cookie);
    expect(recipientMark.status).toBe(200);
    expect(recipientMark.body.isRead).toBe(true);

    const unreadAfter = await request(app).get('/api/broosts/unread').set('Cookie', b.cookie);
    expect(unreadAfter.body.count).toBe(0);
  });

  it('mark-all-read only touches the caller\'s own unread BROOSTs', async () => {
    await pair(app, a, b);
    await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    const db = getDb();
    db.prepare('UPDATE partner_broosts SET created_at = ? WHERE recipient_id = ?').run(
      new Date(Date.now() - 61_000).toISOString(),
      b.userId
    );
    await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'crushing_it' });

    const markAll = await request(app).post('/api/broosts/read-all').set('Cookie', b.cookie);
    expect(markAll.body.updated).toBe(2);

    const unreadAfter = await request(app).get('/api/broosts/unread').set('Cookie', b.cookie);
    expect(unreadAfter.body.count).toBe(0);

    // The sender's own history is untouched by the recipient's mark-all-read (irrelevant to
    // them anyway, since read_at only ever matters from the recipient's perspective).
    const senderHistory = await request(app).get('/api/broosts/history').set('Cookie', a.cookie);
    expect(senderHistory.body.items.every((i: { readAt: string | null }) => i.readAt !== null)).toBe(true);
  });

  it('a stored message remains intact even if its preset_key no longer matches any current catalog entry (historical independence)', async () => {
    await pair(app, a, b);
    const db = getDb();
    insertBroostRow(db, {
      senderId: a.userId,
      recipientId: b.userId,
      partnershipId: null,
      presetKey: 'a_now_removed_preset',
      message: 'טקסט היסטורי שהיה תקף בזמנו',
    });
    const history = await request(app).get('/api/broosts/history').set('Cookie', a.cookie);
    expect(history.status).toBe(200);
    const item = history.body.items.find((i: { presetKey: string }) => i.presetKey === 'a_now_removed_preset');
    expect(item.message).toBe('טקסט היסטורי שהיה תקף בזמנו');
  });
});

describe('BROOST: delivery worker (runDueBroostEmails)', () => {
  let app: ReturnType<typeof freshApp>;
  let a: { cookie: string; userId: number; email: string };
  let b: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
    a = await registerAndLogin(app, 'a@a.com');
    b = await registerAndLogin(app, 'b@a.com');
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  it('does not attempt a BROOST that is not yet due', async () => {
    const db = getDb();
    insertBroostRow(db, {
      senderId: a.userId,
      recipientId: b.userId,
      partnershipId: null,
      emailNextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await runDueBroostEmails(db);
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('retries a failed BROOST once its backoff next_attempt_at is due', async () => {
    const db = getDb();
    const id = insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null });
    sendEmailMock.mockRejectedValueOnce(new Error('first failure'));
    const first = await runDueBroostEmails(db);
    expect(first.failed).toBe(1);

    const second = await runDueBroostEmails(db);
    expect(second.attempted).toBe(0); // backoff not yet elapsed

    sendEmailMock.mockResolvedValue(undefined);
    db.prepare('UPDATE partner_broosts SET email_next_attempt_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
    const third = await runDueBroostEmails(db);
    expect(third.sent).toBe(1);
    const row = db.prepare('SELECT email_status, email_attempt_count FROM partner_broosts WHERE id = ?').get(id) as {
      email_status: string;
      email_attempt_count: number;
    };
    expect(row.email_status).toBe('sent');
    expect(row.email_attempt_count).toBe(2);
  });

  it('stops automatic retries after MAX_ATTEMPTS, leaving a terminal failed state', async () => {
    const db = getDb();
    const id = insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null });
    sendEmailMock.mockRejectedValue(new Error('permanent outage'));
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      db.prepare('UPDATE partner_broosts SET email_next_attempt_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
      // eslint-disable-next-line no-await-in-loop
      await runDueBroostEmails(db);
    }
    const row = db.prepare('SELECT email_status, email_attempt_count, email_next_attempt_at FROM partner_broosts WHERE id = ?').get(id) as {
      email_status: string;
      email_attempt_count: number;
      email_next_attempt_at: string | null;
    };
    expect(row.email_attempt_count).toBe(MAX_ATTEMPTS);
    expect(row.email_status).toBe('failed');
    expect(row.email_next_attempt_at).toBeNull();
  });

  it('recovers a BROOST stuck in "sending" from a crashed worker once its lease is stale', async () => {
    const db = getDb();
    const id = insertBroostRow(db, {
      senderId: a.userId,
      recipientId: b.userId,
      partnershipId: null,
      emailStatus: 'sending',
      emailClaimedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      emailNextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
      emailAttemptCount: 1,
    });
    const result = await runDueBroostEmails(db);
    expect(result.sent).toBe(1);
    const row = db.prepare('SELECT email_status FROM partner_broosts WHERE id = ?').get(id) as { email_status: string };
    expect(row.email_status).toBe('sent');
  });

  it('never reclaims a BROOST whose "sending" lease is still fresh', async () => {
    const db = getDb();
    insertBroostRow(db, {
      senderId: a.userId,
      recipientId: b.userId,
      partnershipId: null,
      emailStatus: 'sending',
      emailClaimedAt: new Date().toISOString(),
      emailNextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
      emailAttemptCount: 1,
    });
    const result = await runDueBroostEmails(db);
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('safely claims a due BROOST exactly once even when two worker runs race on the same row', async () => {
    const db = getDb();
    insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null });
    const [first, second] = await Promise.all([runDueBroostEmails(db), runDueBroostEmails(db)]);
    expect(first.attempted + second.attempted).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('the immediate post-insert send and the worker share one claim — the worker never re-sends a BROOST the immediate attempt already delivered', async () => {
    await pair(app, a, b);
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(sent.body.emailStatus).toBe('pending');
    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const db = getDb();
    const sentRow = db.prepare('SELECT email_status FROM partner_broosts WHERE id = ?').get(sent.body.id) as { email_status: string };
    expect(sentRow.email_status).toBe('sent');

    // Force it "due" again artificially and run the worker — since it's already 'sent' (not
    // pending/failed/stale-sending), the worker's own due-query must not pick it up at all.
    db.prepare('UPDATE partner_broosts SET email_next_attempt_at = ? WHERE id = ?').run(new Date().toISOString(), sent.body.id);
    const result = await runDueBroostEmails(db);
    expect(result.attempted).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('one BROOST failing during send does not abort the run — a later due BROOST still sends', async () => {
    const db = getDb();
    insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: '2026-01-01T00:00:00.000Z' });
    insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: '2026-01-01T00:00:01.000Z' });
    sendEmailMock.mockRejectedValueOnce(new Error('boom on first')).mockResolvedValueOnce(undefined);

    const result = await runDueBroostEmails(db);
    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('re-checks participant existence, NOT current partnership: a BROOST sent before unpairing still sends successfully afterward (unlike scheduled reminders)', async () => {
    const partnershipId = await pair(app, a, b);
    sendEmailMock.mockRejectedValueOnce(new Error('transient failure at send time'));
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    await flushSetImmediate();
    const db = getDb();
    const failedRow = db.prepare('SELECT email_status FROM partner_broosts WHERE id = ?').get(sent.body.id) as { email_status: string };
    expect(failedRow.email_status).toBe('failed');

    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', a.cookie);

    sendEmailMock.mockResolvedValue(undefined);
    db.prepare('UPDATE partner_broosts SET email_next_attempt_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), sent.body.id);
    const result = await runDueBroostEmails(db);
    expect(result.sent).toBe(1);
    const row = db.prepare('SELECT email_status FROM partner_broosts WHERE id = ?').get(sent.body.id) as { email_status: string };
    expect(row.email_status).toBe('sent');
  });

  it('a missing recipient/sender row at delivery time (defensive guard) is marked failed without aborting the run', async () => {
    const db = getDb();
    const doomed = await registerAndLogin(app, 'doomed@a.com');
    const ghostId = insertBroostRow(db, { senderId: a.userId, recipientId: doomed.userId, partnershipId: null });

    // Simulates a recipient row vanishing between creation and delivery (in normal operation
    // this can't happen — ON DELETE CASCADE would remove this BROOST row right along with the
    // user — so this bypasses that cascade momentarily, purely to exercise the defensive
    // guard in processClaimedBroost, mirroring the equivalent test in reminders.test.ts).
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM users WHERE id = ?').run(doomed.userId);
    db.pragma('foreign_keys = ON');

    insertBroostRow(db, { senderId: a.userId, recipientId: b.userId, partnershipId: null, createdAt: '2026-01-01T00:00:01.000Z' });
    const result = await runDueBroostEmails(db);
    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    const ghostRow = db.prepare('SELECT email_status FROM partner_broosts WHERE id = ?').get(ghostId) as { email_status: string };
    expect(ghostRow.email_status).toBe('failed');
  });
});
