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
import { fallbackLocale, t } from '../lib/i18n/index.js';

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

      // Derived from the dictionary rather than pinned as literals: these recipients are
      // registered without an Accept-Language, so they land on the deployment default, and
      // the point of the assertion is the wiring — that the right key reaches the right
      // recipient with the right numbers — not the wording of the copy.
      const locale = fallbackLocale();
      const calloutTitle = t(locale, 'emails.wamReminder.monthlyCalloutTitle');
      const calloutText = t(locale, 'emails.wamReminder.monthlyCalloutText', {
        week: targetWeek,
        month: monthNumber,
      });

      expect(aCall[0].subject).toBe(
        t(locale, 'emails.wamReminder.subjectMonthly', { week: targetWeek })
      );
      expect(aCall[0].html).toContain(calloutTitle);
      expect(aCall[0].html).toContain(calloutText);
      expect(aCall[0].plainText).toContain(calloutText);
      // The base weekly ask is still present alongside the monthly prompt.
      expect(aCall[0].html).toContain('WAM');

      // The partner (still on week 1) gets only the normal weekly reminder.
      expect(bCall[0].subject).toBe(t(locale, 'emails.wamReminder.subject'));
      expect(bCall[0].html).not.toContain(calloutTitle);
    });

    it.each([1, 2, 4, 5, 6, 8, 9, 10, 12])('week %i (not one week before a review) adds no monthly prompt', async (currentWeek) => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await setCurrentWeek(app, a, currentWeek);

      await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      const aCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'a@a.com')!;
      expect(aCall[0].subject).not.toContain('Monthly review');
      expect(aCall[0].html).not.toContain('Monthly review');
    });

    it('adds no monthly prompt for a recipient with no active cycle', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      // Neither user creates a cycle at all.

      await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      for (const call of sendEmailMock.mock.calls) {
        expect(call[0].html).not.toContain('Monthly review');
      }
    });
  });

  // FIXED_TUESDAY falls in ISO week 2026-W07 (Mon 9 Feb – Sun 15 Feb 2026).
  describe('a meeting already on the calendar suppresses the reminder', () => {
    function partnershipId(): number {
      return (getDb().prepare('SELECT id FROM partnerships').get() as { id: number }).id;
    }

    /** Mirrors what completing a WAM writes: the *next* meeting's time on the current WAM. */
    function scheduleMeeting(nextWamAt: string, week = 1) {
      getDb()
        .prepare('INSERT INTO wams (partnership_id, week, next_wam_at, next_wam_duration_minutes) VALUES (?, ?, ?, 30)')
        .run(partnershipId(), week, nextWamAt);
    }

    async function pairedCouple() {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      return { a, b };
    }

    it('sends nothing to either partner when this week’s WAM is already booked', async () => {
      await pairedCouple();
      scheduleMeeting('2026-02-12T18:00:00.000Z'); // Thursday of the same ISO week

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.attempted).toBe(0);
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(2);
      expect(result.skippedScheduled).toBe(2);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('leaves no reminder row behind, so the next week reminds normally', async () => {
      await pairedCouple();
      scheduleMeeting('2026-02-12T18:00:00.000Z');

      await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);
      const rows = getDb().prepare('SELECT COUNT(*) AS n FROM wam_email_reminders').get() as { n: number };
      expect(rows.n).toBe(0);

      // Next week, with no meeting booked, both partners are reminded again.
      const next = await sendWeeklyWamReminders(getDb(), new Date('2026-02-17T08:00:00.000Z'));
      expect(next.sent).toBe(2);
      expect(next.skippedScheduled).toBe(0);
    });

    it('still reminds when the only booked meeting is in a different week', async () => {
      await pairedCouple();
      scheduleMeeting('2026-02-17T18:00:00.000Z'); // next ISO week
      scheduleMeeting('2026-02-03T18:00:00.000Z', 2); // previous ISO week

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.sent).toBe(2);
      expect(result.skippedScheduled).toBe(0);
    });

    it('counts a meeting that already happened earlier this week', async () => {
      await pairedCouple();
      scheduleMeeting('2026-02-09T08:00:00.000Z'); // Monday, before Tuesday's run

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.skippedScheduled).toBe(2);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it.each([
      // Sun 22:30 UTC is already Monday in Israel, so it belongs to the *next* ISO week.
      ['2026-02-15T22:30:00.000Z', 2, 0],
      // Sun 22:30 UTC the week before is likewise Monday 9 Feb in Israel — this week.
      ['2026-02-08T22:30:00.000Z', 0, 2],
    ])('buckets %s by the Israel calendar, not UTC', async (nextWamAt, expectedSent, expectedSuppressed) => {
      await pairedCouple();
      scheduleMeeting(nextWamAt as string);

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.sent).toBe(expectedSent);
      expect(result.skippedScheduled).toBe(expectedSuppressed);
    });

    it('ignores an unreadable stored time instead of treating it as this week', async () => {
      await pairedCouple();
      scheduleMeeting('not-a-timestamp');

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.sent).toBe(2);
      expect(result.skippedScheduled).toBe(0);
    });

    it('only suppresses the partnership that booked, leaving others reminded', async () => {
      const { a, b } = await pairedCouple();
      const c = await registerAndLogin(app, 'c@a.com');
      const d = await registerAndLogin(app, 'd@a.com');
      await pairUsers(app, c, d);
      const booked = (getDb()
        .prepare('SELECT id FROM partnerships WHERE initiator_id = ?')
        .get(a.userId) as { id: number }).id;
      getDb()
        .prepare('INSERT INTO wams (partnership_id, week, next_wam_at, next_wam_duration_minutes) VALUES (?, 1, ?, 30)')
        .run(booked, '2026-02-12T18:00:00.000Z');

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      expect(result.skippedScheduled).toBe(2);
      expect(result.sent).toBe(2);
      expect(sendEmailMock.mock.calls.map((call) => call[0].to).sort()).toEqual(['c@a.com', 'd@a.com']);
      expect(b.email).toBe('b@a.com'); // the booked pair is untouched
    });

    it('still sends the monthly review heads-up, without asking about this week again', async () => {
      const { a } = await pairedCouple();
      await setCurrentWeek(app, a, 3); // one week before the month-1 review
      scheduleMeeting('2026-02-12T18:00:00.000Z');

      const result = await sendWeeklyWamReminders(getDb(), FIXED_TUESDAY);

      // Only the recipient with a pending monthly review is written to; their partner, who
      // has nothing left to schedule, is suppressed.
      expect(result.sent).toBe(1);
      expect(result.skippedScheduled).toBe(1);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);

      const locale = fallbackLocale();
      const [call] = sendEmailMock.mock.calls;
      expect(call[0].to).toBe('a@a.com');
      expect(call[0].subject).toBe(t(locale, 'emails.wamReminder.subjectMonthlyOnly', { week: 4 }));
      expect(call[0].subject).not.toBe(t(locale, 'emails.wamReminder.subjectMonthly', { week: 4 }));
      expect(call[0].html).toContain(t(locale, 'emails.wamReminder.bodyAlreadyScheduled'));
      expect(call[0].html).toContain(t(locale, 'emails.wamReminder.monthlyCalloutText', { week: 4, month: 1 }));
      // The "have you set a time yet" nudge is exactly what must not appear.
      expect(call[0].html).not.toContain(t(locale, 'emails.wamReminder.body2'));
      expect(call[0].html).not.toContain(t(locale, 'emails.wamReminder.title'));
    });
  });
});
