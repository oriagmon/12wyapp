import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { sendEmail } from './emailSender.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';

/**
 * BROOST ("Bro" + "Boost"): a short supportive/playful message one partner sends the other.
 * See migration 014_partner_broosts.sql for the schema/immutability contract. This module is
 * the single source of truth for: the preset catalog, message validation, anti-spam rate
 * limiting, profile-safe participant serialization, and the delivery worker (claim/send/
 * retry/backoff) shared by both the immediate post-insert send attempt (routes/broosts.ts)
 * and the periodic CLI worker (sendBroostEmails.ts) — sharing one claim function is what
 * makes it impossible for the two to ever double-send the same BROOST.
 */

export const MAX_CUSTOM_MESSAGE_LENGTH = 500;
export const MAX_ATTEMPTS = 5;
/** Anti-spam: at most this many BROOSTs from one sender to one recipient in a rolling
 *  24-hour window. */
export const MAX_BROOSTS_PER_PAIR_PER_WINDOW = 5;
export const RATE_LIMIT_WINDOW_HOURS = 24;
/** Anti-spam: minimum seconds between consecutive BROOSTs from one sender to one recipient,
 *  independent of the rolling-window cap above (closes the "5 instantly, back to back" gap). */
export const COOLDOWN_SECONDS = 60;
const STALE_LEASE_MINUTES = 10;
// Bounded exponential-ish backoff (minutes) indexed by attempt number (1-based), mirroring
// scheduled_email_reminders' own schedule exactly (see lib/scheduledReminders.ts).
const BACKOFF_MINUTES = [5, 15, 45, 135, 405];

export type BroostEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface BroostRow {
  id: number;
  sender_id: number;
  recipient_id: number;
  partnership_id: number | null;
  preset_key: string | null;
  message: string;
  created_at: string;
  read_at: string | null;
  email_status: BroostEmailStatus;
  email_attempt_count: number;
  email_last_error: string | null;
  email_next_attempt_at: string | null;
  email_claimed_at: string | null;
  email_sent_at: string | null;
}

// --- Preset catalog ---------------------------------------------------------------------
// The single source of truth (exposed to the client via GET /api/broosts/presets rather than
// duplicated into a second client-side copy) — supportive/playful in tone, never insulting.
// A sent BROOST's `message` column is always a fully rendered, immutable snapshot of whatever
// preset text was current *at send time* — editing this list later never rewrites history.
export interface BroostPreset {
  key: string;
  message: string;
}

export const BROOST_PRESETS: BroostPreset[] = [
  { key: 'great_job', message: 'יש ביצועים ויש את זה. ריספקט 🫡' },
  { key: 'crushing_it', message: 'הטבלה ירוקה. מישהו פה הגיע לעבוד 🟩' },
  { key: 'keep_going', message: 'הקאמבק של השבוע מתחיל עכשיו 🎬' },
  { key: 'proud_of_you', message: '85%? יש קבלות 🧾' },
  { key: 'daily_boost', message: 'קפה, פלייליסט, וי. זה הסדר ☕' },
  { key: 'you_got_this', message: 'עוד וי אחד. בשביל העלילה 🎯' },
  { key: 'king_queen', message: 'הביצוע הזה שווה שידור חוזר 🔁' },
  { key: 'sending_love', message: 'גם ביום בלי וי — יש פה גב 🤝' },
];

export function getPresetByKey(key: string): BroostPreset | undefined {
  return BROOST_PRESETS.find((p) => p.key === key);
}

export type ResolvedBroostMessage =
  | { ok: true; presetKey: string | null; message: string }
  | { ok: false; error: string };

/** Validates the combination the client submits: exactly one of a valid preset key or a
 *  non-empty (post-trim) custom message, never both, never neither. Returns the immutable
 *  message snapshot to persist (the preset's current text, or the trimmed custom text). */
export function resolveBroostMessage(input: { presetKey?: string; customMessage?: string }): ResolvedBroostMessage {
  const trimmedCustom = input.customMessage?.trim() ?? '';
  const hasPreset = Boolean(input.presetKey);
  const hasCustom = trimmedCustom.length > 0;

  if (hasPreset && hasCustom) {
    return { ok: false, error: 'יש לבחור הודעה מוכנה או להקליד הודעה אישית — לא את שני האפשרויות יחד' };
  }
  if (!hasPreset && !hasCustom) {
    return { ok: false, error: 'יש לבחור הודעה מוכנה או להקליד הודעה אישית' };
  }
  if (hasPreset) {
    const preset = getPresetByKey(input.presetKey!);
    if (!preset) {
      return { ok: false, error: 'ההודעה המוכנה שנבחרה אינה קיימת' };
    }
    return { ok: true, presetKey: preset.key, message: preset.message };
  }
  if (trimmedCustom.length > MAX_CUSTOM_MESSAGE_LENGTH) {
    return { ok: false, error: `ההודעה האישית ארוכה מדי (עד ${MAX_CUSTOM_MESSAGE_LENGTH} תווים)` };
  }
  return { ok: true, presetKey: null, message: trimmedCustom };
}

export interface BroostRateLimitResult {
  limited: boolean;
  error?: string;
}

/** Anti-spam check for one (sender, recipient) directed pair — both the rolling 24h count cap
 *  and the 60s cooldown since the most recent BROOST from this sender to this recipient. The
 *  caller (routes/broosts.ts) runs this *and* the subsequent INSERT inside one
 *  `db.transaction()`, so the two can never observe/act on stale state relative to each other
 *  even under overlapping requests. */
export function checkBroostRateLimit(
  db: Database.Database,
  senderId: number,
  recipientId: number,
  now: Date = new Date()
): BroostRateLimitResult {
  const nowMs = now.getTime();
  const windowStartIso = new Date(nowMs - RATE_LIMIT_WINDOW_HOURS * 60 * 60_000).toISOString();
  const countRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM partner_broosts WHERE sender_id = ? AND recipient_id = ? AND created_at >= ?`
    )
    .get(senderId, recipientId, windowStartIso) as { count: number };
  if (countRow.count >= MAX_BROOSTS_PER_PAIR_PER_WINDOW) {
    return {
      limited: true,
      error: `הגעת למגבלה של ${MAX_BROOSTS_PER_PAIR_PER_WINDOW} BROOSTs ב-24 השעות האחרונות לשותף/ה הזה — נסה/י שוב מאוחר יותר`,
    };
  }
  const lastRow = db
    .prepare(`SELECT created_at FROM partner_broosts WHERE sender_id = ? AND recipient_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(senderId, recipientId) as { created_at: string } | undefined;
  if (lastRow) {
    const elapsedMs = nowMs - new Date(lastRow.created_at).getTime();
    if (elapsedMs < COOLDOWN_SECONDS * 1000) {
      return { limited: true, error: `יש להמתין לפחות ${COOLDOWN_SECONDS} שניות בין BROOST אחד למשנהו` };
    }
  }
  return { limited: false };
}

// --- Profile-safe participant identity ---------------------------------------------------

export interface BroostParticipant {
  id: number;
  /** displayName, falling back to email — never the raw email exposed as its own field (no
   *  separately identifiable email/bio in any BROOST response). */
  label: string;
  hasAvatar: boolean;
  avatarVersion: number;
}

/** Optional per-request cache for participant lookups, keyed by user id — shared across every
 *  row serialized in one response (e.g. a whole history page) so a user appearing as sender
 *  and/or recipient across many rows only ever triggers a single `SELECT ... FROM users` for
 *  that id, instead of one per row per column. Callers that only ever serialize a single row
 *  (e.g. the POST / response) can simply omit it. */
export type BroostParticipantCache = Map<number, BroostParticipant>;

/** The authenticated `/api/profile/avatar` route is self-only by design (see routes/
 *  profile.ts) — this deliberately does NOT add a participant-scoped avatar route. Clients
 *  must render this participant's identity using `label`-derived initials only, never by
 *  attempting to fetch an avatar image for a non-self userId (that would either silently
 *  serve back the *viewer's own* avatar bytes mislabeled as the partner's, or require a new
 *  authenticated cross-user image route — neither of which this feature needs). `hasAvatar`/
 *  `avatarVersion` are still included for shape consistency/future use, but are not meant to
 *  be used for image fetching here. */
export function loadBroostParticipant(db: Database.Database, userId: number, cache?: BroostParticipantCache): BroostParticipant {
  const cached = cache?.get(userId);
  if (cached) return cached;
  const row = db
    .prepare('SELECT id, email, display_name, avatar_mime, avatar_version FROM users WHERE id = ?')
    .get(userId) as { id: number; email: string; display_name: string; avatar_mime: string | null; avatar_version: number };
  const participant: BroostParticipant = {
    id: row.id,
    label: row.display_name?.trim() || row.email,
    hasAvatar: row.avatar_mime !== null,
    avatarVersion: row.avatar_version,
  };
  cache?.set(userId, participant);
  return participant;
}

export interface SerializedBroost {
  id: number;
  direction: 'sent' | 'received';
  presetKey: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
  emailStatus: BroostEmailStatus;
  /** Never the raw provider/internal error text — only whether one occurred. */
  emailHasError: boolean;
  /** True only for a terminal-looking 'failed' status that is actually still scheduled for
   *  an automatic retry (`email_next_attempt_at` is set and the attempt budget isn't
   *  exhausted) — lets the client distinguish "will retry automatically" from a truly
   *  terminal failure without ever exposing the raw error or the internal timestamp. */
  emailWillRetry: boolean;
  sender: BroostParticipant;
  recipient: BroostParticipant;
}

/** Serializes one row. `cache` is optional — pass a shared `BroostParticipantCache` when
 *  serializing many rows in one response (see serializeBroostList) to avoid a repeated
 *  per-row participant SELECT for the same user. */
export function serializeBroost(db: Database.Database, row: BroostRow, viewerId: number, cache?: BroostParticipantCache): SerializedBroost {
  return {
    id: row.id,
    direction: row.sender_id === viewerId ? 'sent' : 'received',
    presetKey: row.preset_key,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
    isRead: row.read_at !== null,
    emailStatus: row.email_status,
    emailHasError: row.email_last_error !== null,
    emailWillRetry: row.email_status === 'failed' && row.email_next_attempt_at !== null,
    sender: loadBroostParticipant(db, row.sender_id, cache),
    recipient: loadBroostParticipant(db, row.recipient_id, cache),
  };
}

/** Serializes a whole page of rows sharing one participant-lookup cache — the small,
 *  surgical fix for the otherwise-repeated per-row `SELECT ... FROM users` when the same
 *  sender/recipient appears across many rows in a single history/unread response. */
export function serializeBroostList(db: Database.Database, rows: BroostRow[], viewerId: number): SerializedBroost[] {
  const cache: BroostParticipantCache = new Map();
  return rows.map((row) => serializeBroost(db, row, viewerId, cache));
}

// --- Delivery worker (claim/send/retry) ---------------------------------------------------

function backoffMinutesForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx];
}

/** Sanitizes an error into a short, safe-to-persist/display message — never a raw stack
 *  trace, provider payload, or PII. Exported so the route layer can use the exact same
 *  sanitization when logging a background scheduling failure (see
 *  scheduleImmediateBroostSend below). */
export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'שגיאה לא ידועה בשליחת האימייל';
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function findDueBroostIds(db: Database.Database, nowIso: string, staleBeforeIso: string): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM partner_broosts
       WHERE email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))
       ORDER BY created_at ASC`
    )
    .all(nowIso, staleBeforeIso) as { id: number }[];
  return rows.map((r) => r.id);
}

/**
 * Atomically claims one BROOST for sending: a single compare-and-set UPDATE (same due/stale
 * conditions used to find it) that SQLite executes as one atomic statement — shared by both
 * the immediate post-insert send attempt and the periodic worker, which is exactly what makes
 * it impossible for the two to ever both send the same BROOST (whichever runs first wins;
 * the other's UPDATE simply matches zero rows).
 */
export function claimBroostForSending(
  db: Database.Database,
  id: number,
  nowIso: string,
  staleBeforeIso: string
): BroostRow | undefined {
  const info = db
    .prepare(
      `UPDATE partner_broosts
       SET email_status = 'sending', email_claimed_at = ?, email_attempt_count = email_attempt_count + 1
       WHERE id = ?
         AND email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))`
    )
    .run(nowIso, id, nowIso, staleBeforeIso);
  if (info.changes !== 1) return undefined;
  return db.prepare('SELECT * FROM partner_broosts WHERE id = ?').get(id) as BroostRow;
}

function markSent(db: Database.Database, id: number, nowIso: string): void {
  db.prepare(
    `UPDATE partner_broosts
     SET email_status = 'sent', email_sent_at = ?, email_last_error = NULL, email_next_attempt_at = NULL
     WHERE id = ?`
  ).run(nowIso, id);
}

function markFailed(db: Database.Database, id: number, error: string, nextAttemptAt: string | null): void {
  db.prepare(
    `UPDATE partner_broosts SET email_status = 'failed', email_last_error = ?, email_next_attempt_at = ? WHERE id = ?`
  ).run(error, nextAttemptAt, id);
}

export function buildBroostEmail(
  appUrl: string,
  message: string,
  senderLabel: string
): BrandedEmail {
  return renderBrandedEmail({
    subject: 'קיבלת BROOST 💪',
    eyebrow: 'BROOST · תמיכה בדרך',
    title: `${senderLabel} שלח/ה לך תמיכה!`,
    preheader: 'מילה טובה מהשותף או השותפה שלך מחכה לך ב-12WY.',
    paragraphs: [`${senderLabel} שלח/ה לך BROOST:`, message],
    cta: { label: 'פתיחת 12WY', url: appUrl },
    footer: 'זוהי הודעה אוטומטית שנשלחה על ידי 12WY.',
  });
}

export type ClaimedBroostOutcome = { status: 'sent' } | { status: 'failed'; error: string };

/**
 * Processes exactly one already-claimed BROOST: builds and sends its email, then persists the
 * outcome. Never throws — every failure mode (missing participant, provider error, a failure
 * to even persist the outcome) is caught and logged, so one row's failure can never abort
 * processing of any other row in the same worker run. Honest **at-least-once** semantics,
 * exactly like scheduled_email_reminders: overlapping claims can never both send the same
 * BROOST (see claimBroostForSending's atomic compare-and-swap), but a crash after the
 * provider accepts the email and before this function persists 'sent' leaves the row claimed;
 * once its lease goes stale it becomes claimable again and a future run may resend it.
 *
 * Deliberately re-checks only that both participants (sender/recipient) still exist as users
 * — never that they are still a *current* accepted partnership. A BROOST's validity is
 * anchored at creation time (the supportive message was genuine when sent); unlike scheduled
 * reminders, it is not silently cancelled just because the partnership was later removed.
 */
export async function processClaimedBroost(db: Database.Database, claimed: BroostRow, now: Date): Promise<ClaimedBroostOutcome> {
  const nowIso = now.toISOString();
  let emailAcceptedByProvider = false;
  try {
    const recipient = db.prepare('SELECT id, email FROM users WHERE id = ?').get(claimed.recipient_id) as
      | { id: number; email: string }
      | undefined;
    const sender = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(claimed.sender_id) as
      | { id: number; email: string; display_name: string }
      | undefined;
    // Both rows are FK-referenced with ON DELETE CASCADE, so if either user were deleted this
    // BROOST row would already be gone too — this is only a defensive guard.
    if (!recipient || !sender) {
      const error = 'הנמען או השולח של ה-BROOST לא נמצאו';
      markFailed(db, claimed.id, error, null);
      return { status: 'failed', error };
    }

    const { appUrl } = getEmailConfig();
    const senderLabel = sender.display_name?.trim() || sender.email;
    const { subject, html, plainText, attachments } = buildBroostEmail(appUrl, claimed.message, senderLabel);

    await sendEmail({ to: recipient.email, subject, html, plainText, attachments });
    emailAcceptedByProvider = true;
    markSent(db, claimed.id, nowIso);
    return { status: 'sent' };
  } catch (err) {
    const message = sanitizeError(err);
    if (emailAcceptedByProvider) {
      // eslint-disable-next-line no-console
      console.error(
        `[broosts] CRITICAL: BROOST ${claimed.id} was accepted by the email provider but ` +
          `persisting its "sent" status failed — it may be re-sent on a future retry once its ` +
          `claim lease goes stale: ${message}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(`[broosts] send failed for BROOST ${claimed.id}: ${message}`);
    }
    try {
      const nextAttemptAt =
        claimed.email_attempt_count >= MAX_ATTEMPTS
          ? null
          : new Date(now.getTime() + backoffMinutesForAttempt(claimed.email_attempt_count) * 60_000).toISOString();
      markFailed(db, claimed.id, message, nextAttemptAt);
    } catch (persistErr) {
      // eslint-disable-next-line no-console
      console.error(`[broosts] additionally failed to persist failure state for BROOST ${claimed.id}: ${sanitizeError(persistErr)}`);
    }
    return { status: 'failed', error: message };
  }
}

/** Attempts to send one just-inserted BROOST right away (called synchronously from the POST
 *  route, after the DB insert has already committed — so a failure here never rolls back the
 *  in-app BROOST, which already exists). If the row is somehow already claimed (e.g. an
 *  extremely narrow race with the periodic worker), this is a silent no-op — the other caller
 *  owns delivering it. */
export async function attemptImmediateBroostSend(db: Database.Database, id: number, now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();
  const claimed = claimBroostForSending(db, id, nowIso, staleBeforeIso);
  if (!claimed) return;
  await processClaimedBroost(db, claimed, now);
}

/**
 * Schedules `attemptImmediateBroostSend` to run *after* the current response has already been
 * sent (via `setImmediate`), so the caller (the POST / route handler) can respond `201` with
 * `emailStatus: 'pending'` the moment the in-app row is committed — a provider round trip
 * never contributes to request/response latency. `processClaimedBroost` itself already never
 * throws (every failure mode is caught and persisted as a 'failed' row), so this `.catch` is a
 * pure safety net: it exists solely so a genuinely unexpected bug here can never surface as an
 * unhandled promise rejection or crash the process, and if it does trigger, only this
 * BROOST's numeric id and a sanitized error message are ever logged — never the message body,
 * a raw stack trace, or any participant PII. This does not claim exactly-once delivery: the
 * periodic worker (`runDueBroostEmails`) remains the durable safety net for anything this
 * best-effort immediate attempt doesn't resolve (e.g. the process exiting between the insert
 * and this callback firing).
 */
export function scheduleImmediateBroostSend(db: Database.Database, id: number, now: Date = new Date()): void {
  setImmediate(() => {
    attemptImmediateBroostSend(db, id, now).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[broosts] unexpected error scheduling immediate send for BROOST ${id}: ${sanitizeError(err)}`);
    });
  });
}

export interface BroostDeliveryRunResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: { id: number; error: string }[];
}

/** Claims and delivers every currently-due BROOST (including recovering one abandoned by a
 *  crashed worker/process past the stale-lease threshold) — see processClaimedBroost's doc
 *  comment for the full at-least-once semantics. Intended to be invoked every minute by a
 *  systemd timer (see deploy/12-week-dashboard-broost-emails.timer.sample) as a safety-net
 *  catch-all for anything the immediate post-insert send attempt didn't already resolve
 *  (e.g. a transient failure now due for its backoff retry). */
export async function runDueBroostEmails(db: Database.Database, now: Date = new Date()): Promise<BroostDeliveryRunResult> {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();

  const result: BroostDeliveryRunResult = { attempted: 0, sent: 0, failed: 0, skipped: 0, failures: [] };

  for (const id of findDueBroostIds(db, nowIso, staleBeforeIso)) {
    const claimed = claimBroostForSending(db, id, nowIso, staleBeforeIso);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    result.attempted += 1;
    const outcome = await processClaimedBroost(db, claimed, now);
    if (outcome.status === 'sent') {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.failures.push({ id: claimed.id, error: outcome.error });
    }
  }

  return result;
}
