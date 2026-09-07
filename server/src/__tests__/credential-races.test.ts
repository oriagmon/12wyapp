import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { freshApp } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { config } from '../config.js';
import { createSession } from '../lib/sessions.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createResetToken, hashResetToken, invalidateOutstandingTokens, invalidateTokenByHash,
} from '../lib/passwordReset.js';

interface Barrier {
  entered: Promise<void>;
  signal: () => void;
  wait: Promise<void>;
  release: () => void;
  claimed: boolean;
}
const barriers = vi.hoisted(() => new Map<string, Barrier>());

// Run the real cost-12 bcrypt operation, then hold its promise at the yield boundary
// before the route's final SQLite transaction. No sleeps or timing assumptions.
vi.mock('../lib/password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/password.js')>();
  async function pause(key: string) {
    const barrier = barriers.get(key);
    if (barrier && !barrier.claimed) {
      barrier.claimed = true;
      barrier.signal();
      await barrier.wait;
    }
  }
  return {
    ...actual,
    verifyPassword: async (plain: string, hash: string) => {
      const result = await actual.verifyPassword(plain, hash);
      await pause(`verify:${plain}`);
      return result;
    },
    hashPassword: async (plain: string) => {
      const result = await actual.hashPassword(plain);
      await pause(`hash:${plain}`);
      return result;
    },
  };
});
vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

function arm(operation: 'verify' | 'hash', plain: string): Barrier {
  let signal!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { signal = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const barrier = { entered, signal, wait, release, claimed: false };
  barriers.set(`${operation}:${plain}`, barrier);
  return barrier;
}

const pending: Promise<unknown>[] = [];
function start(test: request.Test) {
  // Supertest is lazy: start the HTTP request NOW, before awaiting a bcrypt barrier.
  const promise = test.then((response) => response);
  pending.push(promise);
  return promise;
}

const OLD = 'original-password123';
const RECOVERED = 'recovered-password456';
const STALE = 'stale-change-password789';
const originalNodeEnv = config.nodeEnv;
let originalHash: string;
let app: ReturnType<typeof freshApp>;
let cookie: string;
let otherToken: string;
beforeAll(async () => { originalHash = await hashPassword(OLD); });
beforeEach(() => {
  config.nodeEnv = 'test';
  vi.stubEnv('APP_ALLOWED_USER_IDS', '1');
  vi.stubEnv('APP_PUBLIC_URL', undefined);
  app = freshApp();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)').run('owner@example.test', originalHash);
  db.prepare('INSERT INTO user_settings (user_id, theme) VALUES (1, ?)').run('dark');
  cookie = `session_token=${createSession(db, 1).token}`;
  otherToken = createSession(db, 1).token;
});
afterEach(async () => {
  for (const barrier of barriers.values()) barrier.release();
  await Promise.allSettled(pending.splice(0));
  barriers.clear();
  closeDb();
  config.nodeEnv = originalNodeEnv;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const storedHash = () => (getDb().prepare('SELECT password_hash AS hash FROM users WHERE id = 1').get() as { hash: string }).hash;
const sessionCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
const login = (password: string) => request(app).post('/api/auth/login').send({ email: 'owner@example.test', password });
const change = (newPassword: string) => request(app).patch('/api/profile/password').set('Cookie', cookie)
  .send({ currentPassword: OLD, newPassword });
const reset = (token: string, newPassword: string) => request(app).post('/api/auth/reset-password').send({ token, newPassword });
async function recover() {
  const token = createResetToken(getDb(), 1).token;
  expect((await reset(token, RECOVERED)).status).toBe(200);
  expect(sessionCount()).toBe(0);
  const hash = storedHash();
  expect(hash).not.toBe(originalHash);
  expect(bcrypt.getRounds(hash)).toBe(12);
  expect(hash.slice(0, 29)).not.toBe(originalHash.slice(0, 29));
  return hash;
}

describe('final credential authorization after asynchronous bcrypt', () => {
  it('cannot finish an open-development registration after the operator closes admission during hashing', async () => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', undefined);
    const barrier = arm('hash', STALE);
    const registration = start(request(app).post('/api/auth/register').send({ email: 'new@example.test', password: STALE }));
    await barrier.entered;
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1');
    barrier.release();
    const response = await registration;
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(sessionCount()).toBe(2);
  });

  it('a login verified before recovery cannot recreate a session after recovery revokes them', async () => {
    const barrier = arm('verify', OLD);
    const staleLogin = start(login(OLD));
    await barrier.entered;
    const recoveredHash = await recover();
    barrier.release();
    const response = await staleLogin;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'אימייל או סיסמה שגויים' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessionCount()).toBe(0);
    expect(storedHash()).toBe(recoveredHash);
    expect((await login(RECOVERED)).status).toBe(200);
  });

  it('a login losing operator admission during bcrypt cannot mint a session', async () => {
    const barrier = arm('verify', OLD);
    const staleLogin = start(login(OLD));
    await barrier.entered;
    vi.stubEnv('APP_ALLOWED_USER_IDS', '2');
    barrier.release();
    const response = await staleLogin;
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessionCount()).toBe(2);
  });

  it.each(['verify', 'hash'] as const)('a profile password change paused at %s cannot overwrite recovery', async (operation) => {
    const barrier = arm(operation, operation === 'verify' ? OLD : STALE);
    const staleChange = start(change(STALE));
    await barrier.entered;
    const recoveredHash = await recover();
    barrier.release();
    const response = await staleChange;
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(storedHash()).toBe(recoveredHash);
    expect(sessionCount()).toBe(0);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect(await verifyPassword(RECOVERED, storedHash())).toBe(true);
  });

  it('rejects an older profile change even when the SAME session survived a newer password change', async () => {
    const barrier = arm('hash', STALE);
    const staleChange = start(change(STALE));
    await barrier.entered;
    expect((await change(RECOVERED)).status).toBe(200);
    const newerHash = storedHash();
    expect(sessionCount()).toBe(1);
    barrier.release();
    expect((await staleChange).status).toBe(401);
    expect(storedHash()).toBe(newerHash);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it.each(['logout', 'expiry', 'admission'] as const)('rechecks current-session authorization after hashing: %s', async (revocation) => {
    const barrier = arm('hash', STALE);
    const staleChange = start(change(STALE));
    await barrier.entered;
    if (revocation === 'logout') {
      expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    } else if (revocation === 'expiry') {
      getDb().prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(0).toISOString(), cookie.split('=')[1]);
    } else {
      vi.stubEnv('APP_ALLOWED_USER_IDS', '2');
    }
    barrier.release();
    expect((await staleChange).status).toBe(401);
    expect(storedHash()).toBe(originalHash);
    expect(getDb().prepare('SELECT token FROM sessions WHERE token = ?').get(otherToken)).toEqual({ token: otherToken });
  });

  it('a claimed older reset cannot overwrite newer recovery or revoke the new legitimate login', async () => {
    const token = createResetToken(getDb(), 1).token;
    const barrier = arm('hash', STALE);
    const staleReset = start(reset(token, STALE));
    await barrier.entered;
    const recoveredHash = await recover();
    expect((await login(RECOVERED)).status).toBe(200);
    expect(sessionCount()).toBe(1);
    barrier.release();
    const response = await staleReset;
    expect(response.status).toBe(400);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(storedHash()).toBe(recoveredHash);
    expect(sessionCount()).toBe(1);
  });

  it('a claimed reset cannot clobber an authenticated password change completed while it was hashing', async () => {
    const token = createResetToken(getDb(), 1).token;
    const barrier = arm('hash', STALE);
    const staleReset = start(reset(token, STALE));
    await barrier.entered;
    expect((await change(RECOVERED)).status).toBe(200);
    const newerHash = storedHash();
    barrier.release();
    expect((await staleReset).status).toBe(400);
    expect(storedHash()).toBe(newerHash);
    expect(sessionCount()).toBe(1);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it.each(['all-tokens', 'single-token'] as const)('revokes an in-flight claim even in its exact claim millisecond: %s', async (method) => {
    const token = createResetToken(getDb(), 1).token;
    const barrier = arm('hash', STALE);
    const staleReset = start(reset(token, STALE));
    await barrier.entered;
    const row = getDb().prepare('SELECT used_at FROM password_reset_tokens WHERE token_hash = ?').get(hashResetToken(token)) as { used_at: string };
    expect(row.used_at).toBeTruthy();
    if (method === 'all-tokens') invalidateOutstandingTokens(getDb(), 1, row.used_at);
    else invalidateTokenByHash(getDb(), hashResetToken(token), row.used_at);
    barrier.release();
    expect((await staleReset).status).toBe(400);
    expect(storedHash()).toBe(originalHash);
    expect(sessionCount()).toBe(2);
  });

  it('rejects a reset whose claim naturally expires while bcrypt is in flight', async () => {
    const { token, expiresAt } = createResetToken(getDb(), 1);
    const barrier = arm('hash', STALE);
    const staleReset = start(reset(token, STALE));
    await barrier.entered;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(expiresAt));
    barrier.release();
    expect((await staleReset).status).toBe(400);
    expect(storedHash()).toBe(originalHash);
    expect(sessionCount()).toBe(2);
  });

  it.each(['claim', 'admission', 'credential', 'newer-token'] as const)('revalidates reset authorization independent of other checks: %s', async (changed) => {
    const token = createResetToken(getDb(), 1).token;
    const barrier = arm('hash', STALE);
    const staleReset = start(reset(token, STALE));
    await barrier.entered;
    let expectedHash = originalHash;
    if (changed === 'claim') {
      getDb().prepare('UPDATE password_reset_tokens SET used_at = NULL WHERE token_hash = ?').run(hashResetToken(token));
    } else if (changed === 'admission') {
      vi.stubEnv('APP_ALLOWED_USER_IDS', '2');
    } else if (changed === 'credential') {
      expectedHash = await hashPassword(RECOVERED);
      getDb().prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(expectedHash);
    } else {
      createResetToken(getDb(), 1);
    }
    barrier.release();
    expect((await staleReset).status).toBe(400);
    expect(storedHash()).toBe(expectedHash);
    expect(sessionCount()).toBe(2);
  });
});
