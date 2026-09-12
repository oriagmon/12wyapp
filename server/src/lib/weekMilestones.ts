import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { getAcceptedPartner } from './access.js';
import { israelWeekStart } from './israelTime.js';
import { sendEmail } from './emailSender.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { computeWeekScores, TARGET_SCORE, type TacticWithCompletions } from './scoring.js';
import { fallbackLocale, t } from './i18n/index.js';
import type { Locale } from './i18n/core.js';

/**
 * "First to 50%" — the first partner to get halfway through their own week's plan triggers a
 * single email to the *other* one saying so.
 *
 * The whole feature is deliberately built on one idea: the `UNIQUE (partnership_id, week_key)`
 * index in migration 022 **is** the race. Electing a winner is one INSERT; if it succeeds you
 * were first, and if it raises a constraint violation someone else already was. Nothing reads
 * "has anyone won yet?" before writing, because a check-then-write can hand the crown to both
 * partners when they tick their last box at the same moment.
 *
 * Delivery mirrors `lib/broosts.ts` exactly — a best-effort immediate send right after the
 * toggle request has already been answered, plus a per-minute worker as the durable safety
 * net — so all three email paths in this app share one claim/retry/backoff shape.
 */

/** Half the week. Crossing *up* through this triggers the email. */
export const MILESTONE_THRESHOLD = 50;

/** How many congratulation phrasings exist per locale (`emails.weekMilestone.line.0..9`).
 *  One is chosen at random per week and then frozen on the row — see `phrase_variant` in
 *  migration 022. Keep in sync with the dictionary; the i18n test asserts they match. */
export const PHRASE_VARIANT_COUNT = 10;

export const MAX_ATTEMPTS = 5;
const STALE_LEASE_MINUTES = 10;
const BACKOFF_MINUTES = [5, 15, 45, 135, 405];

export type MilestoneEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface WeekMilestoneRow {
  id: number;
  partnership_id: number | null;
  achiever_id: number;
  recipient_id: number;
  week_key: string;
  cycle_week: number;
  score: number;
  phrase_variant: number;
  created_at: string;
  email_status: MilestoneEmailStatus;
  email_attempt_count: number;
  email_last_error: string | null;
  email_next_attempt_at: string | null;
  email_claimed_at: string | null;
  email_sent_at: string | null;
}

/** Sanitizes an error into a short, safe-to-persist message — never a raw stack trace,
 *  provider payload, or PII. */
export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'unknown email send error';
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function backoffMinutesForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx];
}

/** Picks which phrasing this week's email uses. Injectable so tests can pin a variant
 *  instead of asserting against randomness. */
export type VariantPicker = () => number;

const defaultVariantPicker: VariantPicker = () => Math.floor(Math.random() * PHRASE_VARIANT_COUNT);

interface ActiveCycleRow {
  id: number;
  current_week: number;
}

/**
 * The user's score (0-100) for the week they are currently on, or null if they have no active
 * cycle or nothing at all scheduled that week (in which case there is no "half" to cross).
 *
 * Uses the same `computeWeekScores` the dashboard does, so the number in the email is exactly
 * the number the achiever saw on screen — including tactic week overrides, which are what
 * "adapt next week" writes.
 */
export function currentWeekScore(
  db: Database.Database,
  userId: number
): { cycleWeek: number; score: number } | null {
  const cycle = db
    .prepare('SELECT id, current_week FROM cycles WHERE user_id = ? AND is_active = 1')
    .get(userId) as ActiveCycleRow | undefined;
  if (!cycle) return null;

  const goals = db.prepare('SELECT id FROM goals WHERE cycle_id = ?').all(cycle.id) as { id: number }[];
  if (goals.length === 0) return null;
  const goalPlaceholders = goals.map(() => '?').join(',');
  const tacticRows = db
    .prepare(`SELECT id, weekdays, start_week, end_week FROM tactics WHERE goal_id IN (${goalPlaceholders})`)
    .all(...goals.map((g) => g.id)) as { id: number; weekdays: string; start_week: number; end_week: number }[];
  if (tacticRows.length === 0) return null;

  const tacticPlaceholders = tacticRows.map(() => '?').join(',');
  const tacticIds = tacticRows.map((t2) => t2.id);
  const completions = db
    .prepare(
      `SELECT tactic_id, week, weekday, done FROM completions
       WHERE tactic_id IN (${tacticPlaceholders}) AND week = ?`
    )
    .all(...tacticIds, cycle.current_week) as { tactic_id: number; week: number; weekday: number; done: number }[];
  const overrides = db
    .prepare(
      `SELECT tactic_id, week, weekdays FROM tactic_week_overrides
       WHERE tactic_id IN (${tacticPlaceholders}) AND week = ?`
    )
    .all(...tacticIds, cycle.current_week) as { tactic_id: number; week: number; weekdays: string }[];

  const tactics: TacticWithCompletions[] = tacticRows.map((row) => ({
    id: row.id,
    weekdays: JSON.parse(row.weekdays) as number[],
    startWeek: row.start_week,
    endWeek: row.end_week,
    overrides: overrides
      .filter((o) => o.tactic_id === row.id)
      .map((o) => ({ week: o.week, weekdays: JSON.parse(o.weekdays) as number[] })),
    completions: completions
      .filter((c) => c.tactic_id === row.id)
      .map((c) => ({ week: c.week, weekday: c.weekday, done: c.done === 1 })),
  }));

  const weekScore = computeWeekScores(tactics).find((w) => w.week === cycle.current_week);
  if (!weekScore || weekScore.score === null) return null;
  return { cycleWeek: cycle.current_week, score: weekScore.score };
}

export type ElectionOutcome =
  | { status: 'elected'; id: number; score: number; cycleWeek: number }
  /** Someone (either partner) already won this partnership's week. */
  | { status: 'already-won' }
  /** Below the threshold, no active cycle/plan, or nobody to tell. */
  | { status: 'not-eligible' };

/**
 * Runs the election for `userId` as of `now`: if they are at or above the threshold for their
 * current week and nobody in their partnership has won this week yet, inserts the winning row
 * and returns its id.
 *
 * Never throws for an expected outcome — a losing race surfaces as `'already-won'`, not an
 * exception. Any *other* SQLite error is still allowed to propagate, so a genuine bug is not
 * silently swallowed as "someone else was first".
 */
export function electFirstToMilestone(
  db: Database.Database,
  userId: number,
  now: Date = new Date(),
  pickVariant: VariantPicker = defaultVariantPicker
): ElectionOutcome {
  const partner = getAcceptedPartner(db, userId);
  // Solo users have nobody to tell. Skipping here (rather than writing an undeliverable row)
  // also means that if they pair up mid-week, the race for that week starts genuinely open.
  if (!partner) return { status: 'not-eligible' };

  const progress = currentWeekScore(db, userId);
  if (!progress || progress.score < MILESTONE_THRESHOLD) return { status: 'not-eligible' };

  const weekKey = israelWeekStart(now);
  const variant = Math.min(Math.max(Math.floor(pickVariant()), 0), PHRASE_VARIANT_COUNT - 1);

  try {
    const info = db
      .prepare(
        `INSERT INTO week_milestone_emails
           (partnership_id, achiever_id, recipient_id, week_key, cycle_week, score, phrase_variant, email_next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        partner.partnershipId,
        userId,
        partner.id,
        weekKey,
        progress.cycleWeek,
        progress.score,
        variant,
        now.toISOString()
      );
    return {
      status: 'elected',
      id: Number(info.lastInsertRowid),
      score: progress.score,
      cycleWeek: progress.cycleWeek,
    };
  } catch (err) {
    // The UNIQUE(partnership_id, week_key) index rejecting this insert is the *expected*
    // outcome for whoever crossed second — it is how the race is decided, not an error.
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      return { status: 'already-won' };
    }
    throw err;
  }
}

export function buildMilestoneEmail(
  appUrl: string,
  achieverLabel: string,
  cycleWeek: number,
  score: number,
  phraseVariant: number,
  locale: Locale = fallbackLocale()
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  // Clamped rather than trusted: a row written by an older/newer build (or hand-edited)
  // must never render a raw missing-key id into someone's inbox.
  const variant = Math.min(Math.max(phraseVariant, 0), PHRASE_VARIANT_COUNT - 1);
  const headline = tl(`emails.weekMilestone.line.${variant}`, { name: achieverLabel, score });

  return renderBrandedEmail(
    {
      subject: headline,
      eyebrow: tl('emails.weekMilestone.eyebrow'),
      title: headline,
      preheader: tl('emails.weekMilestone.preheader', { name: achieverLabel }),
      paragraphs: [
        tl('emails.weekMilestone.intro', { name: achieverLabel, week: cycleWeek, score }),
        tl('emails.weekMilestone.body', { target: TARGET_SCORE }),
      ],
      callout: {
        title: tl('emails.weekMilestone.calloutTitle'),
        text: tl('emails.weekMilestone.calloutText'),
      },
      cta: { label: tl('emails.cta.openApp'), url: appUrl },
      footer: tl('emails.weekMilestone.footer'),
    },
    locale
  );
}

function findDueMilestoneIds(db: Database.Database, nowIso: string, staleBeforeIso: string): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM week_milestone_emails
       WHERE email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))
       ORDER BY created_at ASC`
    )
    .all(nowIso, staleBeforeIso) as { id: number }[];
  return rows.map((r) => r.id);
}

/**
 * Atomically claims one milestone email for sending: a single compare-and-set UPDATE that
 * SQLite executes as one statement, shared by the immediate post-election attempt and the
 * periodic worker — which is what makes it impossible for the two to both send the same email
 * (whichever runs first wins; the other's UPDATE matches zero rows).
 */
export function claimMilestoneForSending(
  db: Database.Database,
  id: number,
  nowIso: string,
  staleBeforeIso: string
): WeekMilestoneRow | undefined {
  const info = db
    .prepare(
      `UPDATE week_milestone_emails
       SET email_status = 'sending', email_claimed_at = ?, email_attempt_count = email_attempt_count + 1
       WHERE id = ?
         AND email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))`
    )
    .run(nowIso, id, nowIso, staleBeforeIso);
  if (info.changes !== 1) return undefined;
  return db.prepare('SELECT * FROM week_milestone_emails WHERE id = ?').get(id) as WeekMilestoneRow;
}

function markSent(db: Database.Database, id: number, nowIso: string): void {
  db.prepare(
    `UPDATE week_milestone_emails
     SET email_status = 'sent', email_sent_at = ?, email_last_error = NULL, email_next_attempt_at = NULL
     WHERE id = ?`
  ).run(nowIso, id);
}

function markFailed(db: Database.Database, id: number, error: string, nextAttemptAt: string | null): void {
  db.prepare(
    `UPDATE week_milestone_emails SET email_status = 'failed', email_last_error = ?, email_next_attempt_at = ? WHERE id = ?`
  ).run(error, nextAttemptAt, id);
}

export type ClaimedMilestoneOutcome = { status: 'sent' } | { status: 'failed'; error: string };

/**
 * Processes exactly one already-claimed milestone email. Never throws — every failure mode is
 * caught and persisted, so one row can never abort a worker run.
 *
 * Honest **at-least-once** semantics, identical to BROOSTs and scheduled reminders: two
 * overlapping claims can never both send (see the atomic compare-and-swap above), but a crash
 * after the provider accepts the email and before 'sent' is persisted leaves the row claimed,
 * and once its lease goes stale a future run may resend it.
 *
 * Deliberately does **not** re-check that the two are still partners. Unlike a scheduled
 * reminder (which is a future intention that can become unwanted), this describes something
 * that already happened, and it is sent within seconds of happening.
 */
export async function processClaimedMilestone(
  db: Database.Database,
  claimed: WeekMilestoneRow,
  now: Date
): Promise<ClaimedMilestoneOutcome> {
  const nowIso = now.toISOString();
  let emailAcceptedByProvider = false;
  try {
    const recipient = db.prepare('SELECT id, email, locale FROM users WHERE id = ?').get(claimed.recipient_id) as
      | { id: number; email: string; locale: string | null }
      | undefined;
    const achiever = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(claimed.achiever_id) as
      | { id: number; email: string; display_name: string }
      | undefined;
    // Both are FK-referenced with ON DELETE CASCADE, so if either user were deleted this row
    // would already be gone too — this is only a defensive guard.
    if (!recipient || !achiever) {
      const error = 'recipient or achiever not found';
      markFailed(db, claimed.id, error, null);
      return { status: 'failed', error };
    }

    const { appUrl } = getEmailConfig();
    const achieverLabel = achiever.display_name?.trim() || achiever.email;
    const recipientLocale: Locale = recipient.locale === 'he' ? 'he' : 'en';
    const { subject, html, plainText, attachments } = buildMilestoneEmail(
      appUrl,
      achieverLabel,
      claimed.cycle_week,
      claimed.score,
      claimed.phrase_variant,
      recipientLocale
    );

    await sendEmail({ to: recipient.email, subject, html, plainText, attachments });
    emailAcceptedByProvider = true;
    markSent(db, claimed.id, nowIso);
    return { status: 'sent' };
  } catch (err) {
    const message = sanitizeError(err);
    if (emailAcceptedByProvider) {
      // eslint-disable-next-line no-console
      console.error(
        `[week-milestones] CRITICAL: milestone ${claimed.id} was accepted by the email provider ` +
          `but persisting its "sent" status failed — it may be re-sent on a future retry once ` +
          `its claim lease goes stale: ${message}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(`[week-milestones] send failed for milestone ${claimed.id}: ${message}`);
    }
    try {
      const nextAttemptAt =
        claimed.email_attempt_count >= MAX_ATTEMPTS
          ? null
          : new Date(now.getTime() + backoffMinutesForAttempt(claimed.email_attempt_count) * 60_000).toISOString();
      markFailed(db, claimed.id, message, nextAttemptAt);
    } catch (persistErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[week-milestones] additionally failed to persist failure state for milestone ${claimed.id}: ${sanitizeError(persistErr)}`
      );
    }
    return { status: 'failed', error: message };
  }
}

/** Attempts to send one just-elected milestone email right away. A no-op if the row is
 *  already claimed (a narrow race with the periodic worker) — that caller owns delivering it. */
export async function attemptImmediateMilestoneSend(
  db: Database.Database,
  id: number,
  now: Date = new Date()
): Promise<void> {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();
  const claimed = claimMilestoneForSending(db, id, nowIso, staleBeforeIso);
  if (!claimed) return;
  await processClaimedMilestone(db, claimed, now);
}

/**
 * Runs the election and, if this user just won the week, schedules the email to be sent
 * *after* the current response has already gone out (`setImmediate`) — a provider round trip
 * must never add latency to ticking a checkbox.
 *
 * Swallows everything on purpose: this is a congratulatory nice-to-have hanging off a
 * completion toggle, and no failure of it may ever turn a successful tick into an error
 * response or an unhandled rejection. Only numeric ids and sanitized messages are logged,
 * never an email address or any other PII.
 *
 * The per-minute worker (`runDueWeekMilestoneEmails`) remains the durable safety net for
 * anything this best-effort attempt does not resolve — including the process exiting between
 * the election and the callback firing, since the row is already committed by then.
 */
export function scheduleMilestoneCheck(db: Database.Database, userId: number, now: Date = new Date()): void {
  let outcome: ElectionOutcome;
  try {
    outcome = electFirstToMilestone(db, userId, now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[week-milestones] election failed for user ${userId}: ${sanitizeError(err)}`);
    return;
  }
  if (outcome.status !== 'elected') return;

  const { id } = outcome;
  setImmediate(() => {
    attemptImmediateMilestoneSend(db, id, now).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[week-milestones] unexpected error sending milestone ${id}: ${sanitizeError(err)}`);
    });
  });
}

export interface MilestoneDeliveryRunResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: { id: number; error: string }[];
}

/** Claims and delivers every currently-due milestone email (including recovering one
 *  abandoned by a crashed process past the stale-lease threshold). Invoked every minute by a
 *  systemd timer as a safety net for anything the immediate send did not already resolve. */
export async function runDueWeekMilestoneEmails(
  db: Database.Database,
  now: Date = new Date()
): Promise<MilestoneDeliveryRunResult> {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();

  const result: MilestoneDeliveryRunResult = { attempted: 0, sent: 0, failed: 0, skipped: 0, failures: [] };

  for (const id of findDueMilestoneIds(db, nowIso, staleBeforeIso)) {
    const claimed = claimMilestoneForSending(db, id, nowIso, staleBeforeIso);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    result.attempted += 1;
    const outcome = await processClaimedMilestone(db, claimed, now);
    if (outcome.status === 'sent') {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.failures.push({ id: claimed.id, error: outcome.error });
    }
  }

  return result;
}
