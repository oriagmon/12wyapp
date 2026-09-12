import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

// Mocks the actual ACS network call so these tests never contact Azure — only the business
// logic in lib/weekMilestones.ts and its hook in routes/completions.ts is exercised.
vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import {
  MILESTONE_THRESHOLD,
  PHRASE_VARIANT_COUNT,
  MAX_ATTEMPTS,
  buildMilestoneEmail,
  currentWeekScore,
  electFirstToMilestone,
  runDueWeekMilestoneEmails,
  type WeekMilestoneRow,
} from '../lib/weekMilestones.js';
import { israelWeekStart } from '../lib/israelTime.js';
import { emails as emailsDict } from '../lib/i18n/dict/index.js';

const sendEmailMock = vi.mocked(sendEmail);

/** The email send is deliberately deferred (via setImmediate) until after the toggle response
 *  has already been sent. Awaiting one macrotask tick is enough to deterministically observe
 *  it having run to completion — see the identical helper in broosts.test.ts. */
function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type App = ReturnType<typeof freshApp>;

async function registerAndLogin(app: App, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pair(app: App, a: { cookie: string }, b: { userId: number }): Promise<number> {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  expect(res.status).toBe(201);
  return res.body.partner.partnershipId as number;
}

/**
 * Gives a user an active cycle with one goal and one tactic scheduled on `weekdays`, and
 * returns the tactic id. Four weekdays is the useful default: it makes each tick worth
 * exactly 25%, so a test can land precisely on 25 / 50 / 75 / 100 and prove the threshold
 * fires on the step that crosses it and not a step earlier.
 */
function seedPlan(userId: number, weekdays: number[] = [0, 1, 2, 3], currentWeek = 1): number {
  const db = getDb();
  const cycle = db
    .prepare('INSERT INTO cycles (user_id, name, current_week, is_active) VALUES (?, ?, ?, 1)')
    .run(userId, 'Test cycle', currentWeek);
  const goal = db
    .prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)')
    .run(Number(cycle.lastInsertRowid), 'Goal', '#3b82f6');
  const tactic = db
    .prepare('INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, 1, 12)')
    .run(Number(goal.lastInsertRowid), 'Tactic', JSON.stringify(weekdays));
  return Number(tactic.lastInsertRowid);
}

async function tick(app: App, cookie: string, tacticId: number, weekday: number, week = 1, done = true) {
  const res = await request(app)
    .post('/api/completions/toggle')
    .set('Cookie', cookie)
    .send({ tacticId, week, weekday, done });
  expect(res.status).toBe(200);
  await flushSetImmediate();
  return res;
}

function milestoneRows(): WeekMilestoneRow[] {
  return getDb().prepare('SELECT * FROM week_milestone_emails ORDER BY id').all() as WeekMilestoneRow[];
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

afterAll(() => {
  closeDb();
});

describe('first-to-50% election', () => {
  it('emails the partner when someone first crosses half the week', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId);

    await tick(app, ori.cookie, tacticId, 0); // 25% — not yet
    expect(milestoneRows()).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();

    await tick(app, ori.cookie, tacticId, 1); // 50% — crosses

    const rows = milestoneRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      achiever_id: ori.userId,
      recipient_id: partner.userId,
      score: 50,
      cycle_week: 1,
      email_status: 'sent',
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe(partner.email);
  });

  it('only ever tells the partner, never the achiever', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId, [0, 1]);

    await tick(app, ori.cookie, tacticId, 0); // 50%

    const recipients = sendEmailMock.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual([partner.email]);
  });

  it('crowns only the first of the two, even when both pass half the week', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const oriTactic = seedPlan(ori.userId, [0, 1]);
    const partnerTactic = seedPlan(partner.userId, [0, 1]);

    await tick(app, ori.cookie, oriTactic, 0); // Ori is first to 50%
    await tick(app, partner.cookie, partnerTactic, 0); // partner gets there too, later

    const rows = milestoneRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].achiever_id).toBe(ori.userId);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a second email as the winner keeps going', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId);

    await tick(app, ori.cookie, tacticId, 0);
    await tick(app, ori.cookie, tacticId, 1); // 50% — the one email
    await tick(app, ori.cookie, tacticId, 2); // 75%
    await tick(app, ori.cookie, tacticId, 3); // 100%

    expect(milestoneRows()).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm when the winner unticks back below half', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId);

    await tick(app, ori.cookie, tacticId, 0);
    await tick(app, ori.cookie, tacticId, 1); // 50% — email sent
    await tick(app, ori.cookie, tacticId, 1, 1, false); // back down to 25%
    await tick(app, ori.cookie, tacticId, 1); // and up over half again

    expect(milestoneRows()).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('never sends anything on an untick', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId, [0, 1]);

    // Seed 50% directly so the only toggle in this test is an untick that leaves them at 50%.
    const db = getDb();
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(tacticId);
    await tick(app, ori.cookie, tacticId, 1, 1, false);

    expect(milestoneRows()).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('stays quiet for someone with no partner to tell', async () => {
    const app = freshApp();
    const solo = await registerAndLogin(app, 'solo@example.com');
    const tacticId = seedPlan(solo.userId, [0, 1]);

    await tick(app, solo.cookie, tacticId, 0); // 50%, but nobody to tell

    expect(milestoneRows()).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('runs a fresh race the following week', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    const partnershipId = await pair(app, ori, partner);
    seedPlan(ori.userId, [0, 1]);
    const db = getDb();

    // Last week already has a winner; this week's race must be unaffected by it.
    db.prepare(
      `INSERT INTO week_milestone_emails
         (partnership_id, achiever_id, recipient_id, week_key, cycle_week, score, phrase_variant, email_status)
       VALUES (?, ?, ?, ?, 1, 60, 0, 'sent')`
    ).run(partnershipId, partner.userId, ori.userId, '2020-01-05');

    const completions = db.prepare('SELECT id FROM tactics').all() as { id: number }[];
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(completions[0].id);

    const outcome = electFirstToMilestone(db, ori.userId);
    expect(outcome.status).toBe('elected');
    expect(milestoneRows()).toHaveLength(2);
  });

  it('files the week under the Israel Sunday that started it', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId, [0, 1]);
    getDb().prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(tacticId);

    // Wednesday 2026-09-09, 00:34 Israel time — deliberately the same awkward just-after-
    // midnight moment that broke the execution-risk card, and a day on which the ISO week
    // (Monday-anchored) and this app's week (Sunday-anchored) disagree about the date.
    const justAfterMidnightWednesday = new Date('2026-09-08T21:34:00Z');
    const outcome = electFirstToMilestone(getDb(), ori.userId, justAfterMidnightWednesday);

    expect(outcome.status).toBe('elected');
    expect(milestoneRows()[0].week_key).toBe('2026-09-06'); // the Sunday, not Monday the 7th
  });

  it('reports a losing race as already-won rather than throwing', () => {
    const app = freshApp();
    // Elections are pure DB work, so this exercises the race directly rather than through HTTP.
    return (async () => {
      const ori = await registerAndLogin(app, 'a@example.com');
      const partner = await registerAndLogin(app, 'b@example.com');
      await pair(app, ori, partner);
      const tacticId = seedPlan(ori.userId, [0, 1]);
      const partnerTactic = seedPlan(partner.userId, [0, 1]);
      const db = getDb();
      db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(tacticId);
      db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(partnerTactic);

      expect(electFirstToMilestone(db, ori.userId).status).toBe('elected');
      expect(electFirstToMilestone(db, partner.userId).status).toBe('already-won');
      expect(milestoneRows()).toHaveLength(1);
    })();
  });

  it('ignores a week with nothing scheduled at all', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    seedPlan(ori.userId, [0, 1], 5); // on week 5; the tactic runs weeks 1-12 but nothing is done

    expect(currentWeekScore(getDb(), ori.userId)).toEqual({ cycleWeek: 5, score: 0 });
    expect(electFirstToMilestone(getDb(), ori.userId).status).toBe('not-eligible');
  });

  it('counts the week the way the dashboard does, honouring a week override', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const tacticId = seedPlan(ori.userId, [0, 1, 2, 3]);
    const db = getDb();
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(tacticId);

    // One of four days done is 25%...
    expect(currentWeekScore(db, ori.userId)).toEqual({ cycleWeek: 1, score: 25 });

    // ...but "adapt this week" cutting the plan to two days makes the same tick worth 50%.
    db.prepare(
      'INSERT INTO tactic_week_overrides (tactic_id, week, title, weekdays) VALUES (?, 1, ?, ?)'
    ).run(tacticId, 'Tactic', JSON.stringify([0, 1]));
    expect(currentWeekScore(db, ori.userId)).toEqual({ cycleWeek: 1, score: 50 });
  });

  it('does not fail the toggle when the email cannot be sent', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    const tacticId = seedPlan(ori.userId, [0, 1]);
    sendEmailMock.mockRejectedValue(new Error('ACS is down'));

    const res = await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', ori.cookie)
      .send({ tacticId, week: 1, weekday: 0, done: true });
    await flushSetImmediate();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tacticId, week: 1, weekday: 0, done: true });
    const rows = milestoneRows();
    expect(rows[0].email_status).toBe('failed');
    expect(rows[0].email_next_attempt_at).not.toBeNull(); // still queued for the worker
  });
});

describe('milestone email copy', () => {
  it('has every phrasing in both languages', () => {
    for (const locale of ['en', 'he'] as const) {
      for (let i = 0; i < PHRASE_VARIANT_COUNT; i++) {
        expect(emailsDict[locale][`emails.weekMilestone.line.${i}`], `${locale} line ${i}`).toBeTruthy();
      }
      // Exactly ten — an eleventh in the dictionary would simply never be picked.
      expect(emailsDict[locale]['emails.weekMilestone.line.' + PHRASE_VARIANT_COUNT]).toBeUndefined();
    }
  });

  it('renders every variant with the name and score filled in, in both languages', () => {
    for (const locale of ['en', 'he'] as const) {
      const subjects = new Set<string>();
      for (let variant = 0; variant < PHRASE_VARIANT_COUNT; variant++) {
        const email = buildMilestoneEmail('https://example.com', 'Ori', 3, 75, variant, locale);
        expect(email.subject).toContain('Ori');
        expect(email.subject).toContain('75');
        expect(email.subject).not.toMatch(/[{}]/); // no unfilled placeholder
        expect(email.subject).not.toContain('emails.weekMilestone'); // no missing-key id
        subjects.add(email.subject);
      }
      expect(subjects.size, `${locale} should have 10 distinct phrasings`).toBe(PHRASE_VARIANT_COUNT);
    }
  });

  it('falls back to a real phrasing for an out-of-range variant', () => {
    const email = buildMilestoneEmail('https://example.com', 'Ori', 1, 50, 99, 'en');
    expect(email.subject).toBe(buildMilestoneEmail('https://example.com', 'Ori', 1, 50, PHRASE_VARIANT_COUNT - 1, 'en').subject);
  });

  it('writes to the recipient in their own language', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    getDb().prepare("UPDATE users SET locale = 'he' WHERE id = ?").run(partner.userId);
    const tacticId = seedPlan(ori.userId, [0, 1]);

    await tick(app, ori.cookie, tacticId, 0);

    expect(sendEmailMock.mock.calls[0][0].html).toContain('dir="rtl"');
  });

  it('spreads its phrasing choice across the variants', () => {
    const app = freshApp();
    // Not a randomness test — just a guard that the picker is not pinned to one variant.
    const seen = new Set<number>();
    for (let i = 0; i < PHRASE_VARIANT_COUNT * 40; i++) {
      seen.add(Math.min(Math.floor(Math.random() * PHRASE_VARIANT_COUNT), PHRASE_VARIANT_COUNT - 1));
    }
    expect(seen.size).toBe(PHRASE_VARIANT_COUNT);
    expect(app).toBeDefined();
  });
});

describe('milestone delivery worker', () => {
  function insertDue(fields: {
    partnershipId: number;
    achieverId: number;
    recipientId: number;
    emailStatus?: string;
    emailNextAttemptAt?: string | null;
    emailClaimedAt?: string | null;
    emailAttemptCount?: number;
  }): number {
    const info = getDb()
      .prepare(
        `INSERT INTO week_milestone_emails
           (partnership_id, achiever_id, recipient_id, week_key, cycle_week, score, phrase_variant,
            email_status, email_next_attempt_at, email_claimed_at, email_attempt_count)
         VALUES (?, ?, ?, ?, 1, 50, 0, ?, ?, ?, ?)`
      )
      .run(
        fields.partnershipId,
        fields.achieverId,
        fields.recipientId,
        israelWeekStart(),
        fields.emailStatus ?? 'pending',
        fields.emailNextAttemptAt === undefined ? new Date().toISOString() : fields.emailNextAttemptAt,
        fields.emailClaimedAt ?? null,
        fields.emailAttemptCount ?? 0
      );
    return Number(info.lastInsertRowid);
  }

  async function pairedApp() {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    const partnershipId = await pair(app, ori, partner);
    return { app, ori, partner, partnershipId };
  }

  it('delivers a row the immediate attempt never got to', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    insertDue({ partnershipId, achieverId: ori.userId, recipientId: partner.userId });

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(milestoneRows()[0].email_status).toBe('sent');
    expect(sendEmailMock.mock.calls[0][0].to).toBe(partner.email);
  });

  it('leaves an already-sent row alone', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    insertDue({ partnershipId, achieverId: ori.userId, recipientId: partner.userId, emailStatus: 'sent', emailNextAttemptAt: null });

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('reclaims a row abandoned by a crashed worker', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    const staleClaim = new Date(Date.now() - 60 * 60_000).toISOString();
    insertDue({
      partnershipId,
      achieverId: ori.userId,
      recipientId: partner.userId,
      emailStatus: 'sending',
      emailClaimedAt: staleClaim,
    });

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result.sent).toBe(1);
  });

  it('will not touch a row another worker is actively sending', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    insertDue({
      partnershipId,
      achieverId: ori.userId,
      recipientId: partner.userId,
      emailStatus: 'sending',
      emailClaimedAt: new Date().toISOString(),
    });

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result.attempted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('backs off after a failure, then gives up for good', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    insertDue({ partnershipId, achieverId: ori.userId, recipientId: partner.userId });
    sendEmailMock.mockRejectedValue(new Error('provider exploded'));

    await runDueWeekMilestoneEmails(getDb());
    const afterFirst = milestoneRows()[0];
    expect(afterFirst.email_status).toBe('failed');
    expect(afterFirst.email_next_attempt_at).not.toBeNull(); // retry scheduled

    // Exhaust the attempts; the last one must clear next_attempt_at so it stops retrying.
    getDb()
      .prepare('UPDATE week_milestone_emails SET email_attempt_count = ?, email_next_attempt_at = ? WHERE id = ?')
      .run(MAX_ATTEMPTS, new Date().toISOString(), afterFirst.id);
    await runDueWeekMilestoneEmails(getDb());

    const exhausted = milestoneRows()[0];
    expect(exhausted.email_status).toBe('failed');
    expect(exhausted.email_next_attempt_at).toBeNull();
  });

  it('keeps going when one row fails', async () => {
    const { app, ori, partner, partnershipId } = await pairedApp();
    const third = await registerAndLogin(app, 'c@example.com');
    const secondPartnership = Number(
      getDb()
        .prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (?, ?)')
        .run(partner.userId, third.userId).lastInsertRowid
    );
    insertDue({ partnershipId, achieverId: ori.userId, recipientId: partner.userId });
    insertDue({ partnershipId: secondPartnership, achieverId: partner.userId, recipientId: third.userId });
    sendEmailMock.mockRejectedValueOnce(new Error('first one failed')).mockResolvedValue(undefined);

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result).toMatchObject({ attempted: 2, sent: 1, failed: 1 });
  });

  it('still delivers after the two have unpaired', async () => {
    const { ori, partner, partnershipId } = await pairedApp();
    insertDue({ partnershipId, achieverId: ori.userId, recipientId: partner.userId });
    // ON DELETE SET NULL: the record of what happened outlives the partnership.
    getDb().prepare('DELETE FROM partnerships WHERE id = ?').run(partnershipId);

    const result = await runDueWeekMilestoneEmails(getDb());

    expect(result.sent).toBe(1);
    expect(milestoneRows()[0].partnership_id).toBeNull();
  });
});

describe('the threshold itself', () => {
  it('is half the week', () => {
    expect(MILESTONE_THRESHOLD).toBe(50);
  });

  it('fires exactly on the threshold, not one tick later', async () => {
    const app = freshApp();
    const ori = await registerAndLogin(app, 'a@example.com');
    const partner = await registerAndLogin(app, 'b@example.com');
    await pair(app, ori, partner);
    // Three days: 1/3 = 33% (under), 2/3 = 67% (over). Proves the rule is ">= 50", not "> 50"
    // and not "the whole week".
    const tacticId = seedPlan(ori.userId, [0, 1, 2]);

    await tick(app, ori.cookie, tacticId, 0);
    expect(milestoneRows()).toHaveLength(0);

    await tick(app, ori.cookie, tacticId, 1);
    expect(milestoneRows()).toHaveLength(1);
    expect(milestoneRows()[0].score).toBe(67);
  });
});
