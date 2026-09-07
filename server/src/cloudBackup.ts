import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudBackupConfig, CloudBackupError, CLOUD_BACKUP_TIMEOUT_MS, CLOUD_RECEIPT_FILENAME } from './lib/cloudBackupConfig.js';
import { createSnapshotArchive, validateCompletedSnapshot } from './lib/cloudBackupSnapshot.js';
import { uploadSnapshotArchive } from './lib/cloudBackup.js';
import { writeAtomicJson } from './lib/monitoringFiles.js';

export async function runCloudBackup(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (args.length !== 2 || args[0] !== '--upload-complete-snapshot' || !path.isAbsolute(args[1])
    || !env.AZURE_BACKUP_SOURCE_ROOT || !path.isAbsolute(env.AZURE_BACKUP_SOURCE_ROOT)
    || !env.MONITORING_STATE_DIR || !path.isAbsolute(env.MONITORING_STATE_DIR)) throw new CloudBackupError('configuration_invalid');
  const config = cloudBackupConfig(env);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLOUD_BACKUP_TIMEOUT_MS);
  timer.unref();
  try {
    const snapshot = await validateCompletedSnapshot(args[1], env.AZURE_BACKUP_SOURCE_ROOT);
    if (abort.signal.aborted) throw new CloudBackupError('timeout');
    const archive = createSnapshotArchive(snapshot, abort.signal);
    const receipt = await uploadSnapshotArchive(config, archive, abort.signal);
    await writeAtomicJson(env.MONITORING_STATE_DIR, CLOUD_RECEIPT_FILENAME, { version: 1, ...receipt });
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCloudBackup(process.argv.slice(2), process.env).then(() => {
    console.log('Cloud backup upload confirmed; separate cloud receipt published.');
  }).catch((error: unknown) => {
    console.error(`Cloud backup failed (${error instanceof CloudBackupError ? error.code : 'local_receipt_unavailable'}); success was not attested.`);
    process.exitCode = 1;
  });
}
