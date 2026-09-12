import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

vi.mock('../lib/emailSender.js', () => ({ sendEmail: vi.fn() }));

import { sendEmail } from '../lib/emailSender.js';
import {
  PHRASE_VARIANT_COUNT,
  buildRecapEmail,
  electWeekRecap,
  finishedWeekScores,
  previousWeekKey,
  runDueWeekRecapEmails,
  type WeekRecapRow,
} from '../lib/weekRecap.js';
import { emails as emailsDict } from '../lib/i18n/dict/index.js';

const sendEmailMock = vi.mocked(sendEmail);

type App = ReturnType<typeof freshApp>;

/** A Sunday and a Wednesday in Israel local time, for exercising the send-day rule. */
const SUNDAY = new Date('2026-09-13T06:00:00.000Z');
const WEDNESDAY = new Date('2026-09-16T06:00:00.000Z');

async function registerAndLogin(app: App, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number };
}

/** Four scheduled weekdays makes each tick worth exactly 25%, so a week can be landed on an
 *  exact 25/50/75/100 and an average asserted without rounding ambiguity. */
function seedPlan(userId: number, currentWeek = 1): number {
  const db = getDb();
  const cycle = db
    .prepare('INSERT INTO cycles (user_id, name, current_week, is_active) VALUES (?, ?, ?, 1)')
    .run(userId, 'Test cycle', currentWeek);
  const goal = db
    .prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)')
    .run(Number(cycle.lastInsertRowid), 'Goal', '#3b82f6');
  const tactic = db
    .prepare('INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, 1, 12)')
    .run(Number(goal.lastInsertRowid), 'Tactic', JSON.stringify([0, 1, 2, 3]));
  return Number(tactic.lastInsertRowid);
}

/** Ticks `count` of the four scheduled days in `week`, writing completions directly so a test
 *  can compose several finished weeks without walking the cycle through the UI. */
function completeDays(tacticId: number, week: number, count: number) {
  const db = getDb();
  for (let weekday = 0; weekday < count; weekday++) {
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, ?, ?, 1)')
      .run(tacticId, week, weekday);
  }
}

function setCurrentWeek(userId: number, week: number) {
  getDb().prepare('UPDATE cycles SET current_week = ? WHERE user_id = ?').run(week, userId);
}

function recapRows(): WeekRecapRow[] {
  return getDb().prepare('SELECT * FROM week_recap_emails ORDER BY id').all() as WeekRecapRow[];
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

describe('Weekly recap: which weeks count', () => {
  it('reports only weeks the cycle has moved past, never the one still running', () => {
    const app = freshApp();
    const user = { userId: 0 };
    return (async () => {
      const a = await registerAndLogin(app, 'scores@example.com');
      user.userId = a.userId;
      const tactic = seedPlan(a.userId);
      completeDays(tactic, 1, 4); // 100%
      completeDays(tactic, 2, 3); // 75%
      completeDays(tactic, 3, 1); // 25% — but week 3 is still in progress
      setCurrentWeek(a.userId, 3);

      const result = finishedWeekScores(getDb(), a.userId);
      expect(result?.scores).toEqual([{ week: 1, score: 100 }, { week: 2, score: 75 }]);
      expect(result?.average).toBe(88);
    })();
  });

  it('has nothing to report while still inside week 1', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'week1@example.com');
    const tactic = seedPlan(a.userId);
    completeDays(tactic, 1, 4);

    expect(finishedWeekScores(getDb(), a.userId)).toBeNull();
    expect(electWeekRecap(getDb(), a.userId, SUNDAY).status).toBe('nothing-to-report');
  });

  it('matches the example: 90/85/80 averages to 85', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'avg@example.com');
    const db = getDb();
    const cycle = db.prepare('INSERT INTO cycles (user_id, name, current_week, is_active) VALUES (?, ?, 4, 1)')
      .run(a.userId, 'Cycle');
    const goal = db.prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)')
      .run(Number(cycle.lastInsertRowid), 'Goal', '#3b82f6');
    // 20 scheduled days per week (5 tactics x 4 days) so 90 / 85 / 80 are all exactly reachable.
    const tactics: number[] = [];
    for (let i = 0; i < 5; i++) {
      tactics.push(Number(db.prepare('INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, 1, 12)')
        .run(Number(goal.lastInsertRowid), `T${i}`, JSON.stringify([0, 1, 2, 3])).lastInsertRowid));
    }
    const fill = (week: number, done: number) => {
      let remaining = done;
      for (const tactic of tactics) {
        for (let weekday = 0; weekday < 4 && remaining > 0; weekday++, remaining--) {
          db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, ?, ?, 1)')
            .run(tactic, week, weekday);
        }
      }
    };
    fill(1, 18); // 90%
    fill(2, 17); // 85%
    fill(3, 16); // 80%

    const result = finishedWeekScores(getDb(), a.userId);
    expect(result?.scores.map((s) => s.score)).toEqual([90, 85, 80]);
    expect(result?.average).toBe(85);
  });
});

describe('Weekly recap: when it sends', () => {
  it('sends only once the calendar week has ended, not mid-week', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'when@example.com');
    const tactic = seedPlan(a.userId);
    completeDays(tactic, 1, 4);
    setCurrentWeek(a.userId, 2);

    expect(electWeekRecap(getDb(), a.userId, WEDNESDAY).status).toBe('week-not-over');
    expect(recapRows()).toHaveLength(0);

    expect(electWeekRecap(getDb(), a.userId, SUNDAY).status).toBe('elected');
    expect(recapRows()).toHaveLength(1);
  });

  it('recaps the week that just ended, not the one now starting', () => {
    // The Sunday under test opens the week of 2026-09-13, so the week being recapped is the
    // one before it.
    expect(previousWeekKey(SUNDAY)).toBe('2026-09-06');
  });

  // The UNIQUE constraint, not a prior read, is what makes this safe: the worker runs every
  // minute all Sunday long.
  it('sends exactly one recap per person per week however often the worker runs', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'once@example.com');
    const tactic = seedPlan(a.userId);
    completeDays(tactic, 1, 4);
    setCurrentWeek(a.userId, 2);

    expect(electWeekRecap(getDb(), a.userId, SUNDAY).status).toBe('elected');
    for (let i = 0; i < 5; i++) {
      expect(electWeekRecap(getDb(), a.userId, SUNDAY).status).toBe('already-sent');
    }
    expect(recapRows()).toHaveLength(1);
  });

  it('gives each partner their own recap addressed to them', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'partner-a@example.com');
    const b = await registerAndLogin(app, 'partner-b@example.com');
    const tacticA = seedPlan(a.userId);
    const tacticB = seedPlan(b.userId);
    completeDays(tacticA, 1, 4);
    completeDays(tacticB, 1, 2);
    setCurrentWeek(a.userId, 2);
    setCurrentWeek(b.userId, 2);

    const result = await runDueWeekRecapEmails(getDb(), SUNDAY);

    expect(result.elected).toBe(2);
    expect(result.sent).toBe(2);
    const recipients = sendEmailMock.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual(['partner-a@example.com', 'partner-b@example.com']);
    expect(recapRows().map((row) => row.average_score).sort((x, y) => x - y)).toEqual([50, 100]);
  });

  it('skips a user whose cycle has not moved past week 1 while still sending the other one', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'ready@example.com');
    const b = await registerAndLogin(app, 'notready@example.com');
    const tacticA = seedPlan(a.userId);
    seedPlan(b.userId);
    completeDays(tacticA, 1, 4);
    setCurrentWeek(a.userId, 2);

    const result = await runDueWeekRecapEmails(getDb(), SUNDAY);

    expect(result.elected).toBe(1);
    expect(result.sent).toBe(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe('ready@example.com');
  });
});

describe('Weekly recap: the email itself', () => {
  it('renders every phrasing with the name and average filled in', () => {
    for (let variant = 0; variant < PHRASE_VARIANT_COUNT; variant++) {
      const email = buildRecapEmail(
        'https://dashboard.example.com', 'Ori',
        [{ week: 1, score: 90 }, { week: 2, score: 80 }], 85, 2, variant, 'en'
      );
      expect(email.subject).toContain('Ori');
      expect(email.subject).toContain('85');
      expect(email.subject).not.toMatch(/[{}]/);
      expect(email.subject).not.toContain('emails.weekRecap');
    }
  });

  it('puts every finished week and the average in the table, in both languages', () => {
    for (const locale of ['en', 'he'] as const) {
      const email = buildRecapEmail(
        'https://dashboard.example.com', 'Ori',
        [{ week: 1, score: 90 }, { week: 2, score: 85 }, { week: 3, score: 80 }], 85, 3, 0, locale
      );
      for (const score of ['90%', '85%', '80%']) {
        expect(email.html).toContain(score);
        expect(email.plainText).toContain(score);
      }
      const averageLabel = emailsDict[locale]['emails.weekRecap.averageLabel'];
      expect(email.plainText).toContain(`${averageLabel}: 85%`);
      expect(email.html).not.toMatch(/emails\.weekRecap/);
    }
  });

  it('clamps an out-of-range stored phrasing instead of leaking a missing-key id', () => {
    const email = buildRecapEmail('https://dashboard.example.com', 'Ori', [{ week: 1, score: 90 }], 90, 1, 999, 'en');
    expect(email.subject).not.toContain('emails.weekRecap');
    expect(email.subject).toContain('90');
  });

  it('tells you whether the average clears the 85% target', () => {
    const on = buildRecapEmail('https://dashboard.example.com', 'Ori', [{ week: 1, score: 90 }], 90, 1, 0, 'en');
    const off = buildRecapEmail('https://dashboard.example.com', 'Ori', [{ week: 1, score: 40 }], 40, 1, 0, 'en');
    expect(on.html).toContain(emailsDict.en['emails.weekRecap.onTrackTitle']);
    expect(off.html).toContain(emailsDict.en['emails.weekRecap.offTrackTitle']);
  });

  it('sends the frozen scoreboard on a retry, not a recomputed one', async () => {
    const app = freshApp();
    const a = await registerAndLogin(app, 'retry@example.com');
    const tactic = seedPlan(a.userId);
    completeDays(tactic, 1, 2); // 50%
    setCurrentWeek(a.userId, 2);

    sendEmailMock.mockRejectedValueOnce(new Error('provider down'));
    const first = await runDueWeekRecapEmails(getDb(), SUNDAY);
    expect(first.failed).toBe(1);

    // The underlying week improves after the failure; the retry must still report 50%.
    getDb().prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 2, 1)').run(tactic);
    const retryAt = new Date(SUNDAY.getTime() + 60 * 60 * 1000);
    const second = await runDueWeekRecapEmails(getDb(), retryAt);

    expect(second.sent).toBe(1);
    expect(sendEmailMock.mock.calls[1][0].plainText).toContain('50%');
    expect(sendEmailMock.mock.calls[1][0].plainText).not.toContain('75%');
  });
});
