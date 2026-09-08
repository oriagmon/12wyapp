import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { t, type Locale } from '../lib/i18n/index.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the
// scheduling/idempotency/sequence/status business logic in routes/wams.ts and
// lib/wamCalendarInvites.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';

const sendEmailMock = vi.mocked(sendEmail);

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(app: ReturnType<typeof freshApp>, a: { cookie: string; userId: number }, b: { cookie: string; userId: number }) {
  await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
}

function futureIso(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

describe('WAM calendar invitations', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  it('rejects a concurrent completion before it can send competing invitations', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    sendEmailMock.mockImplementationOnce(async () => { enter(); await gate; });
    const first = request(app).post(`/api/wams/${created.body.id}/complete`)
      .set('Cookie', a.cookie).send({ nextWamAt: futureIso() }).then((response) => response);
    try {
      await entered;
      const concurrent = await request(app).post(`/api/wams/${created.body.id}/complete`)
        .set('Cookie', b.cookie).send({ nextWamAt: futureIso(48) });
      expect(concurrent.status).toBe(409);
      expect(concurrent.body.celebration).toBeUndefined();
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    const completed = await first;
    expect(completed.status).toBe(200);
    expect(completed.body.celebration.type).toBe('completion');
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM backup').get()).toEqual({ count: 1 });
  });

  it('does not freeze or celebrate a WAM whose cycle was archived during invitation delivery', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle' });
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    sendEmailMock.mockImplementationOnce(async () => {
      getDb().prepare('UPDATE cycles SET is_active = 0 WHERE user_id = ?').run(a.userId);
    });
    const result = await request(app).post(`/api/wams/${created.body.id}/complete`)
      .set('Cookie', a.cookie).send({ nextWamAt: futureIso() });
    expect(result.status).toBe(400);
    expect(result.body.celebration).toBeUndefined();
    expect(getDb().prepare('SELECT status FROM wams WHERE id = ?').get(created.body.id)).toEqual({ status: 'draft' });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM backup').get()).toEqual({ count: 0 });
  });

  it('completes without any schedule and sends no email when no next-WAM date is given', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.wam.status).toBe('complete');
    expect(completed.body.wam.nextWam.at).toBeNull();
    expect(completed.body.wam.calendarInvitations.a.status).toBeNull();
    expect(completed.body.wam.calendarInvitations.b.status).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects a past or invalid next-WAM timestamp', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const past = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(400);

    const invalid = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: 'not-a-date' });
    expect(invalid.status).toBe(400);

    const stillDraft = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(stillDraft.body.status).toBe('draft');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends two ICS calendar invitations (one per attendee) with a future schedule, then completes', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 4 });
    const wamId = created.body.id;
    const when = futureIso();

    const completed = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });

    expect(completed.status).toBe(200);
    expect(completed.body.wam.status).toBe('complete');
    expect(completed.body.wam.nextWam.at).toBe(when);
    expect(completed.body.wam.nextWam.durationMinutes).toBe(60);
    expect(completed.body.wam.calendarInvitations.a.status).toBe('sent');
    expect(completed.body.wam.calendarInvitations.b.status).toBe('sent');

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const recipients = sendEmailMock.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual(['a@a.com', 'b@a.com']);

    for (const call of sendEmailMock.mock.calls) {
      const [params] = call;
      // Each invite is written in its own recipient's language, so the assertions resolve
      // against that recipient's stored locale rather than a pinned Hebrew string.
      const locale = (
        getDb().prepare('SELECT locale FROM users WHERE email = ?').get(params.to) as { locale: Locale }
      ).locale;
      expect(params.attachments).toHaveLength(2);
      expect(params.html).toContain('cid:12wy-weekly-header');
      expect(params.html).toContain(`<html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}">`);
      expect(params.plainText).toContain(t(locale, 'emails.calendar.israelTime'));
      expect(params.plainText).toContain('https://dashboard.example.com');
      expect(params.attachments![1]).toMatchObject({
        contentType: 'image/jpeg',
        contentId: '12wy-weekly-header',
      });
      const attachment = params.attachments![0];
      expect(attachment.contentType).toContain('text/calendar');
      expect(attachment.contentType).toContain('method=REQUEST');
      expect(attachment.name).toMatch(/\.ics$/);
      const ics = Buffer.from(attachment.contentInBase64, 'base64').toString('utf8');
      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain(`SUMMARY:${t(locale, 'emails.calendar.wamTitle')}`);
      expect(ics).not.toContain('שבוע 4'); // week-agnostic — never names the just-completed WAM's week
      expect(ics).toContain('ORGANIZER:mailto:DoNotReply@example.azurecomm.net');
      expect(ics).toContain('SEQUENCE:0');
      const unfolded = ics.replace(/\r\n /g, '');
      expect(unfolded).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:a@a.com');
      expect(unfolded).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:b@a.com');
      expect(ics).toContain('URL:https://dashboard.example.com');
    }

    const uidA = sendEmailMock.mock.calls[0][0].attachments![0].contentInBase64;
    const uidB = sendEmailMock.mock.calls[1][0].attachments![0].contentInBase64;
    const extractUid = (b64: string) => Buffer.from(b64, 'base64').toString('utf8').match(/UID:([^\r\n]+)/)?.[1];
    expect(extractUid(uidA)).toBe(extractUid(uidB));
  });

  it('persists the serialized next-WAM schedule, and reopening preserves it', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso(48);

    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when, nextWamDurationMinutes: 45 });

    const reopened = await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('draft');
    expect(reopened.body.nextWam.at).toBe(when);
    expect(reopened.body.nextWam.durationMinutes).toBe(45);
    expect(reopened.body.calendarInvitations.a.status).toBe('sent');
    expect(reopened.body.calendarInvitations.b.status).toBe('sent');
  });

  it('keeps the WAM in draft and persists per-recipient failure status when one recipient send fails; retry sends only the failed recipient', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'b@a.com') throw new Error('ACS send failed: simulated outage');
    });

    const firstAttempt = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });

    expect(firstAttempt.status).toBe(502);
    expect(firstAttempt.body.wam.status).toBe('draft');
    expect(firstAttempt.body.wam.calendarInvitations.a.status).toBe('sent');
    expect(firstAttempt.body.wam.calendarInvitations.b.status).toBe('failed');
    expect(firstAttempt.body.wam.calendarInvitations.b.error).toContain('simulated outage');

    const stillDraft = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(stillDraft.body.status).toBe('draft');

    // Retry with the identical schedule: only the previously-failed recipient is re-sent.
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    const retry = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when });

    expect(retry.status).toBe(200);
    expect(retry.body.wam.status).toBe('complete');
    expect(retry.body.wam.calendarInvitations.a.status).toBe('sent');
    expect(retry.body.wam.calendarInvitations.b.status).toBe('sent');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe('b@a.com');
  });

  it('re-completing after reopen with the identical schedule does not resend to already-succeeded recipients', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    const first = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when });
    expect(first.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);

    sendEmailMock.mockClear();
    const second = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when });

    expect(second.status).toBe(200);
    expect(second.body.wam.calendarInvitations.a.status).toBe('sent');
    expect(second.body.wam.calendarInvitations.b.status).toBe('sent');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('bumps the calendar event sequence and re-sends both recipients when the schedule changes after reopen', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const firstWhen = futureIso(24);
    const secondWhen = futureIso(72);

    const first = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: firstWhen });
    expect(first.body.wam.nextWam.sequence).toBe(0);

    await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);
    sendEmailMock.mockClear();

    const second = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: secondWhen });

    expect(second.status).toBe(200);
    expect(second.body.wam.nextWam.sequence).toBe(1);
    expect(second.body.wam.nextWam.at).toBe(secondWhen);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    for (const call of sendEmailMock.mock.calls) {
      const ics = Buffer.from(call[0].attachments![0].contentInBase64, 'base64').toString('utf8');
      expect(ics).toContain('SEQUENCE:1');
    }
  });

  it('does not allow completing a historical WAM with a schedule, and requires the meeting not already complete', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const completed = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: futureIso() });
    expect(completed.status).toBe(200);

    const doubleComplete = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', b.cookie)
      .send({ nextWamAt: futureIso() });
    expect(doubleComplete.status).toBe(409);
  });

  it('rejects clearing an already-persisted schedule on re-completion after reopen (no cancellation support)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    const first = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when });
    expect(first.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);
    sendEmailMock.mockClear();

    const cleared = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(cleared.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();

    // The WAM stays draft, and the original schedule/invitation status are untouched.
    const stillDraft = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(stillDraft.body.status).toBe('draft');
    expect(stillDraft.body.nextWam.at).toBe(when);
    expect(stillDraft.body.calendarInvitations.a.status).toBe('sent');
    expect(stillDraft.body.calendarInvitations.b.status).toBe('sent');
  });

  it('rejects clearing a schedule that is still draft after a partial send failure (no cancellation support)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'b@a.com') throw new Error('ACS send failed: simulated outage');
    });
    const firstAttempt = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when });
    expect(firstAttempt.status).toBe(502);
    expect(firstAttempt.body.wam.status).toBe('draft');

    sendEmailMock.mockClear();
    const cleared = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(cleared.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();

    const stillDraft = await request(app).get(`/api/wams/${wamId}`).set('Cookie', a.cookie);
    expect(stillDraft.body.status).toBe('draft');
    expect(stillDraft.body.nextWam.at).toBe(when);
  });

  it('still allows completing without any schedule for a WAM that never had one', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.wam.nextWam.at).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('allows changing (but not clearing) an already-persisted schedule to a new future time on re-completion', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const firstWhen = futureIso(24);
    const secondWhen = futureIso(72);

    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: firstWhen });
    await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);

    const changed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: secondWhen });
    expect(changed.status).toBe(200);
    expect(changed.body.wam.nextWam.at).toBe(secondWhen);
  });
});
