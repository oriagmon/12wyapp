import express, { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { passwordSchema } from '../lib/validation.js';
import { destroyOtherSessions, getValidSession } from '../lib/sessions.js';
import { invalidateOutstandingTokens } from '../lib/passwordReset.js';
import { loadUserProfile } from '../lib/userProfile.js';
import { config } from '../config.js';
import { getAcceptedPartnershipForUser, isPartnershipMember } from '../lib/wam.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';
import { LOCALES, tReq, type Locale } from '../lib/i18n/index.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 500;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MiB
const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'errors.validation.displayNameEmpty')
    .max(MAX_DISPLAY_NAME, 'errors.validation.displayNameTooLong')
    .optional(),
  bio: z.string().trim().max(MAX_BIO, 'errors.validation.bioTooLong').optional(),
  locale: z.enum(LOCALES as unknown as [Locale, ...Locale[]]).optional(),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'errors.validation.currentPasswordRequired'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'errors.validation.newPasswordSameAsCurrent',
    path: ['newPassword'],
  });

/** Sniffs the real image format from its magic bytes, ignoring whatever Content-Type the
 *  client claimed — this is the actual defense against MIME spoofing (a renamed/relabeled
 *  file whose header lies about its type). Returns null for anything unrecognized, which
 *  includes SVG (never accepted — SVG can carry script content). */
function sniffImageMime(buffer: Buffer): (typeof AVATAR_MIME_TYPES)[number] | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Cheap early rejection of oversized uploads based on the declared Content-Length header,
 *  before any body bytes are read/buffered — keeps the size limit enforceable without ever
 *  needing to actually receive an oversized payload. express.raw()'s own `limit` option below
 *  is a second line of defense for chunked/absent-Content-Length requests. */
function rejectOversizedAvatar(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_AVATAR_BYTES) {
    // Drain (and discard) whatever body the client is still sending instead of abruptly
    // closing the socket — otherwise a client still mid-write when we respond can see
    // ECONNRESET/EPIPE instead of cleanly receiving this 413 response.
    req.resume();
    res.status(413).json({ error: tReq(req, 'api.payload.avatarTooLarge') });
    return;
  }
  next();
}

profileRouter.get('/', (req, res) => {
  const db = getDb();
  res.json(loadUserProfile(db, req.user!.id));
});

profileRouter.patch('/', (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const current = db.prepare('SELECT display_name, bio, locale FROM users WHERE id = ?').get(req.user!.id) as {
    display_name: string;
    bio: string;
    locale: string;
  };
  const displayName = parsed.data.displayName ?? current.display_name;
  const bio = parsed.data.bio ?? current.bio;
  const locale = parsed.data.locale ?? current.locale;
  db.prepare('UPDATE users SET display_name = ?, bio = ?, locale = ? WHERE id = ?').run(
    displayName,
    bio,
    locale,
    req.user!.id
  );
  res.json(loadUserProfile(db, req.user!.id));
});

/** PATCH /password — verifies the current password, rejects re-using the same password,
 *  updates the hash, invalidates any outstanding forgot-password reset token for this account
 *  (an authenticated change is itself a security reset — an old leaked reset link must not
 *  remain usable afterwards), and revokes every *other* active session for this user while
 *  preserving the session making this very request (so the caller is never logged out of
 *  their own change). The final transaction rechecks that same session and credential
 *  snapshot after bcrypt yields; stale changes fail without any of the three side effects. */
profileRouter.patch('/password', async (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  } | undefined;
  const staleChangeError = { error: tReq(req, 'api.profile.staleSession') };
  if (!row) {
    res.status(401).json(staleChangeError);
    return;
  }
  const ok = await verifyPassword(parsed.data.currentPassword, row.password_hash);
  if (!ok) {
    res.status(401).json({ error: tReq(req, 'api.profile.incorrectCurrentPassword') });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  const currentToken: unknown = req.cookies?.[config.sessionCookieName];
  const finalizeChange = db.transaction(() => {
    const session = getValidSession(db, currentToken);
    if (!session || session.user_id !== req.user!.id || !isUserAdmitted(req.user!.id)) return false;
    const update = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?')
      .run(newHash, req.user!.id, row.password_hash);
    if (update.changes !== 1) return false;
    invalidateOutstandingTokens(db, req.user!.id, new Date().toISOString());
    destroyOtherSessions(db, req.user!.id, session.token);
    return true;
  });
  if (!finalizeChange.immediate()) {
    res.status(401).json(staleChangeError);
    return;
  }

  res.json({ ok: true });
});

/** GET /avatar?u=<userId> — serves an avatar image. `u` is optional and defaults to the
 *  caller's own id (every pre-existing call site that never sent `u` keeps working exactly as
 *  before). When `u` names a *different* user, access is allowed only if that user is the
 *  caller's own currently-accepted partner (e.g. for the Duo Streak card/celebration overlay,
 *  which need to render the partner's avatar) — never a stranger, and never a former/pending
 *  partner. Every denial path (no such user, not your partner, no avatar set) returns the
 *  exact same 404 body so a stranger can never distinguish "this account doesn't exist" from
 *  "you're just not allowed to see it" from "they have no photo". */
profileRouter.get('/avatar', (req, res) => {
  // Authorization can change after logout or unpairing, even for an unchanged image.
  res.set('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  const db = getDb();
  const rawTarget = req.query.u;
  const targetParam = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;
  const requestedUserId = targetParam === undefined ? req.user!.id : Number(targetParam);
  if (!Number.isInteger(requestedUserId) || requestedUserId <= 0) {
    res.status(404).json({ error: tReq(req, 'api.profile.noAvatar') });
    return;
  }
  if (requestedUserId !== req.user!.id) {
    const partnership = getAcceptedPartnershipForUser(db, req.user!.id);
    if (!partnership || !isPartnershipMember(partnership, requestedUserId)) {
      res.status(404).json({ error: tReq(req, 'api.profile.noAvatar') });
      return;
    }
  }
  const row = db.prepare('SELECT avatar_mime, avatar_data FROM users WHERE id = ?').get(requestedUserId) as
    | { avatar_mime: string | null; avatar_data: Buffer | null }
    | undefined;
  if (!row || !row.avatar_mime || !row.avatar_data) {
    res.status(404).json({ error: tReq(req, 'api.profile.noAvatar') });
    return;
  }
  res.set('Content-Type', row.avatar_mime);
  // Never let the browser guess/execute the body as something other than the declared image
  // type (defense in depth alongside the magic-byte check on upload).
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(row.avatar_data);
});

profileRouter.put(
  '/avatar',
  rejectOversizedAvatar,
  express.raw({ type: [...AVATAR_MIME_TYPES], limit: MAX_AVATAR_BYTES }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: tReq(req, 'api.profile.unsupportedFileType') });
      return;
    }
    const sniffed = sniffImageMime(req.body);
    if (!sniffed) {
      res.status(400).json({ error: tReq(req, 'api.profile.invalidImageContent') });
      return;
    }
    const db = getDb();
    db.prepare(
      `UPDATE users SET avatar_mime = ?, avatar_data = ?, avatar_version = avatar_version + 1 WHERE id = ?`
    ).run(sniffed, req.body, req.user!.id);
    res.json(loadUserProfile(db, req.user!.id));
  }
);

profileRouter.delete('/avatar', (req, res) => {
  const db = getDb();
  db.prepare(
    `UPDATE users SET avatar_mime = NULL, avatar_data = NULL, avatar_version = avatar_version + 1 WHERE id = ?`
  ).run(req.user!.id);
  res.json(loadUserProfile(db, req.user!.id));
});
