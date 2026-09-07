import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { sendEmail } from './emailSender.js';
import { buildWamIcs } from './ics.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';

export interface CalendarInviteRecipient {
  userId: number;
  email: string;
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

function formatIsraelTime(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function buildInviteEmail(
  summary: string,
  dtStart: Date,
  durationMinutes: number,
  appUrl: string
): BrandedEmail {
  const when = `${formatIsraelTime(dtStart)} (שעון ישראל)`;
  return renderBrandedEmail({
    subject: `הזמנה: ${summary}`,
    eyebrow: 'הזמנה ליומן',
    title: summary,
    preheader: `הפגישה הבאה נקבעה: ${when}`,
    paragraphs: [
      'נקבע מועד לפגישת ה-WAM הבאה שלכם — זמן משותף לסקירת הביצוע ולהתקדמות לשבוע הבא.',
      'מצורפת הזמנת יומן (ICS). אפשר לפתוח את הקובץ המצורף ולהוסיף את הפגישה ליומן.',
    ],
    callout: { title: 'פרטי הפגישה', text: `${when} · משך הפגישה: ${durationMinutes} דקות` },
    cta: { label: 'פתיחת 12WY', url: appUrl },
    footer: 'זוהי הזמנת יומן אוטומטית שנשלחה על ידי 12WY.\nמועד הפגישה מוצג לפי שעון ישראל.',
  });
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

  const summary = 'פגישת ה-WAM הבאה';
  const description = `תיאום הפגישה השבועית הבאה של פגישות ה-WAM (Weekly Accountability Meeting) שלכם. למעבר לאפליקציה: ${appUrl}`;

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
  });
  const attachment = {
    name: 'wam-invite.ics',
    contentType: 'text/calendar; method=REQUEST; charset=UTF-8',
    contentInBase64: Buffer.from(ics, 'utf8').toString('base64'),
  };
  const { subject, html, plainText, attachments } = buildInviteEmail(summary, dtStart, wam.nextWamDurationMinutes, appUrl);

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
      await sendEmail({ to: recipient.email, subject, html, plainText, attachments: [attachment, ...attachments] });
      recordDelivery(db, wam.id, recipient.userId, wam.calendarEventSequence, 'sent', null);
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'שגיאה לא ידועה בשליחת הזמנת יומן';
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
