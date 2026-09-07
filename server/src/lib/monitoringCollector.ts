import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { BACKUP_RECEIPT_FILENAME, readBoundedFile } from './monitoringFiles.js';
import { operationalProbeSchema } from './monitoringProbe.js';
import { BACKUP_TIMER_UNITS, TIMER_UNITS, type BackupTimerSelection, type OperationalProbe, type TimerId, type TimerObservation, type TimerUnit } from './monitoringTypes.js';
import { CLOUD_RECEIPT_FILENAME, MAX_ARCHIVE_BYTES } from './cloudBackupConfig.js';

export const MAX_CERT_BYTES = 64 * 1024;
export const MAX_SYSTEMCTL_BYTES = 4096;
const allowedTimerUnits: readonly TimerUnit[] = [...Object.values(TIMER_UNITS), BACKUP_TIMER_UNITS['standalone-blob']];
export interface CollectorOptions {
  stateDirectory: string;
  timers: TimerId[];
  certificateFile?: string;
  fileBackupEnabled: boolean;
  cloudBackupEnabled?: boolean;
  backupTimer?: BackupTimerSelection;
}
export interface CollectorProviders {
  now: () => Date;
  readFile: (filename: string, limit: number) => Promise<Buffer>;
  systemctl: (unit: TimerUnit) => Promise<string>;
}

export function parseTimerSelection(value: string | undefined): TimerId[] {
  if (!value?.trim()) return [];
  const ids = value.split(',').map((id) => id.trim());
  if (ids.length > Object.keys(TIMER_UNITS).length || new Set(ids).size !== ids.length
    || ids.some((id) => !Object.prototype.hasOwnProperty.call(TIMER_UNITS, id))) throw new Error('invalid_timer_configuration');
  return ids as TimerId[];
}

export function parseBackupTimerSelection(value: string | undefined): BackupTimerSelection {
  if (value === undefined) return 'standard';
  const selection = value.trim();
  if (selection !== 'standard' && selection !== 'standalone-blob') throw new Error('invalid_backup_timer_configuration');
  return selection;
}

export function localSystemctl(unit: TimerUnit): Promise<string> {
  if (!allowedTimerUnits.includes(unit)) return Promise.reject(new Error('invalid_timer'));
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/systemctl', ['show', '--no-pager', '--property=LoadState,ActiveState,NextElapseUSecRealtime', '--', unit], {
      encoding: 'utf8', timeout: 3000, maxBuffer: MAX_SYSTEMCTL_BYTES, windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', SYSTEMD_PAGER: '' },
    }, (error, stdout) => error ? reject(new Error('timer_unavailable')) : resolve(stdout));
  });
}

export const defaultCollectorProviders: CollectorProviders = {
  now: () => new Date(), readFile: readBoundedFile, systemctl: localSystemctl,
};

export function parseSystemctlTimer(id: TimerId, output: string): TimerObservation {
  const unknown: TimerObservation = { id, state: 'unknown', nextRunAt: null };
  if (Buffer.byteLength(output) > MAX_SYSTEMCTL_BYTES) return unknown;
  const properties = new Map<string, string>();
  for (const line of output.trim().split('\n')) {
    const match = /^(LoadState|ActiveState|NextElapseUSecRealtime)=([^\r\n]*)$/.exec(line);
    if (!match || properties.has(match[1])) return unknown;
    properties.set(match[1], match[2]);
  }
  if (properties.size !== 3 || properties.get('LoadState') !== 'loaded') return unknown;
  const activeState = properties.get('ActiveState');
  if (activeState !== 'active' && activeState !== 'inactive' && activeState !== 'failed') return unknown;
  if (activeState !== 'active') return { id, state: activeState, nextRunAt: null };
  const rawTime = properties.get('NextElapseUSecRealtime') ?? '';
  if (rawTime === '' || rawTime === 'n/a') return { id, state: 'active', nextRunAt: null };
  const match = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(rawTime);
  if (!match) return unknown;
  const candidate = `${match[1]}T${match[2]}.000Z`;
  if (!Number.isFinite(Date.parse(candidate)) || new Date(candidate).toISOString() !== candidate) return unknown;
  return { id, state: 'active', nextRunAt: candidate };
}

export function parseLocalCertificate(bytes: Buffer): OperationalProbe['certificate'] {
  if (bytes.length > MAX_CERT_BYTES) return { state: 'unknown', validFrom: null, validTo: null };
  try {
    const certificate = new X509Certificate(bytes);
    const validFrom = new Date(certificate.validFrom).toISOString();
    const validTo = new Date(certificate.validTo).toISOString();
    if (validFrom >= validTo) throw new Error('invalid_validity');
    return { state: 'observed', validFrom, validTo };
  } catch {
    return { state: 'unknown', validFrom: null, validTo: null };
  }
}

export async function collectOperationalProbe(options: CollectorOptions, providers: CollectorProviders = defaultCollectorProviders): Promise<OperationalProbe> {
  // Revalidate at the boundary even for typed callers; a unit string never comes from a request.
  const selected = new Set(parseTimerSelection(options.timers.join(',')));
  const backupTimer = parseBackupTimerSelection(options.backupTimer);
  const timers: TimerObservation[] = [];
  for (const id of Object.keys(TIMER_UNITS) as TimerId[]) {
    if (!selected.has(id)) {
      timers.push({ id, state: 'not_configured', nextRunAt: null });
      continue;
    }
    try {
      const unit = id === 'backup' ? BACKUP_TIMER_UNITS[backupTimer] : TIMER_UNITS[id];
      timers.push(parseSystemctlTimer(id, await providers.systemctl(unit)));
    } catch {
      timers.push({ id, state: 'unknown', nextRunAt: null });
    }
  }
  let certificate: OperationalProbe['certificate'] = { state: 'not_configured', validFrom: null, validTo: null };
  if (options.certificateFile) {
    try { certificate = parseLocalCertificate(await providers.readFile(options.certificateFile, MAX_CERT_BYTES)); }
    catch { certificate = { state: 'unknown', validFrom: null, validTo: null }; }
  }
  let fileBackup: OperationalProbe['fileBackup'] = { state: options.fileBackupEnabled ? 'unknown' : 'not_configured', lastSuccessAt: null };
  if (options.fileBackupEnabled) {
    try {
      const bytes = await providers.readFile(path.join(options.stateDirectory, BACKUP_RECEIPT_FILENAME), 1024);
      if (bytes.length > 1024) throw new Error('oversized_receipt');
      const receipt: unknown = JSON.parse(bytes.toString('utf8'));
      if (typeof receipt !== 'object' || receipt === null || Object.keys(receipt).sort().join(',') !== 'completedAt,version') throw new Error('invalid_receipt');
      const { completedAt, version } = receipt as { completedAt: unknown; version: unknown };
      if (version !== 1 || typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))
        || new Date(completedAt).toISOString() !== completedAt || Date.parse(completedAt) > providers.now().getTime()) throw new Error('invalid_receipt');
      fileBackup = { state: 'observed', lastSuccessAt: completedAt };
    } catch {
      // A missing, future-dated or invalid receipt is not proof of a completed backup.
    }
  }
  let cloudBackup: OperationalProbe['cloudBackup'] = {
    state: options.cloudBackupEnabled ? 'unknown' : 'not_configured', lastSuccessAt: null, archiveBytes: null,
  };
  if (options.cloudBackupEnabled) {
    try {
      const bytes = await providers.readFile(path.join(options.stateDirectory, CLOUD_RECEIPT_FILENAME), 1024);
      if (bytes.length > 1024) throw new Error('oversized_receipt');
      const receipt: unknown = JSON.parse(bytes.toString('utf8'));
      if (typeof receipt !== 'object' || receipt === null || Object.keys(receipt).sort().join(',') !== 'archiveBytes,completedAt,version') throw new Error('invalid_receipt');
      const { completedAt, archiveBytes, version } = receipt as { completedAt: unknown; archiveBytes: unknown; version: unknown };
      if (version !== 1 || typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))
        || new Date(completedAt).toISOString() !== completedAt || Date.parse(completedAt) > providers.now().getTime()
        || typeof archiveBytes !== 'number' || !Number.isSafeInteger(archiveBytes) || archiveBytes < 1 || archiveBytes > MAX_ARCHIVE_BYTES) throw new Error('invalid_receipt');
      cloudBackup = { state: 'observed', lastSuccessAt: completedAt, archiveBytes };
    } catch { /* Only a valid local attestation proves a confirmed cloud upload. */ }
  }
  return operationalProbeSchema.parse({ version: 1, sampledAt: providers.now().toISOString(), timers, certificate, fileBackup, cloudBackup });
}
