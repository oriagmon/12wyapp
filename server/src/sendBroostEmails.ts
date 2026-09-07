import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { runDueBroostEmails } from './lib/broosts.js';

/**
 * Standalone CLI: claims and sends every currently-due BROOST email. Intended to be invoked
 * by a systemd timer every minute (see deploy/12-week-dashboard-broost-emails.timer.sample):
 *
 *   node dist/sendBroostEmails.js
 *
 * This is a safety-net catch-all — most BROOSTs are already sent immediately after creation
 * (see routes/broosts.ts) — for anything that wasn't (a transient failure now due for its
 * backoff retry, or a process that was down when a BROOST was first created). Safe against
 * overlapping invocations (see lib/broosts.ts's atomic per-row claim, shared with the
 * immediate-send path) and against a worker that crashed mid-send (a stale `sending` lease
 * becomes claimable again after 10 minutes).
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await runDueBroostEmails(db);
  console.log(
    `[broosts] attempted=${result.attempted} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`
  );
  closeDb();
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('[broosts] fatal error', err);
    process.exit(1);
  });
}
