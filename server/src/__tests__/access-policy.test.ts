import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { freshApp } from './helpers.js';
import { createApp } from '../app.js';
import { closeDb, getDb } from '../db.js';
import { config } from '../config.js';
import { getAccessPolicy, isUserAdmitted } from '../lib/accessPolicy.js';
import { DUMMY_PASSWORD_HASH, hashPassword } from '../lib/password.js';
import * as password from '../lib/password.js';
import { createSession } from '../lib/sessions.js';
import { clearInMemoryRateLimiter, createResetToken } from '../lib/passwordReset.js';
import { sendEmail } from '../lib/emailSender.js';

vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

const originalNodeEnv = config.nodeEnv;
const PASSWORD = 'test-password123';
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
beforeEach(() => {
  config.nodeEnv = 'test';
  vi.stubEnv('APP_ALLOWED_USER_IDS', undefined);
  vi.stubEnv('APP_PUBLIC_URL', undefined);
  clearInMemoryRateLimiter();
});
afterEach(() => {
  closeDb();
  config.nodeEnv = originalNodeEnv;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function seedAccounts() {
  const db = getDb();
  for (const id of [1, 2, 3]) {
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, `user${id}@example.test`, passwordHash);
    db.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?)').run(id, 'dark');
  }
  return [1, 2, 3].map((id) => `session_token=${createSession(db, id).token}`);
}

describe('operator admission configuration', () => {
  it('opens only unconfigured non-production, and enforces configured IDs in every mode', () => {
    expect(getAccessPolicy().registrationOpen).toBe(true);
    expect(isUserAdmitted(3)).toBe(true);
    for (const mode of ['test', 'development', 'production']) {
      config.nodeEnv = mode;
      vi.stubEnv('APP_ALLOWED_USER_IDS', '1, 2');
      expect(getAccessPolicy().registrationOpen).toBe(false);
      expect(isUserAdmitted(1)).toBe(true);
      expect(isUserAdmitted(3)).toBe(false);
    }
  });

  it.each([undefined, '', ' ', '0', '-1', '1.5', '1e2', '1,', '1,,2', '*', 'user@example.test', '9007199254740992'])(
    'fails production startup closed for malformed/missing IDs: %s', (value) => {
      config.nodeEnv = 'production';
      vi.stubEnv('APP_ALLOWED_USER_IDS', value);
      vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test');
      expect(() => createApp()).toThrow(/APP_ALLOWED_USER_IDS/);
    }
  );

  it('does not silently ignore a malformed setting outside production', () => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', '');
    expect(() => createApp()).toThrow(/APP_ALLOWED_USER_IDS/);
  });
});

describe('operator admission across the app', () => {
  it('exposes only signup policy and disables registration even for an approved account email', async () => {
    const app = freshApp();
    seedAccounts();
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    const policy = await request(app).get('/api/auth/policy');
    expect(policy.body).toEqual({ registrationOpen: false });
    expect(policy.headers['cache-control']).toContain('no-store');
    const existing = await request(app).post('/api/auth/register').send({ email: 'user1@example.test', password: PASSWORD });
    const unknown = await request(app).post('/api/auth/register').send({ email: 'new@example.test', password: PASSWORD });
    expect(existing.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(existing.body).toEqual(unknown.body);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('production approved users can log in with secure cookies; production registration stays closed', async () => {
    freshApp();
    seedAccounts();
    config.nodeEnv = 'production';
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test');
    const app = createApp();
    const login = await request(app).post('/api/auth/login').send({ email: 'user1@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly.*Secure.*SameSite=Lax/);
    expect((await request(app).post('/api/auth/register').send({ email: 'new@example.test', password: PASSWORD })).status).toBe(403);
  });

  it('denies unapproved and unknown logins identically, doing dummy bcrypt work without creating sessions', async () => {
    const app = freshApp();
    seedAccounts();
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    const verify = vi.spyOn(password, 'verifyPassword');
    const blocked = await request(app).post('/api/auth/login').send({ email: 'user3@example.test', password: PASSWORD });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'unknown@example.test', password: PASSWORD });
    expect(blocked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(blocked.body).toEqual(unknown.body);
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect(verify).toHaveBeenNthCalledWith(1, PASSWORD, DUMMY_PASSWORD_HASH);
    expect(verify).toHaveBeenNthCalledWith(2, PASSWORD, DUMMY_PASSWORD_HASH);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 3 });
  });

  it('blocks legacy cookies on every private router, including monitoring, archives, exports and files', async () => {
    const app = freshApp();
    const [, , blockedCookie] = seedAccounts();
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    const privatePaths = [
      '/api/auth/me', '/api/partnerships/candidates', '/api/dashboard/1', '/api/cycle',
      '/api/cycles/1', '/api/cycles/1/1', '/api/goals', '/api/tactics', '/api/completions',
      '/api/settings', '/api/wams', '/api/export', '/api/weekly-planning', '/api/execution-recovery',
      '/api/broosts', '/api/profile', '/api/profile/avatar?u=1', '/api/reminders',
      '/api/tactic-evidence/1/1/0/file', '/api/execution-heatmap/1', '/api/archive-search',
      '/api/monitoring',
    ];
    for (const endpoint of privatePaths) {
      const response = await request(app).get(endpoint).set('Cookie', blockedCookie);
      expect(response.status, endpoint).toBe(401);
    }
    const pair = await request(app).post('/api/partnerships/pair').set('Cookie', blockedCookie).send({ targetUserId: 1 });
    expect(pair.status).toBe(401);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM partnerships').get()).toEqual({ n: 0 });
    // Denial neither erases old data nor mass-approves/deletes existing accounts.
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
  });

  it('lists/pairs only approved accounts while preserving approved partners and active/archived data', async () => {
    const app = freshApp();
    const [one, two] = seedAccounts();
    await request(app).post('/api/cycle').set('Cookie', two).send({ name: 'Archived cycle' });
    const goal = await request(app).post('/api/goals').set('Cookie', two).send({ title: 'Private history' });
    const oldCycleId = (getDb().prepare('SELECT cycle_id FROM goals WHERE id = ?').get(goal.body.id) as { cycle_id: number }).cycle_id;
    await request(app).post('/api/cycle/reset').set('Cookie', two).send({ name: 'Active cycle', confirm: true });
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    const candidates = await request(app).get('/api/partnerships/candidates').set('Cookie', one);
    expect(candidates.body.users).toEqual([{ id: 2, email: 'user2@example.test' }]);
    const blocked = await request(app).post('/api/partnerships/pair').set('Cookie', one).send({ targetUserId: 3 });
    expect(blocked.status).toBe(404);
    const pair = await request(app).post('/api/partnerships/pair').set('Cookie', one).send({ targetUserId: 2 });
    expect(pair.status).toBe(201);
    const partnership = getDb().prepare('SELECT * FROM partnerships').all();
    const dashboard = await request(app).get('/api/dashboard/2').set('Cookie', one);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.cycle.name).toBe('Active cycle');
    const archive = await request(app).get(`/api/cycles/2/${oldCycleId}`).set('Cookie', one);
    expect(archive.status).toBe(200);
    expect(archive.body.goals[0].title).toBe('Private history');
    expect((await request(app).get('/api/export').set('Cookie', two)).status).toBe(200);
    expect(getDb().prepare('SELECT * FROM partnerships').all()).toEqual(partnership);
    vi.stubEnv('APP_ALLOWED_USER_IDS', '2');
    expect((await request(app).get('/api/dashboard/2').set('Cookie', one)).status).toBe(401);
    expect(getDb().prepare('SELECT * FROM partnerships').all()).toEqual(partnership);
  });

  it('never creates reset mail/tokens for unapproved users, nor accepts their already-issued links', async () => {
    const app = freshApp();
    seedAccounts();
    const token = createResetToken(getDb(), 3).token;
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1,2');
    vi.stubEnv('ACS_EMAIL_CONNECTION_STRING', 'unused-test-value');
    vi.stubEnv('EMAIL_SENDER_ADDRESS', 'sender@example.test');
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test');
    const blocked = await request(app).post('/api/auth/forgot-password').send({ email: 'user3@example.test' });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'unknown@example.test' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual(unknown.body);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()).toEqual({ n: 1 });
    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'changed-password123' });
    expect(reset.status).toBe(400);
    expect(getDb().prepare('SELECT password_hash FROM users WHERE id = 3').get()).toEqual({ password_hash: passwordHash });
    const approved = await request(app).post('/api/auth/forgot-password').send({ email: 'user1@example.test' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(approved.body).toEqual(blocked.body);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe('user1@example.test');
  });
});
