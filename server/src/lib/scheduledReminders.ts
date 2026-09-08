import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { israelWallTimeToUtcIso, utcIsoToIsraelWallTime } from './israelTime.js';
import { getAcceptedPartner } from './access.js';
import { sendEmail } from './emailSender.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { t, type Locale } from './i18n/index.js';

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 2000;
export const MAX_ATTEMPTS = 5;
/** Anti-abuse cap: this is a private two-user app, but a partner's email address is still a
 *  real recipient — cap how many not-yet-resolved reminders one creator can have outstanding
 *  at once, regardless of who they're addressed to. */
export const MAX_ACTIVE_REMINDERS_PER_CREATOR = 100;
const STALE_LEASE_MINUTES = 10;
// Bounded exponential-ish backoff (minutes) indexed by attempt number (1-based). The last
// entry repeats for any attempt beyond its index, capping growth.
const BACKOFF_MINUTES = [5, 15, 45, 135, 405];

export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface ScheduledEmailReminderRow {
  id: number;
  creator_user_id: number;
  recipient_user_id: number;
  title: string;
  body: string;
  scheduled_for: string;
  status: ReminderStatus;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Validates a proposed recipient for a reminder the given creator is authoring: only the
 * creator themself, or their current accepted partner (re-checked fresh every time — a past
 * partnership that has since been removed is never honored). Returns the recipient's safe
 * {id, email} on success, or null if disallowed.
 */
export function resolveAllowedRecipient(
  db: Database.Database,
  creatorUserId: number,
  recipientUserId: number
): { id: number; email: string } | null {
  if (recipientUserId === creatorUserId) {
    const row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(creatorUserId) as
      | { id: number; email: string }
      | undefined;
    return row ?? null;
  }
  const partner = getAcceptedPartner(db, creatorUserId);
  if (partner && partner.id === recipientUserId) {
    return { id: partner.id, email: partner.email };
  }
  return null;
}

/** Counts a creator's currently "active" (not yet terminally resolved) reminders — pending,
 *  currently claimed for sending, or failed-but-still-retryable — for the anti-abuse cap. */
export function countActiveReminders(db: Database.Database, creatorUserId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM scheduled_email_reminders
       WHERE creator_user_id = ? AND status IN ('pending', 'sending', 'failed')`
    )
    .get(creatorUserId) as { count: number };
  return row.count;
}

/**
 * Validates+converts an Israel wall-clock `YYYY-MM-DDTHH:mm` string (as sent by the client's
 * datetime-local input, unconverted) to a UTC ISO timestamp — the server is always the
 * authoritative validator here (never trusts a client-side conversion), rejecting both
 * malformed input and wall-clock times that don't exist due to Israel's DST transitions.
 * Also requires the resulting instant to be strictly in the future relative to `now`.
 */
export function validateScheduledFor(wallTime: string, now: Date = new Date()): { ok: true; iso: string } | { ok: false; error: string } {
  const iso = israelWallTimeToUtcIso(wallTime);
  if (!iso) {
    return {
      ok: false,
      error: 'api.reminders.invalidIsraelTime',
    };
  }
  if (new Date(iso).getTime() <= now.getTime()) {
    return { ok: false, error: 'api.reminders.mustBeFuture' };
  }
  return { ok: true, iso };
}

export interface ReminderResponse {
  id: number;
  title: string;
  body: string;
  scheduledFor: string;
  scheduledForIsraelWallTime: string;
  status: ReminderStatus;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  recipient: { id: number; email: string; isSelf: boolean };
  createdAt: string;
  updatedAt: string;
}

export function serializeReminder(
  row: ScheduledEmailReminderRow,
  recipient: { id: number; email: string }
): ReminderResponse {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    scheduledFor: row.scheduled_for,
    scheduledForIsraelWallTime: utcIsoToIsraelWallTime(row.scheduled_for),
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    sentAt: row.sent_at,
    recipient: { id: recipient.id, email: recipient.email, isSelf: recipient.id === row.creator_user_id },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function backoffMinutesForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx];
}

/** Finds ids of reminders currently eligible for the delivery worker to claim: due
 *  (`pending`/`failed` with `next_attempt_at` <= now), or stuck in `sending` past the stale
 *  lease threshold (a crashed worker's abandoned claim). */
function findDueReminderIds(db: Database.Database, nowIso: string, staleBeforeIso: string): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM scheduled_email_reminders
       WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ?
         AND (status IN ('pending', 'failed') OR (status = 'sending' AND claimed_at <= ?))
       ORDER BY scheduled_for ASC`
    )
    .all(nowIso, staleBeforeIso) as { id: number }[];
  return rows.map((r) => r.id);
}

/**
 * Atomically claims one reminder for this worker: a single UPDATE with the same due/stale
 * conditions used to find it, which SQLite executes as one atomic statement — so even two
 * overlapping worker processes racing on the same row can never both succeed (the loser's
 * UPDATE simply matches zero rows, since the first writer's status change makes the WHERE
 * clause no longer match for the second). No explicit transaction wrapper is needed for this
 * single-statement compare-and-set.
 */
function claimReminder(
  db: Database.Database,
  id: number,
  nowIso: string,
  staleBeforeIso: string
): ScheduledEmailReminderRow | undefined {
  const info = db
    .prepare(
      `UPDATE scheduled_email_reminders
       SET status = 'sending', claimed_at = ?, attempt_count = attempt_count + 1, updated_at = ?
       WHERE id = ?
         AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
         AND (status IN ('pending', 'failed') OR (status = 'sending' AND claimed_at <= ?))`
    )
    .run(nowIso, nowIso, id, nowIso, staleBeforeIso);
  if (info.changes !== 1) return undefined;
  return db.prepare('SELECT * FROM scheduled_email_reminders WHERE id = ?').get(id) as ScheduledEmailReminderRow;
}

function markSent(db: Database.Database, id: number, nowIso: string): void {
  db.prepare(
    `UPDATE scheduled_email_reminders
     SET status = 'sent', sent_at = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(nowIso, nowIso, id);
}

function markFailed(db: Database.Database, id: number, nowIso: string, error: string, nextAttemptAt: string | null): void {
  db.prepare(
    `UPDATE scheduled_email_reminders
     SET status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(error, nextAttemptAt, nowIso, id);
}

/** Terminally cancels a reminder claimed by the delivery worker because, at send time, its
 *  recipient is no longer allowed (the partnership that made them valid has since been
 *  removed). 'cancelled' — not 'failed' — since this isn't a delivery failure at all; the
 *  reason is still recorded in last_error for the creator's own visibility/debugging. */
function markAutoCancelled(db: Database.Database, id: number, nowIso: string, reason: string): void {
  db.prepare(
    `UPDATE scheduled_email_reminders
     SET status = 'cancelled', last_error = ?, next_attempt_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(reason, nowIso, id);
}

export type CasResult = 'ok' | 'conflict';

/**
 * Atomically applies an edit to a reminder — but only if it is still `pending`/`failed` at
 * the moment of the write itself (not merely at some earlier read). This is the compare-and-
 * swap guard against the delivery worker claiming (or fully sending) the very same row in the
 * narrow window between an API request reading it and then writing to it. Returns 'conflict'
 * (never throws) if the row's status had already moved on by the time this ran — the caller
 * should surface that as an HTTP 409, not silently overwrite worker-owned state.
 */
export function casUpdateReminder(
  db: Database.Database,
  id: number,
  fields: { title: string; body: string; scheduledFor: string; recipientUserId: number }
): CasResult {
  const info = db
    .prepare(
      `UPDATE scheduled_email_reminders
       SET title = ?, body = ?, scheduled_for = ?, recipient_user_id = ?,
           status = 'pending', attempt_count = 0, last_error = NULL, claimed_at = NULL,
           next_attempt_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status IN ('pending', 'failed')`
    )
    .run(fields.title, fields.body, fields.scheduledFor, fields.recipientUserId, fields.scheduledFor, id);
  return info.changes === 1 ? 'ok' : 'conflict';
}

/** Same compare-and-swap guarantee as {@link casUpdateReminder}, for cancellation. */
export function casCancelReminder(db: Database.Database, id: number): CasResult {
  const info = db
    .prepare(
      `UPDATE scheduled_email_reminders
       SET status = 'cancelled', next_attempt_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status IN ('pending', 'failed')`
    )
    .run(id);
  return info.changes === 1 ? 'ok' : 'conflict';
}

/** Sanitizes an error into a short, safe-to-persist/display message — never a raw stack
 *  trace or internal detail. */
function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'unknown email send error';
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

export function buildReminderEmail(
  appUrl: string,
  reminder: ScheduledEmailReminderRow,
  recipientIsCreator: boolean,
  scheduledByLabel: string,
  locale: Locale = 'en'
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const tz = locale === 'he' ? 'he-IL' : 'en-US';
  const israelTime = new Intl.DateTimeFormat(tz, {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(reminder.scheduled_for));

  const intro = recipientIsCreator
    ? tl('emails.reminder.selfIntro')
    : tl('emails.reminder.partnerIntro', { name: scheduledByLabel });

  return renderBrandedEmail({
    subject: `${tl('emails.reminder.subjectPrefix')}: ${reminder.title}`,
    eyebrow: tl('emails.reminder.eyebrow'),
    title: reminder.title,
    preheader: intro,
    paragraphs: [intro, ...(reminder.body ? [reminder.body] : [])],
    callout: { title: tl('emails.reminder.calloutTitle'), text: `${israelTime} (${tl('emails.reminder.israelTime')})` },
    cta: { label: tl('emails.cta.openApp'), url: appUrl },
    footer: tl('emails.reminder.footer'),
  }, locale);
}

export interface ScheduledReminderRunResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Claimed at delivery time but no longer authorized (the recipient stopped being self or
   *  the current accepted partner since creation/last edit) — auto-cancelled, never sent. */
  autoCancelled: number;
  failures: { id: number; error: string }[];
}

/**
 * Claims and delivers every currently-due scheduled reminder (including recovering any
 * abandoned by a crashed worker past the stale-lease threshold). Every claimed reminder's
 * entire processing — recipient re-authorization, recipient/creator lookup, building the
 * email, and sending it — is wrapped so that ANY failure at any stage for one row (a bug, a
 * transient DB hiccup, a lookup miss) is caught and recorded without aborting the rest of the
 * run; every other due reminder is still attempted.
 *
 * Never marks a reminder 'sent' unless sendEmail resolved without throwing; an ordinary
 * failure (before the provider ever accepted the email) is recorded with either a
 * bounded-backoff retry (next_attempt_at advanced) or, past MAX_ATTEMPTS, a terminal 'failed'
 * state (next_attempt_at cleared — no further automatic retries; the creator can still
 * explicitly edit/resave it via the API to requeue).
 *
 * Honest delivery semantics — this is **at-least-once**, not exactly-once: overlapping worker
 * claims can never both send the same reminder (see claimReminder's atomic compare-and-swap),
 * but if the process crashes *after* the email provider has already accepted/sent the message
 * and *before* this function manages to persist the 'sent' status, the row is left claimed;
 * once its lease goes stale it becomes claimable again and a future run may resend the same
 * email. This is an accepted, documented limitation, not a false "exactly-once" promise.
 */
export async function runDueScheduledReminders(
  db: Database.Database,
  now: Date = new Date()
): Promise<ScheduledReminderRunResult> {
  const { appUrl } = getEmailConfig();
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();

  const result: ScheduledReminderRunResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    autoCancelled: 0,
    failures: [],
  };

  for (const id of findDueReminderIds(db, nowIso, staleBeforeIso)) {
    const claimed = claimReminder(db, id, nowIso, staleBeforeIso);
    if (!claimed) {
      // Another worker (or this same query's now-stale snapshot) already handled it.
      result.skipped += 1;
      continue;
    }

    // Tracks whether the email provider had already accepted the message before anything
    // below threw — determines whether a caught error here is an ordinary (safe-to-retry)
    // failure or the much more delicate "sent but couldn't persist that" case (see below).
    let emailAcceptedByProvider = false;

    try {
      // Re-validated at delivery time, not just at create/edit time: a partnership can be
      // removed at any point between scheduling and the due moment, and this must never
      // silently email someone who is no longer authorized to receive it.
      const stillAllowed = resolveAllowedRecipient(db, claimed.creator_user_id, claimed.recipient_user_id);
      if (!stillAllowed) {
        markAutoCancelled(
          db,
          claimed.id,
          nowIso,
          'recipient is no longer self or current partner — auto-cancelled'
        );
        result.autoCancelled += 1;
        continue;
      }

      const recipient = db.prepare('SELECT id, email, locale FROM users WHERE id = ?').get(claimed.recipient_user_id) as
        | { id: number; email: string; locale: string | null }
        | undefined;
      const creator = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(claimed.creator_user_id) as
        | { id: number; email: string; display_name: string }
        | undefined;

      // Both rows are FK-referenced with ON DELETE CASCADE, so if either user were deleted
      // this reminder row would already be gone too — this is only a defensive guard.
      if (!recipient || !creator) {
        markFailed(db, claimed.id, nowIso, 'recipient or creator not found', null);
        result.failed += 1;
        result.failures.push({ id: claimed.id, error: 'recipient/creator missing' });
        continue;
      }

      const recipientIsCreator = claimed.recipient_user_id === claimed.creator_user_id;
      const scheduledByLabel = creator.display_name?.trim() || creator.email;
      const recipientLocale: Locale = recipient.locale === 'he' ? 'he' : 'en';
      const { subject, html, plainText, attachments } = buildReminderEmail(appUrl, claimed, recipientIsCreator, scheduledByLabel, recipientLocale);

      result.attempted += 1;
      await sendEmail({ to: recipient.email, subject, html, plainText, attachments });
      emailAcceptedByProvider = true;
      markSent(db, claimed.id, nowIso);
      result.sent += 1;
    } catch (err) {
      const message = sanitizeError(err);
      if (emailAcceptedByProvider) {
        // The provider already accepted/sent this message — only *persisting* that fact
        // failed (e.g. a DB write error right after the network call). This is the one
        // genuinely dangerous case: the row is left claimed ('sending'), so once its lease
        // goes stale a future run may resend the same email (see the at-least-once note
        // above). Log this as loudly/distinctly as possible so it's never missed.
        // eslint-disable-next-line no-console
        console.error(
          `[scheduled-reminders] CRITICAL: reminder ${claimed.id} was accepted by the email ` +
            `provider but persisting its "sent" status failed — it may be re-sent on a ` +
            `future retry once its claim lease goes stale: ${message}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.error(`[scheduled-reminders] send failed for reminder ${claimed.id}: ${message}`);
      }
      try {
        const nextAttemptAt =
          claimed.attempt_count >= MAX_ATTEMPTS
            ? null
            : new Date(now.getTime() + backoffMinutesForAttempt(claimed.attempt_count) * 60_000).toISOString();
        markFailed(db, claimed.id, nowIso, message, nextAttemptAt);
      } catch (persistErr) {
        // Recording the failure itself failed too (e.g. DB unavailable) — nothing more we can
        // safely do for this row right now; log and move on. Its claim lease will still go
        // stale in time, making it claimable again on a future run regardless.
        // eslint-disable-next-line no-console
        console.error(
          `[scheduled-reminders] additionally failed to persist failure state for reminder ${claimed.id}: ${sanitizeError(persistErr)}`
        );
      }
      result.failed += 1;
      result.failures.push({ id: claimed.id, error: message });
    }
  }

  return result;
}
