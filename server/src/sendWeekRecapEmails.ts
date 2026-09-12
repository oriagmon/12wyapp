import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { runDueWeekRecapEmails } from './lib/weekRecap.js';

/**
 * Standalone CLI: elects and sends the end-of-week scoreboard recap.
 * Intended to be invoked by a systemd timer every minute (see
 * deploy/12-week-dashboard-week-recap.timer.sample):
 *
 *   node dist/sendWeekRecapEmails.js
 *
 * Unlike the other email workers there is no in-request path that normally sends these — the
 * whole point is that the recap goes out once the calendar week has ended, which is not
 * something any user action coincides with. `runDueWeekRecapEmails` therefore both elects and
 * delivers, and `electWeekRecap` owns every "not yet" decision: it only elects on an
 * Israel-local Sunday, and the UNIQUE (user_id, week_key) constraint means running every
 * minute still produces exactly one recap per person per week.
 *
 * Safe against overlapping invocations (atomic per-row claim) and against a worker that
 * crashed mid-send (a stale `sending` lease becomes claimable again after 10 minutes).
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await runDueWeekRecapEmails(db);
  console.log(
    `[week-recap] elected=${result.elected} attempted=${result.attempted} sent=${result.sent} ` +
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
    console.error('[week-recap] fatal error', err);
    process.exit(1);
  });
}
