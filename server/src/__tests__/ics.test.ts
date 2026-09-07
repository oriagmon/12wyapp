import { describe, it, expect } from 'vitest';
import {
  buildStableWamCalendarUid,
  buildWamIcs,
  domainFromEmail,
  escapeIcsText,
  foldIcsLine,
  formatIcsDateUTC,
} from '../lib/ics.js';

describe('formatIcsDateUTC', () => {
  it('formats a Date as RFC 5545 UTC form (YYYYMMDDTHHMMSSZ), independent of local timezone', () => {
    expect(formatIcsDateUTC(new Date('2026-03-15T14:30:00.000Z'))).toBe('20260315T143000Z');
    expect(formatIcsDateUTC(new Date('2026-01-01T00:00:00.000Z'))).toBe('20260101T000000Z');
  });

  it('drops sub-second precision', () => {
    expect(formatIcsDateUTC(new Date('2026-03-15T14:30:00.999Z'))).toBe('20260315T143000Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes backslashes, semicolons and commas', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  });

  it('turns newlines into a literal \\n', () => {
    expect(escapeIcsText('line1\nline2\r\nline3')).toBe('line1\\nline2\\nline3');
  });

  it('leaves Hebrew text untouched aside from the escaped characters', () => {
    expect(escapeIcsText('פגישת WAM, שבוע 5')).toBe('פגישת WAM\\, שבוע 5');
  });
});

describe('foldIcsLine', () => {
  it('leaves short lines (<=75 octets) untouched', () => {
    const line = 'SUMMARY:פגישת WAM';
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds long lines to at most 75 octets per physical line, continuing with CRLF+space', () => {
    const longText = 'x'.repeat(200);
    const folded = foldIcsLine(`DESCRIPTION:${longText}`);
    const physicalLines = folded.split('\r\n');
    expect(physicalLines.length).toBeGreaterThan(1);
    for (const [i, physicalLine] of physicalLines.entries()) {
      expect(Buffer.byteLength(physicalLine, 'utf8')).toBeLessThanOrEqual(75);
      if (i > 0) expect(physicalLine.startsWith(' ')).toBe(true);
    }
    // Rejoining (stripping the CRLF+space folding) recovers the original content.
    const unfolded = physicalLines.map((l, i) => (i > 0 ? l.slice(1) : l)).join('');
    expect(unfolded).toBe(`DESCRIPTION:${longText}`);
  });

  it('never splits inside a multi-byte UTF-8 character even with long Hebrew text', () => {
    const longHebrew = 'שלום עולם זו בדיקה ארוכה מאוד '.repeat(10);
    const folded = foldIcsLine(`DESCRIPTION:${longHebrew}`);
    for (const buf of folded.split('\r\n').map((l) => Buffer.from(l.startsWith(' ') ? l.slice(1) : l, 'utf8'))) {
      // A valid re-encoding round trip (Buffer.from(str).toString()) never inserts U+FFFD
      // replacement characters, which is what a mid-character split would produce.
      expect(buf.toString('utf8')).not.toContain('\uFFFD');
    }
  });
});

describe('buildStableWamCalendarUid / domainFromEmail', () => {
  it('is deterministic for the same wam id and domain', () => {
    expect(buildStableWamCalendarUid(42, 'example.com')).toBe(buildStableWamCalendarUid(42, 'example.com'));
  });

  it('differs across wam ids', () => {
    expect(buildStableWamCalendarUid(1, 'example.com')).not.toBe(buildStableWamCalendarUid(2, 'example.com'));
  });

  it('extracts the domain part of an email address', () => {
    expect(domainFromEmail('DoNotReply@example.azurecomm.net')).toBe('example.azurecomm.net');
  });
});

describe('buildWamIcs', () => {
  const baseInput = {
    uid: 'wam-7@example.com',
    sequence: 0,
    dtStamp: new Date('2026-01-01T08:00:00.000Z'),
    dtStart: new Date('2026-01-10T10:00:00.000Z'),
    dtEnd: new Date('2026-01-10T11:00:00.000Z'),
    organizerEmail: 'DoNotReply@example.com',
    attendeeEmails: ['a@a.com', 'b@a.com'],
    summary: 'פגישת WAM — שבוע 5',
    description: 'תיאור בעברית',
    url: 'https://dashboard.example.com',
  };

  it('produces a full VCALENDAR with METHOD:REQUEST, CRLF line endings, and both attendees', () => {
    const ics = buildWamIcs(baseInput);
    // Unfold continuation lines (CRLF + single space) to make long-line assertions robust to
    // RFC 5545 §3.1 folding, which the 76-byte ATTENDEE lines below are subject to.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('UID:wam-7@example.com\r\n');
    expect(ics).toContain('DTSTAMP:20260101T080000Z\r\n');
    expect(ics).toContain('DTSTART:20260110T100000Z\r\n');
    expect(ics).toContain('DTEND:20260110T110000Z\r\n');
    expect(ics).toContain('SEQUENCE:0\r\n');
    expect(ics).toContain('ORGANIZER:mailto:DoNotReply@example.com\r\n');
    expect(unfolded).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:a@a.com');
    expect(unfolded).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:b@a.com');
    expect(ics).toContain('URL:https://dashboard.example.com\r\n');
    expect(ics).toContain('END:VEVENT\r\n');
    expect(ics).toContain('END:VCALENDAR\r\n');
    // No bare LF without a preceding CR anywhere in the document.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('reflects a higher SEQUENCE when passed one', () => {
    const ics = buildWamIcs({ ...baseInput, sequence: 3 });
    expect(ics).toContain('SEQUENCE:3\r\n');
  });

  it('escapes the Hebrew SUMMARY/DESCRIPTION text', () => {
    const ics = buildWamIcs({ ...baseInput, summary: 'שבוע, 5', description: 'שורה1\nשורה2' });
    expect(ics).toContain('SUMMARY:שבוע\\, 5\r\n');
    expect(ics).toContain('DESCRIPTION:שורה1\\nשורה2\r\n');
  });
});
