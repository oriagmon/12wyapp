import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { currentIsoWeek } from './isoWeek.js';
import { sendEmail } from './emailSender.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { fallbackLocale, t } from './i18n/index.js';
import type { Locale } from './i18n/core.js';

interface PartnershipPairRow {
  partnershipId: number;
  aId: number;
  aEmail: string;
  aLocale: string;
  aCurrentWeek: number | null;
  bId: number;
  bEmail: string;
  bLocale: string;
  bCurrentWeek: number | null;
}

export interface ReminderRecipient {
  userId: number;
  email: string;
  locale: string | null;
  partnershipId: number;
  /** The recipient's own active cycle's current week (1-12), or null if they have no
   *  active cycle right now — used only to decide whether to append the monthly review
   *  prompt below, and has no effect on whether the base weekly reminder is sent. */
  currentWeek: number | null;
}

/** Every user in an active direct partnership, once per user (both sides of every
 *  partnership row) — every partnership row is, by construction (see migration 004),
 *  an active mutual pairing. Users without a partnership are naturally excluded since
 *  they have no row here. */
export function getReminderRecipients(db: Database.Database): ReminderRecipient[] {
  const rows = db
    .prepare(
      `SELECT p.id as partnershipId,
              ua.id as aId, ua.email as aEmail, ua.locale as aLocale, ca.current_week as aCurrentWeek,
              ub.id as bId, ub.email as bEmail, ub.locale as bLocale, cb.current_week as bCurrentWeek
       FROM partnerships p
       JOIN users ua ON ua.id = p.initiator_id
       JOIN users ub ON ub.id = p.invitee_id
       LEFT JOIN cycles ca ON ca.user_id = ua.id AND ca.is_active = 1
       LEFT JOIN cycles cb ON cb.user_id = ub.id AND cb.is_active = 1`
    )
    .all() as PartnershipPairRow[];

  const recipients: ReminderRecipient[] = [];
  for (const row of rows) {
    recipients.push({ userId: row.aId, email: row.aEmail, locale: row.aLocale, partnershipId: row.partnershipId, currentWeek: row.aCurrentWeek });
    recipients.push({ userId: row.bId, email: row.bEmail, locale: row.bLocale, partnershipId: row.partnershipId, currentWeek: row.bCurrentWeek });
  }
  return recipients;
}

interface ReminderStatusRow {
  status: 'sent' | 'failed';
}

function getExistingStatus(
  db: Database.Database,
  isoWeek: string,
  userId: number
): ReminderStatusRow['status'] | undefined {
  const row = db
    .prepare('SELECT status FROM wam_email_reminders WHERE iso_week = ? AND recipient_user_id = ?')
    .get(isoWeek, userId) as ReminderStatusRow | undefined;
  return row?.status;
}

/** Upserts the outcome for (isoWeek, userId) — the UNIQUE(iso_week, recipient_user_id)
 *  index from migration 007 is what makes this idempotent across retried invocations. */
function recordResult(
  db: Database.Database,
  isoWeek: string,
  partnershipId: number,
  userId: number,
  status: 'sent' | 'failed',
  error: string | null
): void {
  db.prepare(
    `INSERT INTO wam_email_reminders (iso_week, partnership_id, recipient_user_id, status, error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (iso_week, recipient_user_id)
     DO UPDATE SET
       status = excluded.status,
       error = excluded.error,
       partnership_id = excluded.partnership_id,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(isoWeek, partnershipId, userId, status, error);
}

export interface MonthlyReviewPrompt {
  /** The upcoming cycle week (4, 8, or 12) that is a monthly review week. */
  targetWeek: 4 | 8 | 12;
  /** Which "month" of the 12-week cycle that review closes out (1, 2, or 3). */
  monthNumber: 1 | 2 | 3;
}

/** Weeks 4, 8, and 12 of a 12-week cycle are treated as monthly review WAMs. This maps
 *  "one week before" each of those (weeks 3, 7, 11) to the upcoming review week/month, so
 *  the Tuesday reminder sent during that week can prompt scheduling it a week ahead of
 *  time. Any other current week (including no active cycle at all) yields no prompt. */
const MONTHLY_REVIEW_LOOKAHEAD: Record<number, MonthlyReviewPrompt> = {
  3: { targetWeek: 4, monthNumber: 1 },
  7: { targetWeek: 8, monthNumber: 2 },
  11: { targetWeek: 12, monthNumber: 3 },
};

export function monthlyReviewPromptForWeek(currentWeek: number | null): MonthlyReviewPrompt | null {
  if (currentWeek == null) return null;
  return MONTHLY_REVIEW_LOOKAHEAD[currentWeek] ?? null;
}

export function buildReminderEmail(
  appUrl: string,
  monthlyReview: MonthlyReviewPrompt | null,
  locale: Locale = fallbackLocale()
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const subject = monthlyReview
    ? tl('emails.wamReminder.subjectMonthly', { week: monthlyReview.targetWeek })
    : tl('emails.wamReminder.subject');
  return renderBrandedEmail({
    subject,
    eyebrow: tl('emails.wamReminder.eyebrow'),
    title: tl('emails.wamReminder.title'),
    paragraphs: [
      tl('emails.wamReminder.body1'),
      tl('emails.wamReminder.body2'),
    ],
    callout: monthlyReview ? {
      title: tl('emails.wamReminder.monthlyCalloutTitle'),
      text: tl('emails.wamReminder.monthlyCalloutText', { week: monthlyReview.targetWeek, month: monthlyReview.monthNumber }),
    } : undefined,
    cta: { label: tl('emails.cta.openApp'), url: appUrl },
    footer: tl('emails.wamReminder.footer'),
  }, locale);
}

export interface ReminderRunResult {
  isoWeek: string;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: { userId: number; error: string }[];
}

/**
 * Sends the weekly "did you schedule your WAM?" reminder to both members of every active
 * direct partnership, skipping users without one. Idempotent per (ISO week, recipient): a
 * recipient already recorded 'sent' for the current week is skipped, while a recipient
 * without a row yet or previously recorded 'failed' is (re)attempted. Every recipient is
 * attempted independently — one failure never stops the run — and each outcome is recorded
 * before moving on, so a crashed/killed process still leaves accurate state for the next
 * invocation to resume from.
 */
export async function sendWeeklyWamReminders(
  db: Database.Database,
  now: Date = new Date()
): Promise<ReminderRunResult> {
  const { appUrl } = getEmailConfig();
  const isoWeek = currentIsoWeek(now);

  const result: ReminderRunResult = { isoWeek, attempted: 0, sent: 0, skipped: 0, failed: 0, failures: [] };

  for (const recipient of getReminderRecipients(db)) {
    if (getExistingStatus(db, isoWeek, recipient.userId) === 'sent') {
      result.skipped += 1;
      continue;
    }

    // Built per-recipient (not hoisted outside the loop) since the monthly review prompt
    // depends on each recipient's own current cycle week — one combined email either way,
    // never a separate second email.
    const monthlyReview = monthlyReviewPromptForWeek(recipient.currentWeek);
    const recipientLocale: Locale = recipient.locale === 'he' ? 'he' : 'en';
    const { subject, html, plainText, attachments } = buildReminderEmail(appUrl, monthlyReview, recipientLocale);

    result.attempted += 1;
    try {
      await sendEmail({ to: recipient.email, subject, html, plainText, attachments });
      recordResult(db, isoWeek, recipient.partnershipId, recipient.userId, 'sent', null);
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      recordResult(db, isoWeek, recipient.partnershipId, recipient.userId, 'failed', message);
      result.failed += 1;
      result.failures.push({ userId: recipient.userId, error: message });
      // Log the numeric user id only (never the email address) to keep PII out of logs.
      // eslint-disable-next-line no-console
      console.error(`[wam-reminders] send failed for user ${recipient.userId}: ${message}`);
    }
  }

  return result;
}
