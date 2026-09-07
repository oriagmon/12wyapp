import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { deleteOrphanedEvidenceFiles, findOrphanedEvidenceFiles } from './lib/tacticEvidence.js';

/**
 * Standalone maintenance CLI: reports (and, only with `--delete`, removes) on-disk evidence
 * files under `EVIDENCE_DIR` that are no longer referenced by any `tactic_evidence` row —
 * e.g. left behind by a hypothetical future user/cycle-deletion code path that only issues
 * raw SQL (see the module doc comment in lib/tacticEvidence.ts; there is no such app route
 * today, since the normal goal/tactic DELETE routes already clean up their own evidence
 * files).
 *
 *   node dist/evidenceMaintenance.js            # report only, deletes nothing
 *   node dist/evidenceMaintenance.js --delete   # also deletes every reported orphan
 *
 * **Run this with the application server stopped.** A live server can legitimately have a
 * brand-new file already written to disk whose `tactic_evidence` row hasn't committed yet at
 * the exact instant this scan runs (see `upsertEvidenceFileRecord`'s own doc comment for why
 * the file write and the DB write are never perfectly simultaneous) — such a file would be a
 * false-positive "orphan" while the server is running, but never while it's stopped. This is
 * deliberately never invoked automatically (not at server startup, not on any request path) —
 * only ever as an explicit, manually-run maintenance operation.
 *
 * Only ever considers a generated-name (48 lowercase hex characters + a known extension)
 * regular file a candidate; a symlink or any unrecognized filename is reported separately and
 * never touched, even with `--delete` (see `findOrphanedEvidenceFiles`'s own doc comment).
 */
async function main(): Promise<void> {
  const shouldDelete = process.argv.includes('--delete');
  const db = getDb();
  const result = findOrphanedEvidenceFiles(db);

  // eslint-disable-next-line no-console
  console.log(
    `[evidenceMaintenance] scanned=${result.scannedCount} orphaned=${result.orphanedFilenames.length} skipped=${result.skippedEntries.length}`
  );
  if (result.skippedEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[evidenceMaintenance] skipped entries (never touched): ${result.skippedEntries.join(', ')}`);
  }
  if (result.orphanedFilenames.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[evidenceMaintenance] no orphaned files found — nothing to do.');
    closeDb();
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[evidenceMaintenance] orphaned filenames:\n  ${result.orphanedFilenames.join('\n  ')}`);

  if (!shouldDelete) {
    // eslint-disable-next-line no-console
    console.log('[evidenceMaintenance] report-only run (pass --delete to remove the files listed above).');
    closeDb();
    return;
  }

  const deleted = await deleteOrphanedEvidenceFiles(result.orphanedFilenames);
  // eslint-disable-next-line no-console
  console.log(`[evidenceMaintenance] deleted ${deleted.length} orphaned file(s).`);
  closeDb();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('[evidenceMaintenance] fatal error', err);
    process.exit(1);
  });
}
