import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { collectOperationalProbe, parseBackupTimerSelection, parseTimerSelection } from './lib/monitoringCollector.js';
import { BACKUP_RECEIPT_FILENAME, PROBE_FILENAME, writeAtomicJson } from './lib/monitoringFiles.js';

export async function runMonitoringProbe(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--record-file-backup-success')) throw new Error('invalid_arguments');
  const stateDirectory = env.MONITORING_STATE_DIR?.trim();
  if (!stateDirectory || !path.isAbsolute(stateDirectory)) throw new Error('state_directory_required');
  if (args[0] === '--record-file-backup-success') {
    if (env.MONITORING_FILE_BACKUP_ENABLED !== 'true') throw new Error('file_backup_not_configured');
    await writeAtomicJson(stateDirectory, BACKUP_RECEIPT_FILENAME, { version: 1, completedAt: new Date().toISOString() });
    return;
  }
  const probe = await collectOperationalProbe({
    stateDirectory,
    timers: parseTimerSelection(env.MONITORING_TIMERS),
    backupTimer: parseBackupTimerSelection(env.MONITORING_BACKUP_TIMER),
    certificateFile: env.MONITORING_CERT_FILE?.trim() || undefined,
    fileBackupEnabled: env.MONITORING_FILE_BACKUP_ENABLED === 'true',
    cloudBackupEnabled: env.MONITORING_CLOUD_BACKUP_ENABLED === 'true',
  });
  await writeAtomicJson(stateDirectory, PROBE_FILENAME, probe);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMonitoringProbe(process.argv.slice(2), process.env).catch(() => {
    // Operator output is intentionally bounded too: no certificate paths or subprocess stderr.
    console.error('Monitoring probe failed; check local configuration and permissions.');
    process.exitCode = 1;
  });
}
