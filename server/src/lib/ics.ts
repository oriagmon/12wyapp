/**
 * Pure RFC 5545 ("iCalendar") building blocks for WAM calendar invitations. No DB/network
 * access here — everything is a deterministic function of its inputs, kept unit-testable in
 * isolation from ACS email sending (see server/src/lib/wamCalendarInvites.ts).
 */

const ICS_LINE_MAX_OCTETS = 75;

/** `YYYYMMDDTHHMMSSZ` — always UTC, per RFC 5545 form #2, regardless of the input Date's
 *  origin timezone (the UI labels the picked time as Israel time, but everything sent over
 *  the wire — DTSTAMP/DTSTART/DTEND — must be UTC so every calendar client renders it the
 *  same, correctly, in the viewer's own local zone). */
export function formatIcsDateUTC(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** Escapes TEXT-valued properties (SUMMARY/DESCRIPTION) per RFC 5545 §3.3.11: backslash,
 *  semicolon and comma are backslash-escaped, and any newline becomes a literal `\n`. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a single content line to at most 75 octets per RFC 5545 §3.1, continuing on
 *  subsequent lines that start with a single space. Splits are done on UTF-8 byte boundaries
 *  (never inside a multi-byte character) since Hebrew text is multi-byte in UTF-8. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.byteLength <= ICS_LINE_MAX_OCTETS) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = ICS_LINE_MAX_OCTETS;
  while (start < bytes.byteLength) {
    let end = Math.min(start + limit, bytes.byteLength);
    // Never split in the middle of a multi-byte UTF-8 sequence (continuation bytes are
    // 10xxxxxx, i.e. 0x80-0xBF).
    while (end > start && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    // Continuation lines are prefixed with one space, which itself counts toward the 75.
    limit = ICS_LINE_MAX_OCTETS - 1;
  }
  return chunks.join('\r\n ');
}

/** A stable, deterministic UID for a WAM's recurring "next meeting" calendar event. Generated
 *  once per WAM (the first time it is ever scheduled) and persisted on wams.calendar_event_uid
 *  — never regenerated afterwards, so every future invite update for the same WAM is
 *  recognized by calendar clients as an update to the same event, not a new one. */
export function buildStableWamCalendarUid(wamId: number, domain: string): string {
  return `wam-${wamId}@${domain}`;
}

/** Extracts the domain part of an email address, falling back to a fixed placeholder for a
 *  malformed address (should not happen for a verified ACS sender address). */
export function domainFromEmail(email: string): string {
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1) : 'localhost';
}

export interface IcsEventInput {
  uid: string;
  sequence: number;
  dtStamp: Date;
  dtStart: Date;
  dtEnd: Date;
  organizerEmail: string;
  attendeeEmails: string[];
  summary: string;
  description: string;
  url: string;
  /** Language of `summary`/`description`, reported in PRODID. */
  locale?: string;
}

/**
 * Builds a full RFC 5545 VCALENDAR document with METHOD:REQUEST for a single WAM meeting
 * invitation, addressed to both partnership members regardless of which one a given email is
 * actually delivered to (so every recipient's calendar client sees the complete attendee
 * list). Uses CRLF line endings throughout, as required by RFC 5545 §3.1.
 */
export function buildWamIcs(input: IcsEventInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//12-Week Dashboard//WAM Calendar Invitations//${(input.locale ?? 'en').toUpperCase()}`,
    'METHOD:REQUEST',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${formatIcsDateUTC(input.dtStamp)}`,
    `DTSTART:${formatIcsDateUTC(input.dtStart)}`,
    `DTEND:${formatIcsDateUTC(input.dtEnd)}`,
    `SEQUENCE:${input.sequence}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    `URL:${input.url}`,
    `ORGANIZER:mailto:${input.organizerEmail}`,
    ...input.attendeeEmails.map(
      (email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`
    ),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
