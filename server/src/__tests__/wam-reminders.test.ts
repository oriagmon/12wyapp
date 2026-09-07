import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the
// idempotency/skip/failure-recording business logic in lib/wamReminders.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import { sendWeeklyWamReminders, monthlyReviewPromptForWeek } from '../lib/wamReminders.js';

const sendEmailMock = vi.mocked(sendEmail);

describe('monthlyReviewPromptForWeek (pure mapping)', () => {
  it('maps week 3/7/11 to the upcoming monthly review week/month', () => {
    expect(monthlyReviewPromptForWeek(3)).toEqual({ targetWeek: 4, monthNumber: 1 });
    expect(monthlyReviewPromptForWeek(7)).toEqual({ targetWeek: 8, monthNumber: 2 });
    expect(monthlyReviewPromptForWeek(11)).toEqual({ targetWeek: 12, monthNumber: 3 });
  });

  it('returns null for every other week and for no active cycle', () => {
    for (const week of [1, 2, 4, 5, 6, 8, 9, 10, 12]) {
      expect(monthlyReviewPromptForWeek(week)).toBeNull();
    }
    expect(monthlyReviewPromptForWeek(null)).toBeNull();
  });
});


async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(app: ReturnType<typeof freshApp>, a: { cookie: string; userId: number }, b: { cookie: string; userId: number }) {
  await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
}

/** Creates an active cycle for the user (starts at week 1) and advances it to `week`. */
async function setCurrentWeek(app: ReturnType<typeof freshApp>, user: { cookie: string }, week: number) {
  await request(app).post('/api/cycle').set('Cookie', user.cookie).send({ name: 'מחזור' });
  await request(app).patch('/api/cycle').set('Cookie', user.cookie).send({ currentWeek: week });
}

// A fixed Tuesday so every test run computes the same ISO week regardless of the day it
// actually executes on.
const FIXED_TUESDAY = new Date('2026-02-10T08:00:00.000Z');

describe('weekly WAM email reminders', () => {
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

  it('emails both members of an active partnership and skips a user without one', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await registerAndLogin(app, 'solo@a.com');
    await pairUsers(app, a, b);

    const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const recipients = sendEmailMock.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual(['a@a.com', 'b@a.com']);
    // Branded Hebrew content links to the app and embeds the visual header by CID.
    const [firstCallArgs] = sendEmailMock.mock.calls;
    expect(firstCallArgs[0].subject).toContain('WAM');
    expect(firstCallArgs[0].html).toContain('https://dashboard.example.com');
    expect(firstCallArgs[0].html).toContain('12WY');
    expect(firstCallArgs[0].html).toContain('cid:12wy-weekly-header');
    expect(firstCallArgs[0].attachments).toHaveLength(1);
    expect(firstCallArgs[0].attachments?.[0]).toEqual(
      expect.objectContaining({
        name: '12wy-weekly.jpg',
        contentType: 'image/jpeg',
        contentId: '12wy-weekly-header',
      })
    );
    expect(firstCallArgs[0].attachments?.[0].contentInBase64.length).toBeGreaterThan(100);
  });

  it('never re-sends to a recipient already marked sent for the same ISO week (idempotent retry)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    const first = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);
    expect(first.sent).toBe(2);

    sendEmailMock.mockClear();
    const second = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

    expect(second.attempted).toBe(0);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(2);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('records a failed send, keeps its process going for other recipients, and retries only the failure next run', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'a@a.com') throw new Error('ACS send failed: simulated outage');
    });

    const first = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);
    expect(first.attempted).toBe(2);
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(1);
    expect(first.failures).toEqual([{ userId: a.userId, error: expect.stringContaining('simulated outage') }]);

    const row = getDb()
      .prepare('SELECT status, error FROM wam_email_reminders WHERE recipient_user_id = ?')
      .get(a.userId) as { status: string; error: string };
    expect(row.status).toBe('failed');
    expect(row.error).toContain('simulated outage');

    // Retry: the previously-failed recipient is attempted again, the already-sent one is not.
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    const second = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);
    expect(second.attempted).toBe(1);
    expect(second.sent).toBe(1);
    expect(second.skipped).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe('a@a.com');
  });

  it('returns no recipients when there are no partnerships', async () => {
    await registerAndLogin(app, 'solo@a.com');
    const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);
    expect(result.attempted).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  describe('monthly review prompt (weeks 4, 8, 12 previewed one week ahead)', () => {
    it.each([
      [3, 4, 1],
      [7, 8, 2],
      [11, 12, 3],
    ])('week %i adds a prompt naming target week %i / month %i, combined into the same email', async (currentWeek, targetWeek, monthNumber) => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setCurrentWeek(app, a, currentWeek);
      // b stays on week 1 — no prompt for them.

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.sent).toBe(2);
      // Still exactly one email per recipient — the prompt is appended, never a second send.
      expect(sendEmailMock).toHaveBeenCalledTimes(2);

      const aCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'a@a.com')!;
      const bCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'b@a.com')!;

      expect(aCall[0].subject).toContain(`שבוע ${targetWeek}`);
      expect(aCall[0].html).toContain(`שבוע ${targetWeek}`);
      expect(aCall[0].html).toContain(`חודש ${monthNumber}`);
      expect(aCall[0].plainText).toContain(`שבוע ${targetWeek}`);
      // The base weekly ask is still present alongside the monthly prompt.
      expect(aCall[0].html).toContain('WAM');

      // The partner (still on week 1) gets only the normal weekly reminder.
      expect(bCall[0].subject).not.toContain('סקירה חודשית');
      expect(bCall[0].html).not.toContain('סקירה חודשית');
    });

    it.each([1, 2, 4, 5, 6, 8, 9, 10, 12])('week %i (not one week before a review) adds no monthly prompt', async (currentWeek) => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setCurrentWeek(app, a, currentWeek);

      await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      const aCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'a@a.com')!;
      expect(aCall[0].subject).not.toContain('סקירה חודשית');
      expect(aCall[0].html).not.toContain('סקירה חודשית');
    });

    it('adds no monthly prompt for a recipient with no active cycle', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      // Neither user creates a cycle at all.

      await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      for (const call of sendEmailMock.mock.calls) {
        expect(call[0].html).not.toContain('סקירה חודשית');
      }
    });
  });
});
