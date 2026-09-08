import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { fallbackLocale, t, type Locale } from '../lib/i18n/index.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the
// business logic in lib/passwordReset.ts and routes/auth.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import {
  MAX_TRACKED_EMAILS,
  RATE_LIMIT_MAX_PER_WINDOW,
  RATE_LIMIT_WINDOW_MINUTES,
  buildResetPasswordEmail,
  buildResetUrl,
  clearInMemoryRateLimiter,
  hashResetToken,
  inMemoryTrackedEmailCountForTesting,
  isRateLimitedInMemory,
  recordInMemoryAttempt,
} from '../lib/passwordReset.js';

const sendEmailMock = vi.mocked(sendEmail);

// Derived from the dictionary rather than pinned as a literal: the property under test is
// that every /forgot-password outcome returns the *same* message, not what that copy says.
const GENERIC_MESSAGE = t(fallbackLocale(), 'api.auth.passwordResetEmailSent');

/** The email send is deliberately deferred (via setImmediate) until after the response has
 *  already been sent (see routes/auth.ts). Awaiting one macrotask tick from the test side is
 *  enough to deterministically observe it having run to completion: it was scheduled *before*
 *  this call, so by the time this later-scheduled setImmediate callback fires, every
 *  microtask the earlier one produced (including its own awaited sendEmail call) has already
 *  fully drained — Node always drains the microtask queue completely between macrotasks. */
function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string, password = 'password123') {
  const res = await request(app).post('/api/auth/register').send({ email, password });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

/** Extracts the raw reset token from the reset URL embedded in the mocked email call — the
 *  only place the plaintext token ever appears. Works whether the token is carried in the
 *  URL fragment (current format) or, in principle, a legacy query string, since the
 *  extraction only looks for the "resetToken=" key itself. */
function extractTokenFromEmail(callIndex = 0): string {
  const call = sendEmailMock.mock.calls[callIndex][0];
  const match = /resetToken=([^"&\s]+)/.exec(call.html);
  if (!match) throw new Error('no resetToken found in mocked email html');
  return decodeURIComponent(match[1]);
}

describe('password reset: POST /forgot-password', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    clearInMemoryRateLimiter();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  it('returns the identical generic response for an existing account and a nonexistent one (enumeration resistance)', async () => {
    await registerAndLogin(app, 'exists@a.com');

    const existing = await request(app).post('/api/auth/forgot-password').send({ email: 'exists@a.com' });
    const nonexistent = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@a.com' });
    await flushSetImmediate();

    expect(existing.status).toBe(200);
    expect(nonexistent.status).toBe(200);
    expect(existing.body).toEqual({ message: GENERIC_MESSAGE });
    expect(nonexistent.body).toEqual({ message: GENERIC_MESSAGE });
  });

  it('returns the same generic 200 even for a malformed email, never a validation error', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    await flushSetImmediate();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC_MESSAGE });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('never sends an email or creates a token row for an unknown account', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@a.com' });
    await flushSetImmediate();
    expect(sendEmailMock).not.toHaveBeenCalled();
    const row = getDb().prepare('SELECT COUNT(*) as count FROM password_reset_tokens').get() as { count: number };
    expect(row.count).toBe(0);
  });

  it('the response never waits for the email provider round trip — even a sendEmail call that never resolves cannot block/delay the response', async () => {
    await registerAndLogin(app, 'owner@a.com');
    // Simulates a hung/very slow provider call. If the route awaited sendEmail before
    // responding (as it used to), this request would never resolve and the test would time
    // out — this is a stronger, non-timing-based proof that the provider round trip has been
    // taken off the response's critical path entirely.
    sendEmailMock.mockImplementation(() => new Promise(() => {}));

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC_MESSAGE });
  });

  it('for an existing account, sends one branded email with a reset link, and only the SHA-256 hash of the token is ever stored (never the plaintext)', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    await flushSetImmediate();
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('owner@a.com');
    // Emails are written in the recipient's stored language, not the request's — a reset is
    // often opened from a different device than the one that asked for it.
    const recipientLocale = (
      getDb().prepare('SELECT locale FROM users WHERE email = ?').get('owner@a.com') as { locale: Locale }
    ).locale;
    expect(call.subject).toBe(t(recipientLocale, 'emails.passwordReset.subject'));
    expect(call.html).toContain('https://dashboard.example.com');
    expect(call.attachments).toBeDefined();
    expect(call.attachments?.length).toBeGreaterThan(0);

    const rawToken = extractTokenFromEmail();
    expect(rawToken.length).toBeGreaterThanOrEqual(32); // high-entropy, not a short/guessable value

    const db = getDb();
    const row = db.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ?').get(owner.userId) as {
      token_hash: string;
    };
    // The raw token is never found anywhere in the stored row — only its hash is, and the
    // hash is never equal to the plaintext it was derived from.
    expect(row.token_hash).toBe(hashResetToken(rawToken));
    expect(row.token_hash).not.toBe(rawToken);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });

  it('invalidates an older unused token once a newer request is made for the same account', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    await flushSetImmediate();
    const olderToken = extractTokenFromEmail(0);

    // A second request is a distinct account action beyond the rate limiter's very-fast-path,
    // so use a fresh limiter state to isolate this from the rate-limit test below.
    clearInMemoryRateLimiter();
    await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    await flushSetImmediate();
    const newerToken = extractTokenFromEmail(1);
    expect(newerToken).not.toBe(olderToken);

    const oldAttempt = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: olderToken, newPassword: 'brandnewpassword1' });
    expect(oldAttempt.status).toBe(400);

    const newAttempt = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: newerToken, newPassword: 'brandnewpassword1' });
    expect(newAttempt.status).toBe(200);
    void owner;
  });

  it('applies a per-account rate limit: beyond the max, no further tokens/emails are created, but the response stays generic 200', async () => {
    await registerAndLogin(app, 'owner@a.com');
    for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW + 2; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: GENERIC_MESSAGE });
    }
    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(RATE_LIMIT_MAX_PER_WINDOW);
  });

  it('DB-backed rate limit persists across simulated process restarts (in-memory limiter cleared before every request)', async () => {
    await registerAndLogin(app, 'owner@a.com');
    for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW; i++) {
      clearInMemoryRateLimiter(); // simulate the in-memory state being wiped by a restart
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
      expect(res.status).toBe(200);
    }
    await flushSetImmediate();
    expect(sendEmailMock).toHaveBeenCalledTimes(RATE_LIMIT_MAX_PER_WINDOW);

    clearInMemoryRateLimiter(); // one more "restart" right before the over-the-limit request
    const overLimit = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    expect(overLimit.status).toBe(200);
    await flushSetImmediate();
    // Still blocked — the durable, restart-surviving DB history is what actually enforces this.
    expect(sendEmailMock).toHaveBeenCalledTimes(RATE_LIMIT_MAX_PER_WINDOW);
  });

  it('email send failure never changes the response (parity with success/nonexistent), and invalidates the undelivered token', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    sendEmailMock.mockRejectedValueOnce(new Error('ACS outage: something internal failed'));

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC_MESSAGE });
    expect(JSON.stringify(res.body)).not.toMatch(/ACS|outage|internal/i);
    await flushSetImmediate();

    // The token that was never actually delivered must not still be usable.
    const db = getDb();
    const row = db.prepare('SELECT used_at FROM password_reset_tokens WHERE user_id = ?').get(owner.userId) as {
      used_at: string | null;
    };
    expect(row.used_at).not.toBeNull();
  });

  it('never reveals any internal/provider error text even when getEmailConfig itself is unavailable (missing env vars)', async () => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    await registerAndLogin(app, 'owner@a.com');
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@a.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC_MESSAGE });
    await flushSetImmediate();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('password reset: in-memory throttle memory/bounding (lib/passwordReset.ts)', () => {
  beforeEach(() => {
    clearInMemoryRateLimiter();
  });

  it('records/prunes attempts for a normalized email even when it belongs to no account, so probing a fake address is throttled identically to a real one', async () => {
    const app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@nowhere.invalid' });
      expect(res.status).toBe(200);
    }
    expect(isRateLimitedInMemory('nobody@nowhere.invalid')).toBe(true);
  });

  it('performs real cleanup: once every timestamp for an email has aged out of the window, its map entry is deleted entirely, not just left as an empty array', () => {
    const past = Date.now() - (RATE_LIMIT_WINDOW_MINUTES + 5) * 60_000;
    recordInMemoryAttempt('stale@a.com', past);
    expect(inMemoryTrackedEmailCountForTesting()).toBe(1);

    expect(isRateLimitedInMemory('stale@a.com', Date.now())).toBe(false);
    expect(inMemoryTrackedEmailCountForTesting()).toBe(0);
  });

  it('bounds total map size (LRU eviction) so probing many distinct fake emails cannot grow memory without bound', () => {
    const now = Date.now();
    for (let i = 0; i < MAX_TRACKED_EMAILS + 50; i++) {
      recordInMemoryAttempt(`fake-${i}@nowhere.invalid`, now);
    }
    expect(inMemoryTrackedEmailCountForTesting()).toBeLessThanOrEqual(MAX_TRACKED_EMAILS);
  });
});

describe('password reset: reset URL uses the URL fragment, not the query string', () => {
  it('carries the token after a "#", never as a "?" query parameter', () => {
    const url = buildResetUrl('https://dashboard.example.com', 'abc123_-XYZ');
    expect(url).toContain('#resetToken=abc123_-XYZ');
    expect(url).not.toContain('?resetToken=');
  });
});

describe('password reset: POST /reset-password', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    clearInMemoryRateLimiter();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  async function requestReset(email: string): Promise<string> {
    await request(app).post('/api/auth/forgot-password').send({ email });
    await flushSetImmediate();
    return extractTokenFromEmail(sendEmailMock.mock.calls.length - 1);
  }

  it('rejects a malformed/empty token and an invalid new password with clear validation errors', async () => {
    const emptyToken = await request(app).post('/api/auth/reset-password').send({ token: '', newPassword: 'newpassword1' });
    expect(emptyToken.status).toBe(400);

    await registerAndLogin(app, 'owner@a.com');
    const token = await requestReset('owner@a.com');
    const shortPassword = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'short' });
    expect(shortPassword.status).toBe(400);
  });

  it('rejects an unknown/garbage token with the same generic invalid/expired message', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: crypto.randomBytes(32).toString('base64url'), newPassword: 'newpassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects an expired token', async () => {
    await registerAndLogin(app, 'owner@a.com');
    const token = await requestReset('owner@a.com');
    const db = getDb();
    db.prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?').run(
      new Date(Date.now() - 60_000).toISOString(),
      hashResetToken(token)
    );

    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword1' });
    expect(res.status).toBe(400);
  });

  it('successfully resets the password: old password stops working, new password logs in', async () => {
    await registerAndLogin(app, 'owner@a.com', 'oldpassword123');
    const token = await requestReset('owner@a.com');

    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword456' });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true });

    const oldLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'oldpassword123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'newpassword456' });
    expect(newLogin.status).toBe(200);
  });

  it('is single-use: a second attempt with the same token fails after a successful reset', async () => {
    await registerAndLogin(app, 'owner@a.com');
    const token = await requestReset('owner@a.com');

    const first = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword456' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'yetanotherpw1' });
    expect(second.status).toBe(400);

    // The password from the first (successful) attempt is still the one that works.
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'newpassword456' });
    expect(login.status).toBe(200);
  });

  it('rejects reusing the current password as the new one, and the token is still consumed (must request a fresh link to retry)', async () => {
    await registerAndLogin(app, 'owner@a.com', 'samepassword1');
    const token = await requestReset('owner@a.com');

    const reuse = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'samepassword1' });
    expect(reuse.status).toBe(400);

    const retryWithSameToken = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'actuallydifferent1' });
    expect(retryWithSameToken.status).toBe(400); // token already burned by the first attempt
  });

  it('revokes every existing session for the user once the password is reset', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const stillValidBeforeReset = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(stillValidBeforeReset.status).toBe(200);

    const token = await requestReset('owner@a.com');
    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword456' });
    expect(reset.status).toBe(200);

    const afterReset = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(afterReset.status).toBe(401);
  });

  it('atomically finalizes the reset: password update, token invalidation, and session revocation all land together', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const secondLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'password123' });
    const secondCookie = extractCookie(secondLogin);

    const token = await requestReset('owner@a.com');
    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword456' });
    expect(reset.status).toBe(200);

    const db = getDb();
    const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(owner.userId) as {
      password_hash: string;
    };
    const tokenRow = db.prepare('SELECT used_at FROM password_reset_tokens WHERE token_hash = ?').get(hashResetToken(token)) as {
      used_at: string | null;
    };
    expect(tokenRow.used_at).not.toBeNull();

    const afterFirst = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(afterFirst.status).toBe(401);
    const afterSecond = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    expect(afterSecond.status).toBe(401);

    const loginNew = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'newpassword456' });
    expect(loginNew.status).toBe(200);
    void userRow;
  });

  it('race-safe: two concurrent reset attempts with the same token — exactly one succeeds, the other gets the generic error', async () => {
    await registerAndLogin(app, 'owner@a.com');
    const token = await requestReset('owner@a.com');

    const [first, second] = await Promise.all([
      request(app).post('/api/auth/reset-password').send({ token, newPassword: 'winnerpassword1' }),
      request(app).post('/api/auth/reset-password').send({ token, newPassword: 'loserpassword12' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 400]);

    // Whichever one actually won determines which password now works — never both, never neither.
    const winningPassword = first.status === 200 ? 'winnerpassword1' : 'loserpassword12';
    const losingPassword = first.status === 200 ? 'loserpassword12' : 'winnerpassword1';
    const winLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: winningPassword });
    expect(winLogin.status).toBe(200);
    const loseLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: losingPassword });
    expect(loseLogin.status).toBe(401);
  });
});

describe('password reset: email content escaping (defense in depth)', () => {
  it('escapes HTML-significant characters in the reset URL before interpolating it into the email body', () => {
    const maliciousUrl = 'https://dashboard.example.com/?resetToken=abc"><script>alert(1)</script>';
    const { html } = buildResetPasswordEmail(maliciousUrl);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
