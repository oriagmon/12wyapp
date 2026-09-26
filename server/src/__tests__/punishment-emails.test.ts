import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { closeDb, getDb } from '../db.js';
import { extractCookie, freshApp } from './helpers.js';

vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import { buildPunishmentEmail } from '../lib/punishmentEmails.js';

const sendEmailMock = vi.mocked(sendEmail);

function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

beforeEach(() => {
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

describe('punishment emails', () => {
  it('emails both partners after each punishment is created, localized per recipient', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'ori@example.com');
    const partner = await registerAndLogin(app, 'partner@example.com');
    getDb()
      .prepare('UPDATE users SET display_name = ?, locale = ? WHERE id = ?')
      .run('Ori', 'en', ori.userId);
    getDb()
      .prepare('UPDATE users SET display_name = ?, locale = ? WHERE id = ?')
      .run('Neta', 'he', partner.userId);

    const pairing = await request(app)
      .post('/api/partnerships/pair')
      .set('Cookie', ori.cookie)
      .send({ targetUserId: partner.userId });
    expect(pairing.status).toBe(201);
    const wam = await request(app).post('/api/wams').set('Cookie', ori.cookie).send({ week: 4 });

    const created = await request(app)
      .post(`/api/wams/${wam.body.id}/punishments`)
      .set('Cookie', ori.cookie)
      .send({ label: '<b>Run five kilometers</b>', assignedUserId: partner.userId });
    expect(created.status).toBe(201);
    await flushSetImmediate();

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls.map(([message]) => message.to).sort()).toEqual([
      ori.email,
      partner.email,
    ]);

    const english = sendEmailMock.mock.calls.find(([message]) => message.to === ori.email)![0];
    expect(english.subject).toBe('A new WAM punishment was added');
    expect(english.html).toContain('lang="en" dir="ltr"');
    expect(english.html).toContain('&lt;b&gt;Run five kilometers&lt;/b&gt;');
    expect(english.plainText).toContain('Ori added a punishment assigned to Neta.');

    const hebrew = sendEmailMock.mock.calls.find(([message]) => message.to === partner.email)![0];
    expect(hebrew.subject).toBe('נוסף עונש חדש ב-WAM');
    expect(hebrew.html).toContain('lang="he" dir="rtl"');
    expect(hebrew.plainText).toContain('Ori הוסיף/ה עונש שמשויך ל-Neta.');
  });

  it('renders the punishment text as escaped email content', () => {
    const email = buildPunishmentEmail(
      'https://dashboard.example.com',
      {
        authorLabel: 'Ori',
        assignedLabel: 'Neta',
        label: '<script>alert("x")</script>',
        week: 2,
      },
      'en',
    );

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(email.plainText).toContain('<script>alert("x")</script>');
  });
});
