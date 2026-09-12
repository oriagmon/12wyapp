import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { runDueWeekMilestoneEmails } from './lib/weekMilestones.js';

/**
 * Standalone CLI: claims and sends every currently-due "first to 50% this week" email.
 * Intended to be invoked by a systemd timer every minute (see
 * deploy/12-week-dashboard-week-milestones.timer.sample):
 *
 *   node dist/sendWeekMilestoneEmails.js
 *
 * This is a safety-net catch-all — most of these are already sent immediately after the
 * completion toggle that triggered them (see lib/weekMilestones.ts's scheduleMilestoneCheck)
 * — for anything that wasn't: a transient provider failure now due for its backoff retry, or
 * a process that died between electing a winner and sending their email. Safe against
 * overlapping invocations (atomic per-row claim, shared with the immediate-send path) and
 * against a worker that crashed mid-send (a stale `sending` lease becomes claimable again
 * after 10 minutes).
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await runDueWeekMilestoneEmails(db);
  console.log(
    `[week-milestones] attempted=${result.attempted} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`
  );
  closeDb();
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('[week-milestones] fatal error', err);
    process.exit(1);
  });
}
