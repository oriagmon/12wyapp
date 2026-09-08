import { describe, expect, it, vi } from 'vitest';
import { brandedEmailHeader, renderBrandedEmail, type BrandedEmailContent } from '../lib/emailBranding.js';
import { buildReminderEmail as buildWeeklyEmail } from '../lib/wamReminders.js';
import { buildReminderEmail as buildScheduledEmail, type ScheduledEmailReminderRow } from '../lib/scheduledReminders.js';
import { buildInviteEmail } from '../lib/wamCalendarInvites.js';
import { buildResetPasswordEmail } from '../lib/passwordReset.js';
import { buildBroostEmail } from '../lib/broosts.js';
import { escapeHtml } from '../lib/htmlEscape.js';

vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn() }));

const URL = 'https://dashboard.example.test/?view=home&source=email';
const REMINDER: ScheduledEmailReminderRow = {
  id: 1, creator_user_id: 1, recipient_user_id: 2,
  title: 'תזכורת בדיקה', body: 'פעולה אחת\nועוד צעד קטן',
  scheduled_for: '2026-09-05T12:00:00Z', status: 'pending', attempt_count: 0,
  last_error: null, next_attempt_at: null, claimed_at: null, sent_at: null,
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
};
const BUILDERS = [
  ['weekly', (url: string) => buildWeeklyEmail(url, null, 'he')],
  ['monthly', (url: string) => buildWeeklyEmail(url, { targetWeek: 4, monthNumber: 1 }, 'he')],
  ['calendar', (url: string) => buildInviteEmail(new Date('2026-09-05T12:00:00Z'), 60, url, 'he')],
  ['scheduled', (url: string) => buildScheduledEmail(url, REMINDER, false, 'שותף/ה לבדיקה', 'he')],
  ['reset', (url: string) => buildResetPasswordEmail(`${url}#resetToken=test-only-token`, 'he')],
  ['broost', (url: string) => buildBroostEmail(url, 'כל הכבוד על ההתמדה!', 'שותף/ה לבדיקה', 'he')],
] as const;

describe('consistent branded email rendering', () => {
  it.each(BUILDERS)('%s has the same inline JPEG, responsive RTL shell, CTA and plain-text equivalent', (_name, build) => {
    const email = build(URL);
    expect(email.html).toContain('<html lang="he" dir="rtl">');
    expect(email.html).toContain('name="viewport"');
    expect(email.html).toContain('max-width:620px');
    expect(email.html).toContain('max-width:480px');
    expect(email.html).toContain('<!--[if mso]>');
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain('cid:12wy-weekly-header');
    expect(email.html).toContain('alt="12WY');
    expect(email.html).toContain('אם הכפתור אינו נפתח');
    expect(email.html).not.toMatch(/<img[^>]+src="https?:/);
    expect(email.html).not.toContain('<script');
    expect(email.html).toContain(escapeHtml(URL));
    expect(email.plainText).toContain(URL);
    expect(email.plainText).toContain('12WY');
    expect(email.plainText).not.toContain('&amp;');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({ contentType: 'image/jpeg', contentId: '12wy-weekly-header' });
    expect(Buffer.from(email.attachments[0].contentInBase64, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it.each(BUILDERS)('%s escapes configured URL attributes without changing the plain-text URL', (_name, build) => {
    const url = `https://dashboard.example.test/?x="><img src=x onerror='alert(1)'>&q=1`;
    const email = build(url);
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('href="https://dashboard.example.test/?x=&quot;&gt;&lt;img');
    expect(email.html).toContain('onerror=&#39;alert(1)&#39;&gt;&amp;q=1');
    expect(email.plainText).toContain(url);
  });

  it('escapes every dynamic field once while deriving text from identical content', () => {
    const payload = `"<tag>&'`;
    const content: BrandedEmailContent = {
      subject: payload, eyebrow: payload, title: payload, preheader: payload,
      paragraphs: [payload], callout: { title: payload, text: payload },
      cta: { url: URL, label: payload }, footer: payload,
    };
    const email = renderBrandedEmail(content);
    expect(email.html).not.toContain(payload);
    expect(email.html).toContain('&quot;&lt;tag&gt;&amp;&#39;');
    expect(email.html).not.toContain('&amp;quot;');
    expect(email.plainText).toContain(payload);
    expect(email.subject).toBe(payload);
  });

  it('keeps scheduled user names, titles, multiline bodies and BROOST text as text, never markup', () => {
    const payload = '<script>alert(1)</script>';
    const scheduled = buildScheduledEmail(URL, { ...REMINDER, title: payload, body: `${payload}\nsecond line` }, false, payload);
    const broost = buildBroostEmail(URL, payload, payload);
    for (const email of [scheduled, broost]) {
      expect(email.html).not.toContain(payload);
      expect(email.html).toContain(escapeHtml(payload));
      expect(email.plainText).toContain(payload);
    }
    expect(scheduled.html).toContain('white-space:pre-wrap');
    expect(scheduled.html).toContain(`${escapeHtml(payload)}\nsecond line`);
  });

  it('keeps exact meeting timing and ICS instructions in both calendar alternatives', () => {
    const email = buildInviteEmail(new Date('2026-09-05T12:00:00Z'), 45, URL, 'he');
    for (const text of [email.html, email.plainText]) {
      expect(text).toContain('15:00');
      expect(text).toContain('45 דקות');
      expect(text).toContain('שעון ישראל');
      expect(text).toContain('ICS');
    }
  });

  it('retains reset expiry, single use and unsolicited-request guidance in both alternatives', () => {
    const email = buildResetPasswordEmail(`${URL}#resetToken=test-only-token`, 'he');
    for (const text of [email.html, email.plainText]) {
      expect(text).toContain('45 דקות');
      expect(text).toContain('פעם אחת בלבד');
      expect(text).toContain('הסיסמה הנוכחית שלך תישאר ללא שינוי');
      expect(text).toContain('#resetToken=test-only-token');
    }
  });

  it.each([4, 8, 12] as const)('preserves monthly review week %i, without a prompt on ordinary weeks', (targetWeek) => {
    const monthNumber = (targetWeek / 4) as 1 | 2 | 3;
    const email = buildWeeklyEmail(URL, { targetWeek, monthNumber }, 'he');
    expect(email.subject).toContain(`שבוע ${targetWeek}`);
    for (const text of [email.html, email.plainText]) {
      expect(text).toContain(`שבוע ${targetWeek}`);
      expect(text).toContain(`חודש ${monthNumber}`);
    }
    expect(buildWeeklyEmail(URL, null, 'he').html).not.toContain('הסקירה החודשית');
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', '//example.test', '/relative', 'not a URL'])(
    'rejects unsafe or relative CTA %s without echoing it in the error', (url) => {
      expect(() => buildBroostEmail(url, 'בדיקה', 'שותף/ה')).toThrow('Email action URL must use absolute HTTP or HTTPS');
    }
  );

  it('retains the cached original header bytes and content ID', () => {
    expect(brandedEmailHeader().attachment).toBe(brandedEmailHeader().attachment);
    expect(brandedEmailHeader().contentId).toBe('12wy-weekly-header');
  });
});
