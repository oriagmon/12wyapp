import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { getEmailConfig } from '../config.js';
import { sendEmail } from './emailSender.js';
import { isUserAdmitted } from './accessPolicy.js';

/** Within the required 30-60 minute window. */
export const RESET_TOKEN_TTL_MINUTES = 45;
export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_PER_WINDOW = 3;

export interface PasswordResetTokenRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** 256 bits of cryptographically random entropy, URL-safe. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** The only form of the token ever persisted — irreversible, so even full DB access never
 *  yields a usable token. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// --- In-process fast-path rate limiter -------------------------------------------------
// A cheap first line of defense against rapid-fire repeated requests for the same email,
// keyed by the normalized address. Resets on every process restart — that's fine, since the
// DB-backed check below (isRateLimitedInDb) is the durable, restart-surviving source of truth;
// this is purely a fast in-memory supplement to avoid hitting the DB for obviously-abusive
// bursts within a single process's lifetime.
//
// Deliberately keyed and pruned the *same way* regardless of whether the email belongs to a
// real account — the caller records/checks this before ever looking the account up — so an
// attacker can never distinguish existence by how throttling behaves. Because that means
// arbitrary attacker-chosen (possibly nonexistent) addresses can now accumulate keys, the map
// is bounded (see MAX_TRACKED_EMAILS) with real LRU-style eviction, and every prune fully
// deletes an email's entry once its timestamps have all aged out (never left as a dangling
// empty array) so the map's size reflects only genuinely-recent activity.
const inMemoryAttempts = new Map<string, number[]>();

/** Upper bound on distinct emails tracked at once. Comfortably larger than any legitimate
 *  household/team usage of this app, while still keeping a determined flood of distinct
 *  fake addresses from growing the map without bound. */
export const MAX_TRACKED_EMAILS = 500;

/** Reads this email's still-live timestamps, pruning (and — if now empty — fully deleting)
 *  any that have aged out of the window, and writes the pruned result back immediately. This
 *  is the single place both the read-only check and the record-attempt path go through, so
 *  cleanup always happens on any touch, not only when a new attempt is recorded. */
function pruneAndGet(email: string, now: number): number[] {
  const existing = inMemoryAttempts.get(email);
  if (!existing) return [];
  const pruned = existing.filter((t) => now - t < RATE_LIMIT_WINDOW_MINUTES * 60_000);
  if (pruned.length === 0) {
    inMemoryAttempts.delete(email);
  } else {
    inMemoryAttempts.set(email, pruned);
  }
  return pruned;
}

export function isRateLimitedInMemory(email: string, now: number = Date.now()): boolean {
  return pruneAndGet(email, now).length >= RATE_LIMIT_MAX_PER_WINDOW;
}

/** Records this attempt and, in the same pass, prunes any timestamps that have already aged
 *  out of the window — a simple, always-applied cleanup so the map never keeps stale entries
 *  (or an ever-growing key for a since-abandoned email) around indefinitely. Re-inserts the
 *  key so it moves to the "most recently used" end of the map's iteration order, then evicts
 *  the oldest entries if the map has grown past MAX_TRACKED_EMAILS — a simple, effective LRU. */
export function recordInMemoryAttempt(email: string, now: number = Date.now()): void {
  const timestamps = pruneAndGet(email, now);
  timestamps.push(now);
  inMemoryAttempts.delete(email);
  inMemoryAttempts.set(email, timestamps);
  while (inMemoryAttempts.size > MAX_TRACKED_EMAILS) {
    const oldestKey = inMemoryAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    inMemoryAttempts.delete(oldestKey);
  }
}

/** Test-only escape hatch: clears the in-memory limiter so isolated tests never see state
 *  left over from an earlier one (the map is otherwise process-lifetime, by design). */
export function clearInMemoryRateLimiter(): void {
  inMemoryAttempts.clear();
}

/** Test-only introspection: the current number of distinct tracked emails, used to verify
 *  the bounded-map eviction strategy without reaching into module-private state directly. */
export function inMemoryTrackedEmailCountForTesting(): number {
  return inMemoryAttempts.size;
}

/** DB-backed, restart-surviving rate limit: counts *every* reset request recorded for this
 *  account in the window (rows are never deleted — see migration 011 — so this count is
 *  accurate regardless of how many of those tokens have since been invalidated/superseded). */
export function isRateLimitedInDb(db: Database.Database, userId: number, now: Date = new Date()): boolean {
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM password_reset_tokens WHERE user_id = ? AND created_at >= ?')
    .get(userId, windowStart) as { count: number };
  return row.count >= RATE_LIMIT_MAX_PER_WINDOW;
}

/** Invalidates every outstanding token, INCLUDING a claim currently doing async bcrypt.
 *  Shortening expiry revokes that claim even if revocation and claim share a millisecond.
 *  Used when a new reset is requested or a password changes. Rows are never deleted and
 *  created_at is unchanged, so the rate-limit history stays accurate. */
export function invalidateOutstandingTokens(db: Database.Database, userId: number, nowIso: string): void {
  db.prepare(`UPDATE password_reset_tokens
    SET used_at = COALESCE(used_at, ?), expires_at = MIN(expires_at, ?)
    WHERE user_id = ? AND (used_at IS NULL OR expires_at > ?)`).run(nowIso, nowIso, userId, nowIso);
}

/** Invalidates one specific token by its hash — used when an email fails to send, so a token
 *  that was never actually delivered to anyone doesn't sit around as still "valid". */
export function invalidateTokenByHash(db: Database.Database, tokenHash: string, nowIso: string): void {
  db.prepare('UPDATE password_reset_tokens SET used_at = ?, expires_at = MIN(expires_at, ?) WHERE token_hash = ?')
    .run(nowIso, nowIso, tokenHash);
}

export function createResetToken(db: Database.Database, userId: number): { token: string; expiresAt: string } {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString();
  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    userId,
    tokenHash,
    expiresAt
  );
  return { token, expiresAt };
}

/** Builds the reset link from the configured app URL + the plaintext token — this URL (and
 *  the token within it) only ever exists in memory long enough to build and send the email;
 *  it is never logged and never persisted anywhere (only its SHA-256 hash is).
 *
 *  The token is carried in the URL *fragment* (`#resetToken=...`), not the query string:
 *  fragments are never transmitted to the server by a browser (so a reverse proxy's access
 *  log, or any server-side request log, never sees the token) and are stripped before the
 *  `Referer` header is sent for any subsequent cross-origin navigation from the reset page.
 *  The client also still accepts a legacy `?resetToken=` query link for backward compatibility
 *  with any already-sent emails. */
export function buildResetUrl(appUrl: string, token: string): string {
  const url = new URL(appUrl);
  url.hash = `resetToken=${encodeURIComponent(token)}`;
  return url.toString();
}

/** Sends the reset email off the caller's response path (see routes/auth.ts) and, on any
 *  failure, invalidates the token that was about to be delivered — a token that was never
 *  actually received by anyone must never sit around as still "valid". Never throws: every
 *  failure mode is caught and logged with only the numeric user id and a sanitized provider
 *  message (never the token, the reset URL, or the email address). */
export async function deliverResetPasswordEmail(
  db: Database.Database,
  user: { id: number; email: string },
  token: string
): Promise<void> {
  try {
    if (!isUserAdmitted(user.id)) {
      invalidateTokenByHash(db, hashResetToken(token), new Date().toISOString());
      return;
    }
    const { appUrl } = getEmailConfig();
    const resetUrl = buildResetUrl(appUrl, token);
    const { subject, html, plainText, attachments } = buildResetPasswordEmail(resetUrl);
    await sendEmail({ to: user.email, subject, html, plainText, attachments });
  } catch (err) {
    invalidateTokenByHash(db, hashResetToken(token), new Date().toISOString());
    // eslint-disable-next-line no-console
    console.error(
      `[auth] failed to send password reset email for user ${user.id}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
}

export function buildResetPasswordEmail(
  resetUrl: string
): BrandedEmail {
  return renderBrandedEmail({
    subject: 'איפוס סיסמה לחשבון 12WY שלך',
    eyebrow: 'איפוס סיסמה',
    title: 'איפוס הסיסמה שלך',
    paragraphs: [
      'קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך ב-12WY. לחיצה על הכפתור למטה תוביל לעמוד קביעת סיסמה חדשה.',
      'אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו — הסיסמה הנוכחית שלך תישאר ללא שינוי.',
    ],
    callout: {
      title: 'קישור אישי לשימוש חד־פעמי',
      text: `הקישור בתוקף למשך ${RESET_TOKEN_TTL_MINUTES} דקות ואפשר להשתמש בו פעם אחת בלבד.`,
    },
    cta: { label: 'איפוס הסיסמה', url: resetUrl },
    footer: 'זוהי הודעה אוטומטית שנשלחה על ידי 12WY.\nאין להעביר את הקישור לאדם אחר.',
  });
}
