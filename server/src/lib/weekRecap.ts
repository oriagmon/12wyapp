/**
 * The end-of-week scoreboard email.
 *
 * Why this exists
 * ---------------
 * The weekly meeting is held on a Friday or Saturday morning, before the week has actually
 * finished. At that moment nobody has hit their target yet, so there is no satisfying
 * scoreboard to show and the celebration never lands. `lib/weekScoreFinalization.ts` fixed
 * the *recorded* score; this delivers the moment itself, at the only point where the numbers
 * are genuinely settled — once the week is over.
 *
 * Two clocks, and both matter
 * ---------------------------
 *   * The **calendar** week decides *when* to send. Israel-local Sunday..Saturday, matching
 *     the 0=Sunday..6=Saturday grid used by tactics and completions everywhere in this app.
 *     `week_key` is the Sunday of the week being recapped — the one that just ended.
 *   * The **cycle** week decides *what* to report. Cycles have no dates and `current_week` is
 *     advanced by hand, so a cycle week is finished only once its owner has moved past it.
 *     Only weeks strictly below `current_week` are reported; the week in progress never is.
 *
 * Keeping these separate is what makes the email honest. A calendar trigger alone would
 * report a week nobody had finished; a cycle trigger alone would never fire, because
 * advancing the week is a manual act that may not happen for days.
 *
 * Delivery is the same proven machinery as `lib/weekMilestones.ts` and `lib/broosts.ts`:
 * a UNIQUE constraint as the send-once guard, an atomic compare-and-swap claim, bounded
 * retries with backoff, and honest at-least-once semantics.
 */
import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { advanceDueCycleWeeks } from './cycleWeekAdvance.js';
import { sendEmail } from './emailSender.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { t, fallbackLocale, type Locale } from './i18n/index.js';
import { israelWeekStart, israelWeekday } from './israelTime.js';
import { computeCycleWeekScore } from './wam.js';
import { TARGET_SCORE } from './scoring.js';

/** How many rotating phrasings the headline picks from. */
export const PHRASE_VARIANT_COUNT = 10;
export const MAX_ATTEMPTS = 5;
const STALE_LEASE_MINUTES = 10;
const BACKOFF_MINUTES = [5, 15, 45, 135, 405];

export type RecapEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface WeekRecapRow {
  id: number;
  user_id: number;
  week_key: string;
  cycle_id: number | null;
  scores_json: string;
  average_score: number;
  latest_week: number;
  phrase_variant: number;
  created_at: string;
  email_status: RecapEmailStatus;
  email_attempt_count: number;
  email_last_error: string | null;
  email_next_attempt_at: string | null;
  email_claimed_at: string | null;
  email_sent_at: string | null;
}

export interface WeekScoreEntry {
  week: number;
  score: number;
}

export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}

function backoffMinutesForAttempt(attempt: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempt - 1, 0), BACKOFF_MINUTES.length - 1)];
}

export type VariantPicker = () => number;

const defaultVariantPicker: VariantPicker = () => Math.floor(Math.random() * PHRASE_VARIANT_COUNT);

/**
 * The Israel-local Sunday of the calendar week that has just ended, given a moment inside the
 * week that follows it. Seven days back from the current week's Sunday.
 */
export function previousWeekKey(now: Date): string {
  const currentStart = israelWeekStart(now);
  const [year, month, day] = currentStart.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 7));
  return previous.toISOString().slice(0, 10);
}

/**
 * Every *finished* cycle week for this user's active cycle, plus the rounded average.
 *
 * "Finished" means strictly below `current_week` — the week in progress is deliberately
 * excluded, since including a week that is one day old would drag the average down and make
 * the email read as a setback every single time it arrives.
 *
 * Weeks with nothing scheduled have no score at all (`computeWeekScores` returns null) and are
 * excluded from both the table and the average, exactly as every other average in this app
 * treats them.
 */
export function finishedWeekScores(
  db: Database.Database,
  userId: number
): { cycleId: number; scores: WeekScoreEntry[]; average: number } | null {
  const cycle = db
    .prepare('SELECT id, current_week FROM cycles WHERE user_id = ? AND is_active = 1')
    .get(userId) as { id: number; current_week: number } | undefined;
  if (!cycle) return null;

  const scores: WeekScoreEntry[] = [];
  for (let week = 1; week < cycle.current_week; week++) {
    const score = computeCycleWeekScore(db, cycle.id, week).score;
    if (score !== null) scores.push({ week, score });
  }
  if (scores.length === 0) return null;

  const average = Math.round(scores.reduce((sum, entry) => sum + entry.score, 0) / scores.length);
  return { cycleId: cycle.id, scores, average };
}

export type RecapOutcome =
  | { status: 'elected'; id: number }
  | { status: 'already-sent' }
  | { status: 'week-not-over' }
  | { status: 'nothing-to-report' };

/**
 * Creates this user's recap row for the calendar week that just closed, if there is one to
 * create.
 *
 * Only elects on Israel-local Sunday: that is the first day after a Sunday..Saturday week
 * ends, so the recap goes out as soon as the week is genuinely over. Restricting it to that
 * one weekday also means deploying mid-week never back-fires a recap for a week the user has
 * long since moved on from.
 *
 * The UNIQUE (user_id, week_key) constraint is the send-once guard, and it is used as a
 * *write*, not a read: a check-then-insert could let two overlapping worker runs both create
 * a row and send two recaps for the same week.
 */
export function electWeekRecap(
  db: Database.Database,
  userId: number,
  now: Date = new Date(),
  pickVariant: VariantPicker = defaultVariantPicker
): RecapOutcome {
  if (israelWeekday(now) !== 0) return { status: 'week-not-over' };

  const finished = finishedWeekScores(db, userId);
  if (!finished) return { status: 'nothing-to-report' };

  const weekKey = previousWeekKey(now);
  const latestWeek = finished.scores[finished.scores.length - 1].week;
  const nextAttemptAt = now.toISOString();

  try {
    const info = db
      .prepare(
        `INSERT INTO week_recap_emails
           (user_id, week_key, cycle_id, scores_json, average_score, latest_week, phrase_variant, email_next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        weekKey,
        finished.cycleId,
        JSON.stringify(finished.scores),
        finished.average,
        latestWeek,
        pickVariant(),
        nextAttemptAt
      );
    return { status: 'elected', id: Number(info.lastInsertRowid) };
  } catch (err) {
    // Only the send-once collision is an expected outcome. Anything else is a real fault and
    // must surface rather than being quietly reported as "already sent".
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      return { status: 'already-sent' };
    }
    throw err;
  }
}

export function parseScores(scoresJson: string): WeekScoreEntry[] {
  try {
    const parsed = JSON.parse(scoresJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WeekScoreEntry =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as WeekScoreEntry).week === 'number' &&
        typeof (entry as WeekScoreEntry).score === 'number'
    );
  } catch {
    return [];
  }
}

export function buildRecapEmail(
  appUrl: string,
  displayLabel: string,
  scores: WeekScoreEntry[],
  average: number,
  latestWeek: number,
  phraseVariant: number,
  locale: Locale = fallbackLocale()
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  // Clamped rather than trusted: a row written by an older or newer build must never render a
  // raw missing-key id into someone's inbox.
  const variant = Math.min(Math.max(phraseVariant, 0), PHRASE_VARIANT_COUNT - 1);
  const headline = tl(`emails.weekRecap.line.${variant}`, { name: displayLabel, average });
  const latestScore = scores.find((entry) => entry.week === latestWeek)?.score ?? average;
  const onTrack = average >= TARGET_SCORE;

  return renderBrandedEmail(
    {
      subject: headline,
      eyebrow: tl('emails.weekRecap.eyebrow'),
      title: headline,
      preheader: tl('emails.weekRecap.preheader', { average }),
      paragraphs: [tl('emails.weekRecap.intro', { week: latestWeek, score: latestScore })],
      table: {
        caption: tl('emails.weekRecap.tableCaption'),
        rows: [
          ...scores.map((entry) => ({
            label: tl('emails.weekRecap.weekLabel', { week: entry.week }),
            value: `${entry.score}%`,
          })),
          { label: tl('emails.weekRecap.averageLabel'), value: `${average}%` },
        ],
        // The average is the point of the email, so it is the row that gets the emphasis.
        highlightRow: scores.length,
      },
      callout: {
        title: onTrack ? tl('emails.weekRecap.onTrackTitle') : tl('emails.weekRecap.offTrackTitle'),
        text: onTrack
          ? tl('emails.weekRecap.onTrackText', { target: TARGET_SCORE })
          : tl('emails.weekRecap.offTrackText', { target: TARGET_SCORE }),
      },
      cta: { label: tl('emails.cta.openApp'), url: appUrl },
      footer: tl('emails.weekRecap.footer'),
    },
    locale
  );
}

function findDueRecapIds(db: Database.Database, nowIso: string, staleBeforeIso: string): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM week_recap_emails
       WHERE email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))
       ORDER BY created_at ASC`
    )
    .all(nowIso, staleBeforeIso) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Atomically claims one recap for sending — a single compare-and-set UPDATE, so two
 *  overlapping runs can never both send the same email (the loser's UPDATE matches no rows). */
export function claimRecapForSending(
  db: Database.Database,
  id: number,
  nowIso: string,
  staleBeforeIso: string
): WeekRecapRow | undefined {
  const info = db
    .prepare(
      `UPDATE week_recap_emails
       SET email_status = 'sending', email_claimed_at = ?, email_attempt_count = email_attempt_count + 1
       WHERE id = ?
         AND email_next_attempt_at IS NOT NULL AND email_next_attempt_at <= ?
         AND (email_status IN ('pending', 'failed') OR (email_status = 'sending' AND email_claimed_at <= ?))`
    )
    .run(nowIso, id, nowIso, staleBeforeIso);
  if (info.changes !== 1) return undefined;
  return db.prepare('SELECT * FROM week_recap_emails WHERE id = ?').get(id) as WeekRecapRow;
}

function markSent(db: Database.Database, id: number, nowIso: string): void {
  db.prepare(
    `UPDATE week_recap_emails
     SET email_status = 'sent', email_sent_at = ?, email_last_error = NULL, email_next_attempt_at = NULL
     WHERE id = ?`
  ).run(nowIso, id);
}

function markFailed(db: Database.Database, id: number, error: string, nextAttemptAt: string | null): void {
  db.prepare(
    `UPDATE week_recap_emails SET email_status = 'failed', email_last_error = ?, email_next_attempt_at = ? WHERE id = ?`
  ).run(error, nextAttemptAt, id);
}

export type ClaimedRecapOutcome = { status: 'sent' } | { status: 'failed'; error: string };

/**
 * Processes exactly one already-claimed recap. Never throws — every failure is caught and
 * persisted, so a single bad row can never abort a worker run.
 *
 * The scoreboard is read from the frozen `scores_json` rather than recomputed, so a retry
 * always sends the same numbers the row was created to report.
 */
export async function processClaimedRecap(
  db: Database.Database,
  claimed: WeekRecapRow,
  now: Date
): Promise<ClaimedRecapOutcome> {
  const nowIso = now.toISOString();
  let emailAcceptedByProvider = false;
  try {
    const user = db.prepare('SELECT id, email, display_name, locale FROM users WHERE id = ?').get(claimed.user_id) as
      | { id: number; email: string; display_name: string; locale: string | null }
      | undefined;
    // FK is ON DELETE CASCADE, so a deleted user would have taken this row with them — this is
    // only a defensive guard.
    if (!user) {
      const error = 'recap recipient not found';
      markFailed(db, claimed.id, error, null);
      return { status: 'failed', error };
    }

    const scores = parseScores(claimed.scores_json);
    if (scores.length === 0) {
      // Nothing to show; retrying cannot make a corrupt/empty scoreboard meaningful.
      const error = 'recap has no scores to report';
      markFailed(db, claimed.id, error, null);
      return { status: 'failed', error };
    }

    const { appUrl } = getEmailConfig();
    const label = user.display_name?.trim() || user.email;
    const locale: Locale = user.locale === 'he' ? 'he' : 'en';
    const { subject, html, plainText, attachments } = buildRecapEmail(
      appUrl,
      label,
      scores,
      claimed.average_score,
      claimed.latest_week,
      claimed.phrase_variant,
      locale
    );

    await sendEmail({ to: user.email, subject, html, plainText, attachments });
    emailAcceptedByProvider = true;
    markSent(db, claimed.id, nowIso);
    return { status: 'sent' };
  } catch (err) {
    const message = sanitizeError(err);
    if (emailAcceptedByProvider) {
      // eslint-disable-next-line no-console
      console.error(
        `[week-recap] CRITICAL: recap ${claimed.id} was accepted by the email provider but ` +
          `persisting its "sent" status failed — it may be re-sent on a future retry once its ` +
          `claim lease goes stale: ${message}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(`[week-recap] send failed for recap ${claimed.id}: ${message}`);
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
        `[week-recap] additionally failed to persist failure state for recap ${claimed.id}: ${sanitizeError(persistErr)}`
      );
    }
    return { status: 'failed', error: message };
  }
}

export interface RecapRunResult {
  elected: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: { id: number; error: string }[];
}

/**
 * One worker pass: elect a recap for anyone whose calendar week just closed, then claim and
 * deliver everything currently due (including a row abandoned by a crashed process past the
 * stale-lease threshold).
 *
 * Election is attempted for every user with an active cycle, which is cheap and keeps the
 * decision in one place — `electWeekRecap` itself is responsible for every "no" answer.
 * An election failure for one user is logged and never stops the others.
 */
export async function runDueWeekRecapEmails(
  db: Database.Database,
  now: Date = new Date()
): Promise<RecapRunResult> {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_LEASE_MINUTES * 60_000).toISOString();
  const result: RecapRunResult = { elected: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, failures: [] };

  // The clock has to be wound before it is read. Election reports the weeks *below*
  // `current_week`, and the week that just closed only drops below it once the cycle
  // advances — so if the recap ran first on Sunday morning it would silently omit the very
  // week it is meant to be recapping. Advancing here (rather than relying on the separate
  // auto-advance timer having already fired this minute) makes that ordering a property of
  // the code instead of a race between two independent systemd units. It is idempotent, so
  // the duplicated work when both do run is a no-op.
  try {
    advanceDueCycleWeeks(db, now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[week-recap] cycle week advance failed: ${sanitizeError(err)}`);
  }

  const userIds = (
    db.prepare('SELECT DISTINCT user_id FROM cycles WHERE is_active = 1 ORDER BY user_id').all() as {
      user_id: number;
    }[]
  ).map((row) => row.user_id);

  for (const userId of userIds) {
    try {
      if (electWeekRecap(db, userId, now).status === 'elected') result.elected += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[week-recap] election failed for user ${userId}: ${sanitizeError(err)}`);
    }
  }

  for (const id of findDueRecapIds(db, nowIso, staleBeforeIso)) {
    const claimed = claimRecapForSending(db, id, nowIso, staleBeforeIso);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    result.attempted += 1;
    const outcome = await processClaimedRecap(db, claimed, now);
    if (outcome.status === 'sent') {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.failures.push({ id: claimed.id, error: outcome.error });
    }
  }

  return result;
}
