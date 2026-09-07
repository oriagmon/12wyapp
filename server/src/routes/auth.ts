import { Router } from 'express';
import { getDb } from '../db.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../lib/password.js';
import { createSession, destroyAllSessions, destroySession } from '../lib/sessions.js';
import { forgotPasswordSchema, registerSchema, loginSchema, resetPasswordSchema } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { loadUserProfile } from '../lib/userProfile.js';
import { getAccessPolicy, isUserAdmitted } from '../lib/accessPolicy.js';
import {
  createResetToken,
  deliverResetPasswordEmail,
  hashResetToken,
  invalidateOutstandingTokens,
  isRateLimitedInDb,
  isRateLimitedInMemory,
  recordInMemoryAttempt,
  type PasswordResetTokenRow,
} from '../lib/passwordReset.js';
import { tReq } from '../lib/i18n/index.js';

export const authRouter = Router();

authRouter.get('/policy', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ registrationOpen: getAccessPolicy().registrationOpen });
});

function setSessionCookie(res: import('express').Response, token: string, expiresAt: Date): void {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    expires: expiresAt,
    path: '/',
  });
}

authRouter.post('/register', async (req, res) => {
  const registrationClosed = { error: 'ההרשמה הציבורית סגורה. לקבלת גישה יש לפנות למפעיל/ת המערכת' };
  if (!getAccessPolicy().registrationOpen) {
    res.status(403).json(registrationClosed);
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const { email, password } = parsed.data;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'כתובת האימייל כבר רשומה במערכת' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const insert = db.transaction(() => {
    if (!getAccessPolicy().registrationOpen) return null;
    const info = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email, passwordHash);
    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO user_settings (user_id, theme) VALUES (?, ?)').run(userId, 'dark');
    return { userId, ...createSession(db, userId) };
  });
  const registered = insert.immediate();
  if (!registered) {
    res.status(403).json(registrationClosed);
    return;
  }

  const { userId, token, expiresAt } = registered;
  setSessionCookie(res, token, expiresAt);
  res.status(201).json(loadUserProfile(db, userId));
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const { email, password } = parsed.data;
  const db = getDb();
  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
    | { id: number; email: string; password_hash: string }
    | undefined;

  const admitted = user !== undefined && isUserAdmitted(user.id);
  const ok = await verifyPassword(password, admitted ? user.password_hash : DUMMY_PASSWORD_HASH);
  if (!ok || !user || !admitted) {
    res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    return;
  }

  // bcrypt yields to other requests. Recovery/password changes must win over a login
  // that verified a now-revoked credential snapshot.
  const session = db.transaction(() => {
    if (!isUserAdmitted(user.id)) return null;
    const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
      | { password_hash: string }
      | undefined;
    if (current?.password_hash !== user.password_hash) return null;
    return createSession(db, user.id);
  }).immediate();
  if (!session) {
    res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    return;
  }
  const { token, expiresAt } = session;
  setSessionCookie(res, token, expiresAt);
  res.status(200).json(loadUserProfile(db, user.id));
});

authRouter.post('/logout', (req, res) => {
  const token: unknown = req.cookies?.[config.sessionCookieName];
  if (typeof token === 'string' && token.length > 0 && token.length <= 256) {
    destroySession(getDb(), token);
  }
  res.clearCookie(config.sessionCookieName, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(loadUserProfile(getDb(), req.user!.id));
});

const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  message: 'אם קיים חשבון המשויך לכתובת האימייל הזו, נשלח אליו קישור לאיפוס הסיסמה',
};

/**
 * POST /forgot-password — always returns the identical generic 200 response, regardless of
 * whether the email is malformed, belongs to no account, is rate-limited, or everything
 * succeeds — this is the entire enumeration-resistance strategy: nothing observable in the
 * response ever differs based on account existence (or on any of these other branches).
 *
 * Everything up to and including token creation is fast, synchronous SQLite work with no
 * provider-dependent latency, and happens *before* responding. The actual email transmission
 * — the one step with variable, provider-dependent latency — is deliberately deferred to run
 * after the response has already been sent (via setImmediate), so a real ACS round trip can
 * never contribute to (or leak information through) the response's own timing. This isn't a
 * claim of exact timing equality across all branches, only that the dominant, variable-cost
 * step (the network call) is removed from the request/response critical path entirely.
 */
authRouter.post('/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(200).json(GENERIC_FORGOT_PASSWORD_RESPONSE);
    return;
  }
  const { email } = parsed.data;
  const db = getDb();
  const now = new Date();
  const nowMs = now.getTime();

  // Recorded for every validated email address *before* any account lookup — including ones
  // that turn out not to belong to any account — so in-memory throttling behavior can never
  // be used to distinguish a real address from a fake one (see lib/passwordReset.ts for the
  // bounded-map/real-cleanup strategy this relies on).
  const alreadyLimitedInMemory = isRateLimitedInMemory(email, nowMs);
  if (!alreadyLimitedInMemory) {
    recordInMemoryAttempt(email, nowMs);
  }

  let deliver: (() => Promise<void>) | null = null;

  if (!alreadyLimitedInMemory) {
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as
      | { id: number; email: string }
      | undefined;
    if (user && isUserAdmitted(user.id) && !isRateLimitedInDb(db, user.id, now)) {
      // Only the newest token should ever be valid — an older, unused reset link must stop
      // working the moment a new one is requested.
      const { token } = db.transaction(() => {
        invalidateOutstandingTokens(db, user.id, now.toISOString());
        return createResetToken(db, user.id);
      }).immediate();
      deliver = () => deliverResetPasswordEmail(db, user, token);
    }
  }

  res.status(200).json(GENERIC_FORGOT_PASSWORD_RESPONSE);

  if (deliver) {
    const send = deliver;
    setImmediate(() => {
      send().catch((err) => {
        // A safety net only — deliverResetPasswordEmail already catches everything itself;
        // this exists purely so a genuinely unexpected bug here can never surface as an
        // unhandled promise rejection.
        // eslint-disable-next-line no-console
        console.error(
          `[auth] unexpected error in background password-reset email delivery: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      });
    });
  }
});

/**
 * POST /reset-password — race-safe single-use consumption: the token is looked up by hashing
 * the supplied plaintext and claimed via one atomic UPDATE (`WHERE used_at IS NULL AND
 * expires_at > now`), so two simultaneous requests for the same token can never both succeed
 * — the loser simply finds zero rows changed and gets the same generic invalid/expired error
 * a truly-invalid token would. Once claimed, the token stays consumed even if a later check
 * (e.g. new-password-equals-current-password) rejects the request — requesting a fresh reset
 * link is the way to retry, a deliberate simplification in favor of keeping the race-safety
 * guarantee simple and airtight.
 */
authRouter.post('/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const nowIso = new Date().toISOString();
  const tokenHash = hashResetToken(parsed.data.token);
  const invalidTokenError = { error: 'קישור האיפוס אינו תקין או שפג תוקפו. יש לבקש קישור חדש' };

  const claimed = db.transaction(() => {
    const tokenRow = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash) as
      | PasswordResetTokenRow
      | undefined;
    if (!tokenRow || tokenRow.used_at !== null || !Number.isFinite(Date.parse(tokenRow.expires_at)) ||
      Date.parse(tokenRow.expires_at) <= Date.parse(nowIso)) return null;
    const userRow = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(tokenRow.user_id) as
        | { id: number; password_hash: string }
        | undefined;
    if (!userRow || !isUserAdmitted(userRow.id)) return null;
    const claim = db.prepare(
      `UPDATE password_reset_tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
    ).run(nowIso, tokenHash, nowIso);
    return claim.changes === 1 ? { tokenRow, userRow } : null;
  }).immediate();
  if (!claimed) {
    await verifyPassword(parsed.data.newPassword, DUMMY_PASSWORD_HASH);
    res.status(400).json(invalidTokenError);
    return;
  }
  const { tokenRow, userRow } = claimed;

  const sameAsCurrent = await verifyPassword(parsed.data.newPassword, userRow.password_hash);
  if (sameAsCurrent) {
    res.status(400).json({ error: 'הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית' });
    return;
  }

  // bcrypt hashing is async and must complete *before* entering the transaction below, since
  // better-sqlite3 transactions are strictly synchronous. Once the hash is ready, the three
  // side effects of a successful reset — updating the password, invalidating every other
  // outstanding reset token, and revoking every session — are applied together atomically:
  // any one of them succeeding without the others would leave the account in an inconsistent
  // security state (e.g. password changed but old sessions still valid).
  const newHash = await hashPassword(parsed.data.newPassword);
  const finalizeReset = db.transaction(() => {
    const now = new Date();
    const current = db.prepare('SELECT * FROM password_reset_tokens WHERE id = ? AND token_hash = ? AND user_id = ?')
      .get(tokenRow.id, tokenHash, userRow.id) as PasswordResetTokenRow | undefined;
    const newerToken = db.prepare('SELECT id FROM password_reset_tokens WHERE user_id = ? AND id > ? LIMIT 1')
      .get(userRow.id, tokenRow.id);
    if (!isUserAdmitted(userRow.id) || !current || current.used_at !== nowIso ||
      current.expires_at !== tokenRow.expires_at || !Number.isFinite(Date.parse(current.expires_at)) ||
      Date.parse(current.expires_at) <= now.getTime() || newerToken) return false;
    const update = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?')
      .run(newHash, userRow.id, userRow.password_hash);
    if (update.changes !== 1) return false;
    invalidateOutstandingTokens(db, userRow.id, now.toISOString());
    destroyAllSessions(db, userRow.id);
    return true;
  });
  if (!finalizeReset.immediate()) {
    res.status(400).json(invalidTokenError);
    return;
  }

  res.json({ ok: true });
});
