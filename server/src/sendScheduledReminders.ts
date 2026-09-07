import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { runDueScheduledReminders } from './lib/scheduledReminders.js';

/**
 * Standalone CLI: claims and sends every currently-due scheduled one-time email reminder.
 * Intended to be invoked by a systemd timer every minute (see
 * deploy/12-week-dashboard-scheduled-reminders.timer.sample):
 *
 *   node dist/sendScheduledReminders.js
 *
 * Safe against overlapping invocations (see lib/scheduledReminders.ts's atomic per-row
 * claim) and against a worker that crashed mid-send (a stale `sending` lease becomes
 * claimable again after 10 minutes). Every due reminder is attempted independently; if any
 * send fails, the process still attempts every other due reminder before exiting non-zero so
 * the timer's next run retries only the failures that are still due (per their own
 * backoff/next_attempt_at).
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await runDueScheduledReminders(db);
  console.log(
    `[scheduled-reminders] attempted=${result.attempted} sent=${result.sent} ` +
      `failed=${result.failed} skipped=${result.skipped}`
  );
  closeDb();
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    // Anything caught here is a setup/infra failure outside individual per-reminder sends
    // (e.g. missing env vars, DB unavailable) — never a masked "false success": it always
    // exits non-zero.
    console.error('[scheduled-reminders] fatal error', err);
    process.exit(1);
  });
}
