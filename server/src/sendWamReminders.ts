import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { sendWeeklyWamReminders } from './lib/wamReminders.js';

/**
 * Standalone CLI: sends the weekly "did you schedule your WAM?" reminder email to both
 * members of every active direct partnership. Intended to be invoked by a systemd timer
 * every Tuesday at 10:00 Asia/Jerusalem (see deploy/12-week-dashboard-wam-reminders.timer.sample):
 *
 *   node dist/sendWamReminders.js
 *
 * Idempotent per ISO week + recipient (see migration 007 and lib/wamReminders.ts), so a
 * retried/duplicate run never re-sends an email that already succeeded this week. Every
 * recipient is attempted independently; if any send fails, the process still attempts all
 * remaining recipients before exiting non-zero so the timer's next run retries only the
 * failures.
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await sendWeeklyWamReminders(db);
  console.log(
    `[wam-reminders] week=${result.isoWeek} attempted=${result.attempted} sent=${result.sent} ` +
      `skipped=${result.skipped} failed=${result.failed}`
  );
  closeDb();
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    // Anything caught here is a setup/infra failure outside individual per-recipient sends
    // (e.g. missing env vars, DB unavailable) — never a masked "false success": it always
    // exits non-zero.
    console.error('[wam-reminders] fatal error', err);
    process.exit(1);
  });
}
