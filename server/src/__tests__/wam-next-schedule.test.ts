import Database from 'better-sqlite3';
import type { Request, RequestHandler, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, setDb } from '../db.js';
import { runMigrations } from '../migrate.js';
import { wamsRouter } from '../routes/wams.js';
import { sendEmail } from '../lib/emailSender.js';

vi.mock('../config.js', () => ({
  config: { dbPath: ':memory:', sessionCookieName: 'fixture-session' },
  getEmailConfig: () => ({
    connectionString: 'unused-synthetic-value',
    senderAddress: 'sender@example.test',
    appUrl: 'https://app.example.test',
  }),
}));
vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn() }));

const schedule = { nextWamAt: '2099-07-15T07:00:00.000Z', nextWamDurationMinutes: 45 };
const send = vi.mocked(sendEmail);
type Route = { path: string; methods: Record<string, boolean>; stack: { handle: RequestHandler }[] };

// Exercise the registered handlers against the same fresh :memory: database/migrations
// as helpers.ts, without opening an HTTP listener or loading any credentials/provider.
async function invoke(method: string, path: string, body: unknown = schedule, userId = 10) {
  const layer = wamsRouter.stack.find((entry) => {
    const route = entry.route as unknown as Route | undefined;
    return route?.path === path && route.methods[method];
  });
  const handler: RequestHandler | undefined = layer?.route?.stack[0]?.handle;
  if (!handler) throw new Error(`Missing ${method} ${path}`);
  const reply = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: unknown) { resolve({ status: this.statusCode, body: data }); return this; },
    };
    const req = { params: { id: '1' }, body, user: { id: userId, email: `${userId}@example.test` } };
    handler(req as unknown as Request, res as unknown as Response, reject);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return reply;
}

function frozenState() {
  const db = getDb();
  return {
    wam: db.prepare('SELECT status, completed_at, wins, notes FROM wams WHERE id = 1').get(),
    reviews: db.prepare('SELECT * FROM wam_reviews WHERE wam_id = 1 ORDER BY user_id').all(),
    backups: db.prepare('SELECT * FROM backup').all(),
  };
}

beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES
      (10, 'a@example.test', 'unused'), (20, 'b@example.test', 'unused'), (30, 'c@example.test', 'unused');
    INSERT INTO partnerships (id, initiator_id, invitee_id) VALUES (1, 10, 20);
    INSERT INTO cycles (id, user_id, name) VALUES (1, 10, 'Synthetic cycle'), (2, 20, 'Synthetic partner cycle');
    INSERT INTO wams (id, partnership_id, week, status, completed_at, initiator_cycle_id, invitee_cycle_id, wins, notes)
      VALUES (1, 1, 1, 'complete', '2026-01-01T00:00:00.000Z', 1, 2, 'Frozen win', 'Frozen notes');
    INSERT INTO wam_reviews (wam_id, user_id, rating, score_snapshot) VALUES (1, 10, 8, 90), (1, 20, 9, 85);
    INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json)
      VALUES (1, 1, '2026-01-01T00:00:00.000Z', 1, '{"syntheticFrozenSnapshot":true}');
  `);
});
afterEach(() => { closeDb(); vi.restoreAllMocks(); });

describe('completed-WAM invitation-only scheduling (no HTTP transport)', () => {
  it('creates the schedule without changing completion, snapshots, backups or duo streak', async () => {
    const before = frozenState();
    const prior = await invoke('get', '/:id', {});
    const result = await invoke('put', '/:id/next-wam');
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('celebration');
    expect(result.body).toMatchObject({
      wam: {
        status: 'complete', completedAt: '2026-01-01T00:00:00.000Z',
        nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 0 },
        calendarInvitations: { a: { status: 'sent' }, b: { status: 'sent' } },
        duoStreak: (prior.body as { duoStreak: unknown }).duoStreak,
      },
    });
    expect(frozenState()).toEqual(before);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps UID and sequence on an identical retry, but advances sequence for changed duration', async () => {
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    const first = getDb().prepare('SELECT calendar_event_uid, calendar_event_sequence FROM wams WHERE id = 1').get() as {
      calendar_event_uid: string; calendar_event_sequence: number;
    };
    expect((await invoke('put', '/:id/next-wam', schedule, 20)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(getDb().prepare('SELECT calendar_event_uid, calendar_event_sequence FROM wams WHERE id = 1').get()).toEqual(first);
    expect((await invoke('put', '/:id/next-wam', { ...schedule, nextWamDurationMinutes: 30 })).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(4);
    expect(getDb().prepare('SELECT calendar_event_uid, calendar_event_sequence FROM wams WHERE id = 1').get()).toEqual({
      calendar_event_uid: first.calendar_event_uid, calendar_event_sequence: 1,
    });
    const ics = Buffer.from(send.mock.calls[2][0].attachments![0].contentInBase64, 'base64').toString();
    expect(ics).toContain(`UID:${first.calendar_event_uid}`);
    expect(ics).toContain('SEQUENCE:1');
  });

  it('persists partial delivery, preserves completion, and retries only the failed recipient', async () => {
    const before = frozenState();
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic mail failure'));
    const failed = await invoke('put', '/:id/next-wam');
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ wam: {
      status: 'complete', calendarInvitations: { a: { status: 'sent' }, b: { status: 'failed' } },
    } });
    expect(frozenState()).toEqual(before);
    const retried = await invoke('put', '/:id/next-wam');
    expect(retried.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].to).toBe('b@example.test');
    expect(frozenState()).toEqual(before);
  });

  it('shares its lock with completion and reopening, then releases it after delivery', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    send.mockImplementationOnce(async () => { entered(); await gate; });
    const pending = invoke('put', '/:id/next-wam');
    await started;
    try {
      expect((await invoke('put', '/:id/next-wam', { ...schedule, nextWamDurationMinutes: 30 }, 20)).status).toBe(409);
      expect((await invoke('post', '/:id/complete')).status).toBe(409);
      expect((await invoke('post', '/:id/reopen', {})).status).toBe(409);
      expect(send).toHaveBeenCalledTimes(1);
    } finally { release(); }
    expect((await pending).status).toBe(200);
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { nextWamAt: null }, { nextWamAt: 'bad' }, { nextWamAt: '2020-01-01T00:00:00Z' },
    { ...schedule, nextWamDurationMinutes: 0 }, { ...schedule, nextWamDurationMinutes: 1.5 },
    { ...schedule, nextWamDurationMinutes: 1441 }])('rejects invalid/no-date input %j without sending', async (body) => {
    expect((await invoke('put', '/:id/next-wam', body)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('cannot clear an existing sent schedule', async () => {
    await invoke('put', '/:id/next-wam');
    expect((await invoke('put', '/:id/next-wam', { nextWamAt: null })).status).toBe(400);
    expect(getDb().prepare('SELECT next_wam_at FROM wams WHERE id = 1').get()).toEqual({ next_wam_at: schedule.nextWamAt });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('denies unrelated users and archived cycles', async () => {
    const db = getDb();
    expect((await invoke('put', '/:id/next-wam', schedule, 30)).status).toBe(404);
    db.prepare('UPDATE cycles SET is_active = 0 WHERE id = 1').run();
    expect((await invoke('put', '/:id/next-wam')).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('still completes a draft without scheduling or sending an invitation', async () => {
    getDb().prepare("UPDATE wams SET status = 'draft', completed_at = NULL WHERE id = 1").run();
    const completed = await invoke('post', '/:id/complete', {});
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ wam: { status: 'complete', nextWam: { at: null } }, celebration: { type: 'completion' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('rechecks archive state after delivery without touching frozen completion data', async () => {
    const before = frozenState();
    send.mockImplementationOnce(async () => {
      getDb().prepare('UPDATE cycles SET is_active = 0 WHERE id = 1').run();
    });
    expect((await invoke('put', '/:id/next-wam')).status).toBe(400);
    expect(frozenState()).toEqual(before);
  });
});

describe('draft-WAM invitation-only scheduling', () => {
  /** Sending invitations must be usable long before the meeting is over. */
  function makeDraft() {
    getDb().prepare(
      "UPDATE wams SET status = 'draft', completed_at = NULL WHERE id = 1"
    ).run();
    getDb().prepare('UPDATE wam_reviews SET score_snapshot = NULL WHERE wam_id = 1').run();
  }

  it('schedules and sends invitations while leaving the meeting a draft with unfrozen scores', async () => {
    makeDraft();
    const before = frozenState();
    const result = await invoke('put', '/:id/next-wam');
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('celebration');
    expect(result.body).toMatchObject({
      wam: {
        status: 'draft', completedAt: null,
        nextWam: { at: schedule.nextWamAt, durationMinutes: 45, sequence: 0 },
        calendarInvitations: { a: { status: 'sent' }, b: { status: 'sent' } },
      },
    });
    // Status, completion time, content, score snapshots and backups are all untouched:
    // scheduling is not completion.
    expect(frozenState()).toEqual(before);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not create a completion backup or freeze snapshots when scheduling a draft', async () => {
    makeDraft();
    const backupsBefore = getDb().prepare('SELECT COUNT(*) AS n FROM backup').get();
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM backup').get()).toEqual(backupsBefore);
    expect(getDb().prepare('SELECT score_snapshot FROM wam_reviews WHERE wam_id = 1').all())
      .toEqual([{ score_snapshot: null }, { score_snapshot: null }]);
  });

  it('rejects a draft schedule with no date, and cannot clear one already sent', async () => {
    makeDraft();
    expect((await invoke('put', '/:id/next-wam', { nextWamAt: null })).status).toBe(400);
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    expect((await invoke('put', '/:id/next-wam', { nextWamAt: null })).status).toBe(400);
    expect(getDb().prepare('SELECT next_wam_at, status FROM wams WHERE id = 1').get())
      .toEqual({ next_wam_at: schedule.nextWamAt, status: 'draft' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects a past date and an unrelated user on a draft', async () => {
    makeDraft();
    expect((await invoke('put', '/:id/next-wam', { nextWamAt: '2020-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await invoke('put', '/:id/next-wam', schedule, 30)).status).toBe(404);
    expect(getDb().prepare('SELECT next_wam_at FROM wams WHERE id = 1').get()).toEqual({ next_wam_at: null });
    expect(send).not.toHaveBeenCalled();
  });

  it('completes a previously-scheduled draft without resending an unchanged invitation', async () => {
    makeDraft();
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear();
    const completed = await invoke('post', '/:id/complete', schedule);
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ wam: { status: 'complete' }, celebration: { type: 'completion' } });
    // Idempotent per recipient and sequence: an unchanged slot must not re-mail either partner.
    expect(send).not.toHaveBeenCalled();
  });

  it('persists partial delivery on a draft and leaves it a draft', async () => {
    makeDraft();
    send.mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('synthetic delivery failure'));
    const result = await invoke('put', '/:id/next-wam');
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      wam: {
        status: 'draft', completedAt: null,
        calendarInvitations: { a: { status: 'sent' }, b: { status: 'failed' } },
      },
    });
    expect((result.body as { error: string }).error).toContain('מצב הפגישה והציונים השמורים לא השתנו');

    // A retry re-mails only the recipient whose delivery failed.
    send.mockReset().mockResolvedValue(undefined);
    expect((await invoke('put', '/:id/next-wam')).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getDb().prepare('SELECT status FROM wams WHERE id = 1').get()).toEqual({ status: 'draft' });
  });
});
