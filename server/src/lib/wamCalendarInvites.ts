import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { sendEmail } from './emailSender.js';
import { buildWamIcs } from './ics.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { t, fallbackLocale } from './i18n/index.js';
import type { Locale } from './i18n/core.js';

export interface CalendarInviteRecipient {
  userId: number;
  email: string;
  locale?: Locale;
}

export interface CalendarInviteWam {
  id: number;
  nextWamAt: string;
  nextWamDurationMinutes: number;
  calendarEventUid: string;
  calendarEventSequence: number;
}

interface DeliveryRow {
  status: 'sent' | 'failed';
  event_sequence: number;
}

function getExistingDelivery(db: Database.Database, wamId: number, userId: number): DeliveryRow | undefined {
  return db
    .prepare('SELECT status, event_sequence FROM wam_calendar_invitations WHERE wam_id = ? AND recipient_user_id = ?')
    .get(wamId, userId) as DeliveryRow | undefined;
}

/** Upserts the delivery outcome for (wamId, userId) — see migration 008 for why the primary
 *  key deliberately does not include event_sequence: a later attempt for a new sequence
 *  simply overwrites the previous generation's row. */
function recordDelivery(
  db: Database.Database,
  wamId: number,
  userId: number,
  eventSequence: number,
  status: 'sent' | 'failed',
  error: string | null
): void {
  db.prepare(
    `INSERT INTO wam_calendar_invitations (wam_id, recipient_user_id, event_sequence, status, error, sent_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (wam_id, recipient_user_id)
     DO UPDATE SET
       event_sequence = excluded.event_sequence,
       status = excluded.status,
       error = excluded.error,
       sent_at = excluded.sent_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(wamId, userId, eventSequence, status, error, status === 'sent' ? new Date().toISOString() : null);
}

function formatIsraelTime(date: Date, locale: Locale = 'en'): string {
  const tz = locale === 'he' ? 'he-IL' : 'en-US';
  return new Intl.DateTimeFormat(tz, {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function buildInviteEmail(
  dtStart: Date,
  durationMinutes: number,
  appUrl: string,
  locale: Locale = 'en'
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const when = `${formatIsraelTime(dtStart, locale)} (${tl('emails.calendar.israelTime')})`;
  // The title is resolved here rather than passed in: the ICS attachment can only carry one
  // language for both attendees, but each email must be entirely in its own recipient's.
  const summary = tl('emails.calendar.wamTitle');
  return renderBrandedEmail({
    subject: `${tl('emails.calendar.subjectPrefix')}: ${summary}`,
    eyebrow: tl('emails.calendar.eyebrow'),
    title: summary,
    preheader: tl('emails.calendar.preheader', { when }),
    paragraphs: [
      tl('emails.calendar.body1'),
      tl('emails.calendar.body2'),
    ],
    callout: {
      title: tl('emails.calendar.calloutTitle'),
      text: `${when} · ${tl('emails.calendar.duration', { minutes: durationMinutes })}`,
    },
    cta: { label: tl('emails.cta.openApp'), url: appUrl },
    footer: tl('emails.calendar.footer'),
  }, locale);
}

export interface CalendarInviteRunResult {
  /** False if any recipient's invitation failed to send (skips/successes don't affect this). */
  allSucceeded: boolean;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: { userId: number; error: string }[];
}

/**
 * Sends the "next WAM" calendar invitation to every given recipient, idempotently per
 * (wam, recipient, event sequence): a recipient already recorded 'sent' for the WAM's
 * *current* calendar_event_sequence is skipped, while one recorded 'failed' (or never
 * attempted) is (re)sent. Every recipient is attempted independently — one failure never
 * stops the other — and each outcome is persisted immediately, so a crashed process or a
 * retried request always resumes from accurate state. Never throws: failures are recorded
 * and surfaced only via the returned result's `allSucceeded`/`failures`, exactly mirroring
 * the weekly reminder pattern in wamReminders.ts.
 */
export async function sendWamCalendarInvitations(
  db: Database.Database,
  wam: CalendarInviteWam,
  recipients: CalendarInviteRecipient[]
): Promise<CalendarInviteRunResult> {
  const { senderAddress, appUrl } = getEmailConfig();
  const dtStart = new Date(wam.nextWamAt);
  const dtEnd = new Date(dtStart.getTime() + wam.nextWamDurationMinutes * 60_000);
  const dtStamp = new Date();

  // The ICS is one shared document attached to both invitations, so it can carry only one
  // language. Use the recipients' language when they agree and the deployment default when
  // they don't; the email wrapped around it is always in that recipient's own language.
  const recipientLocales = new Set(recipients.map((r) => r.locale ?? fallbackLocale()));
  const icsLocale: Locale = recipientLocales.size === 1 ? [...recipientLocales][0]! : fallbackLocale();
  const summary = t(icsLocale, 'emails.calendar.wamTitle');
  const description = `${t(icsLocale, 'emails.calendar.icsDescription')} ${appUrl}`;

  const ics = buildWamIcs({
    uid: wam.calendarEventUid,
    sequence: wam.calendarEventSequence,
    dtStamp,
    dtStart,
    dtEnd,
    organizerEmail: senderAddress,
    attendeeEmails: recipients.map((r) => r.email),
    summary,
    description,
    url: appUrl,
    locale: icsLocale,
  });
  const attachment = {
    name: 'wam-invite.ics',
    contentType: 'text/calendar; method=REQUEST; charset=UTF-8',
    contentInBase64: Buffer.from(ics, 'utf8').toString('base64'),
  };


  const result: CalendarInviteRunResult = {
    allSucceeded: true,
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const recipient of recipients) {
    const existing = getExistingDelivery(db, wam.id, recipient.userId);
    if (existing && existing.status === 'sent' && existing.event_sequence === wam.calendarEventSequence) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    try {
      const recipientLocale: Locale = recipient.locale ?? fallbackLocale();
      const { subject, html, plainText, attachments: emailAttachments } = buildInviteEmail(dtStart, wam.nextWamDurationMinutes, appUrl, recipientLocale);
      await sendEmail({ to: recipient.email, subject, html, plainText, attachments: [attachment, ...emailAttachments] });
      recordDelivery(db, wam.id, recipient.userId, wam.calendarEventSequence, 'sent', null);
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown calendar invite send error';
      recordDelivery(db, wam.id, recipient.userId, wam.calendarEventSequence, 'failed', message);
      result.failed += 1;
      result.failures.push({ userId: recipient.userId, error: message });
      result.allSucceeded = false;
      // Log the numeric user id only (never the email address) to keep PII out of logs.
      // eslint-disable-next-line no-console
      console.error(`[wam-calendar-invite] send failed for user ${recipient.userId}: ${message}`);
    }
  }

  return result;
}
