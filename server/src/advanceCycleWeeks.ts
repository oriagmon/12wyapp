import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { advanceDueCycleWeeks } from './lib/cycleWeekAdvance.js';

/**
 * Standalone CLI: rolls every active cycle onto the week the calendar says it is in.
 * Intended to be invoked by a systemd timer every minute (see
 * deploy/12-week-dashboard-cycle-week-advance.timer.sample):
 *
 *   node dist/advanceCycleWeeks.js
 *
 * Runs every minute rather than once a week on purpose, matching the other workers here: a
 * weekly `OnCalendar` would silently skip the rollover entirely if the VM happened to be
 * rebooting or suspended at that exact minute, and there would be no second chance for
 * seven days. Because the week is *recomputed* from `cycles.started_on` rather than
 * incremented, a per-minute schedule is free — every run after the first in a given week
 * finds nothing to do and exits.
 *
 * The recap worker also calls `advanceDueCycleWeeks` before electing, so the two are
 * deliberately redundant; this timer exists so the clock keeps moving even if recap email
 * delivery is disabled or failing.
 */
async function main(): Promise<void> {
  const db = getDb();
  const advances = advanceDueCycleWeeks(db);
  for (const advance of advances) {
    console.log(
      `[cycle-week] cycle ${advance.cycleId} (user ${advance.userId}) week ` +
        `${advance.previousWeek} -> ${advance.newWeek} (anchored ${advance.startedOn})` +
        (advance.finalizedScores.length > 0 ? `, finalized ${advance.finalizedScores.length} score(s)` : '')
    );
  }
  console.log(`[cycle-week] advanced=${advances.length}`);
  closeDb();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('[cycle-week] fatal error', err);
    process.exit(1);
  });
}
