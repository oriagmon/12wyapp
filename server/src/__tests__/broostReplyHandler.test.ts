import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, setDb } from '../db.js';
import { runMigrations } from '../migrate.js';

type ReplyResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};
type PostHandler = (request: { user: { id: number }; body: unknown }, response: ReplyResponse) => void;
const handlers = vi.hoisted(() => new Map<string, PostHandler>());

// Exercise the registered handler and real SQLite transaction without opening an HTTP socket.
vi.mock('express', () => ({
  Router: () => ({
    use: vi.fn(),
    get: vi.fn(),
    post: (path: string, handler: PostHandler) => { handlers.set(path, handler); },
  }),
}));
vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn() }));
vi.mock('../lib/broosts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/broosts.js')>(),
  scheduleImmediateBroostSend: vi.fn(),
}));

import '../routes/broosts.js';
import { scheduleImmediateBroostSend } from '../lib/broosts.js';

describe('BROOST reply handler: offline transaction coverage', () => {
  let db: Database.Database;
  let originalId: number;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    for (const id of [1, 2, 3, 4]) {
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
        .run(id, `fixture${id}@example.test`, 'unused-fixture-hash');
    }
    db.exec('INSERT INTO partnerships (id, initiator_id, invitee_id) VALUES (1, 1, 2), (2, 3, 4)');
    originalId = Number(db.prepare(
      `INSERT INTO partner_broosts (sender_id, recipient_id, partnership_id, message, email_status)
       VALUES (2, 1, 1, 'fixture message', 'sent')`
    ).run().lastInsertRowid);
  });

  afterEach(() => {
    closeDb();
    vi.restoreAllMocks();
  });

  function post(body: unknown, userId = 1) {
    const handler = handlers.get('/');
    if (!handler) throw new Error('BROOST POST handler was not registered');
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    handler({ user: { id: userId }, body }, response);
    return {
      status: response.status.mock.calls.at(-1)?.[0] ?? 200,
      body: response.json.mock.calls.at(-1)?.[0],
    };
  }

  it('creates a trimmed reply for the original sender and leaves read status unchanged', () => {
    const result = post({ replyToBroostId: originalId, customMessage: '  Thanks!  ' });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ message: 'Thanks!', recipient: { id: 2 }, presetKey: null, emailStatus: 'pending' });
    expect(db.prepare('SELECT read_at FROM partner_broosts WHERE id = ?').get(originalId)).toEqual({ read_at: null });
    expect(scheduleImmediateBroostSend).toHaveBeenCalledTimes(1);
  });

  it('preserves ordinary preset sends without a reply reference', () => {
    expect(post({ presetKey: 'great_job' })).toMatchObject({ status: 201, body: { recipient: { id: 2 }, presetKey: 'great_job' } });
  });

  it('returns the same denial for unknown, sent, and third-party notification IDs', () => {
    const sentId = Number(db.prepare(
      `INSERT INTO partner_broosts (sender_id, recipient_id, partnership_id, message, email_status)
       VALUES (1, 2, 1, 'sent fixture', 'sent')`
    ).run().lastInsertRowid);
    const foreignId = Number(db.prepare(
      `INSERT INTO partner_broosts (sender_id, recipient_id, partnership_id, message, email_status)
       VALUES (3, 4, 2, 'foreign fixture', 'sent')`
    ).run().lastInsertRowid);
    const missing = post({ replyToBroostId: 999, customMessage: 'Reply' });
    expect(missing.status).toBe(404);
    expect(post({ replyToBroostId: sentId, customMessage: 'Reply' })).toEqual(missing);
    expect(post({ replyToBroostId: foreignId, customMessage: 'Reply' })).toEqual(missing);
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
  });

  it('rejects a reply after unpairing without deleting the original notification', () => {
    db.exec('DELETE FROM partnerships WHERE id = 1');
    expect(post({ replyToBroostId: originalId, customMessage: 'Reply' }).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM partner_broosts').get()).toEqual({ count: 1 });
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
  });

  it('rejects a changed partner rather than redirecting the reply', () => {
    db.exec('DELETE FROM partnerships; INSERT INTO partnerships (initiator_id, invitee_id) VALUES (1, 3)');
    expect(post({ replyToBroostId: originalId, customMessage: 'Reply' }).status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM partner_broosts WHERE sender_id = 1').get()).toEqual({ count: 0 });
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid reference %s', (replyToBroostId) => {
    expect(post({ replyToBroostId, customMessage: 'Reply' }).status).toBe(400);
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(501)])('rejects an empty or oversized custom reply', (customMessage) => {
    expect(post({ replyToBroostId: originalId, customMessage }).status).toBe(400);
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
  });

  it('accepts 500 characters and enforces the same cooldown on a repeated reply', () => {
    expect(post({ replyToBroostId: originalId, customMessage: 'x'.repeat(500) }).status).toBe(201);
    expect(post({ replyToBroostId: originalId, customMessage: 'Again' }).status).toBe(429);
    expect(db.prepare('SELECT COUNT(*) AS count FROM partner_broosts WHERE sender_id = 1').get()).toEqual({ count: 1 });
    expect(scheduleImmediateBroostSend).toHaveBeenCalledTimes(1);
  });

  it('rolls back and does not schedule delivery when insertion fails', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.exec(`CREATE TRIGGER reject_reply BEFORE INSERT ON partner_broosts BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END`);
    const result = post({ replyToBroostId: originalId, customMessage: 'Reply' });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('fixture rejection');
    expect(db.prepare('SELECT COUNT(*) AS count FROM partner_broosts').get()).toEqual({ count: 1 });
    expect(scheduleImmediateBroostSend).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
