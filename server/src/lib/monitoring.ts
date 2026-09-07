import { lstat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { readOperationalProbe } from './monitoringProbe.js';
import { TIMER_UNITS, type DeliveryCounts, type MonitoringSnapshot, type MonitoringStatus, type ProbeReading } from './monitoringTypes.js';

export interface MonitoringDependencies {
  db: () => Database.Database;
  now: () => Date;
  uptime: () => number;
  statFile: (filename: string) => Promise<{ size: number; isFile(): boolean }>;
  readProbe: (now: Date) => Promise<ProbeReading>;
  probeStaleAfterSeconds: number;
  backupStaleAfterSeconds: number;
}
export const defaultStatFile: MonitoringDependencies['statFile'] = lstat;

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('invalid_aggregate');
  return value as number;
}

function safeTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error('invalid_timestamp');
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('invalid_timestamp');
  return value;
}

const CHANNELS = [
  { id: 'weekly', table: 'wam_email_reminders', column: 'status' },
  { id: 'reminders', table: 'scheduled_email_reminders', column: 'status' },
  { id: 'broost', table: 'partner_broosts', column: 'email_status' },
  { id: 'calendar', table: 'wam_calendar_invitations', column: 'status' },
] as const;

function deliveryCounts(db: Database.Database, channel: typeof CHANNELS[number]): DeliveryCounts {
  // Identifiers come only from the static list above. No per-user fields are ever selected.
  const row = db.prepare(`SELECT
    COALESCE(SUM(${channel.column} = 'sent'), 0) AS sent,
    COALESCE(SUM(${channel.column} = 'failed'), 0) AS failed,
    COALESCE(SUM(${channel.column} = 'pending'), 0) AS pending,
    COALESCE(SUM(${channel.column} = 'sending'), 0) AS sending,
    COALESCE(SUM(${channel.column} = 'cancelled'), 0) AS cancelled
    FROM ${channel.table}`).get() as DeliveryCounts;
  return {
    sent: safeCount(row.sent), failed: safeCount(row.failed), pending: safeCount(row.pending),
    sending: safeCount(row.sending), cancelled: safeCount(row.cancelled),
  };
}

function worst(statuses: MonitoringStatus[]): MonitoringStatus {
  return statuses.includes('error') ? 'error' : statuses.includes('warn') ? 'warn' : statuses.includes('unknown') ? 'unknown' : 'good';
}

export function certificateStatus(validFrom: string, validTo: string, now: Date): MonitoringStatus {
  const starts = Date.parse(validFrom);
  const ends = Date.parse(validTo);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts >= ends) return 'unknown';
  if (now.getTime() < starts || now.getTime() >= ends) return 'error';
  return ends - now.getTime() <= 30 * 86_400_000 ? 'warn' : 'good';
}

export async function getMonitoringSnapshot(deps: MonitoringDependencies): Promise<MonitoringSnapshot> {
  const now = deps.now();
  const uptimeSeconds = Math.max(0, Math.floor(deps.uptime()));
  const result: MonitoringSnapshot = {
    version: 1,
    checkedAt: now.toISOString(),
    status: 'unknown',
    process: { status: 'good', startedAt: new Date(now.getTime() - uptimeSeconds * 1000).toISOString(), uptimeSeconds },
    database: { status: 'error', bytes: null, walBytes: null },
    wamBackup: { status: 'error', count: null, latestAt: null },
    email: { status: 'error', scope: 'current_delivery_records', channels: CHANNELS.map(({ id }) => ({ id, status: 'error', counts: null })) },
    probe: { status: 'unknown', reason: 'unavailable', sampledAt: null, ageSeconds: null, staleAfterSeconds: deps.probeStaleAfterSeconds },
    fileBackup: { status: 'unknown', state: 'unknown', latestAt: null, ageSeconds: null, staleAfterSeconds: deps.backupStaleAfterSeconds },
    cloudBackup: { status: 'unknown', state: 'unknown', latestAt: null, ageSeconds: null, archiveBytes: null, staleAfterSeconds: deps.backupStaleAfterSeconds },
    certificate: { status: 'unknown', state: 'unknown', validFrom: null, expiresAt: null, daysRemaining: null },
    timers: (Object.keys(TIMER_UNITS) as Array<keyof typeof TIMER_UNITS>).map((id) => ({ id, state: 'unknown', nextRunAt: null, status: 'unknown' })),
  };

  try {
    const db = deps.db();
    db.prepare('SELECT 1').get();
    if (db.name === ':memory:' || db.name === '') {
      result.database.status = 'unknown';
    } else {
      const main = await deps.statFile(db.name);
      if (!main.isFile()) throw new Error('invalid_db_file');
      result.database.bytes = safeCount(main.size);
      try {
        const wal = await deps.statFile(`${db.name}-wal`);
        if (!wal.isFile()) throw new Error('invalid_wal_file');
        result.database.walBytes = safeCount(wal.size);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        result.database.walBytes = 0;
      }
      result.database.status = 'good';
    }
    const backup = db.prepare('SELECT COUNT(*) AS count, MAX(created_at) AS latestAt FROM backup').get() as { count: number; latestAt: string | null };
    const count = safeCount(backup.count);
    const latestAt = safeTimestamp(backup.latestAt);
    result.wamBackup = { count, latestAt, status: count === 0 ? 'unknown' : latestAt === null || Date.parse(latestAt) > now.getTime() ? 'error' : 'good' };
    result.email.channels = CHANNELS.map((channel) => {
      const counts = deliveryCounts(db, channel);
      return { id: channel.id, counts, status: counts.failed > 0 ? 'warn' : Object.values(counts).every((n) => n === 0) ? 'unknown' : 'good' };
    });
    result.email.status = worst(result.email.channels.map((channel) => channel.status));
  } catch {
    // Fail closed even if an earlier aggregate succeeded; never forward SQL or filesystem errors.
    result.database.status = 'error';
    result.wamBackup = { status: 'error', count: null, latestAt: null };
    result.email = { status: 'error', scope: 'current_delivery_records', channels: CHANNELS.map(({ id }) => ({ id, status: 'error', counts: null })) };
  }

  let probe: ProbeReading;
  try { probe = await deps.readProbe(now); } catch { probe = { reason: 'unavailable', sampledAt: null, ageSeconds: null, data: null }; }
  result.probe = {
    status: probe.reason === 'fresh' ? 'good' : probe.reason === 'stale' ? 'warn' : 'unknown',
    reason: probe.reason, sampledAt: probe.sampledAt, ageSeconds: probe.ageSeconds, staleAfterSeconds: deps.probeStaleAfterSeconds,
  };
  const observedStatus = (status: MonitoringStatus): MonitoringStatus => probe.reason === 'stale' && status === 'good' ? 'warn' : status;
  if (probe.data) {
    const { certificate, fileBackup, cloudBackup, timers } = probe.data;
    result.certificate.state = certificate.state;
    if (certificate.state === 'observed' && certificate.validTo && certificate.validFrom) {
      result.certificate = {
        state: 'observed', status: observedStatus(certificateStatus(certificate.validFrom, certificate.validTo, now)),
        validFrom: certificate.validFrom, expiresAt: certificate.validTo,
        daysRemaining: Math.floor((Date.parse(certificate.validTo) - now.getTime()) / 86_400_000),
      };
    }
    result.fileBackup.state = fileBackup.state;
    if (fileBackup.state === 'observed' && fileBackup.lastSuccessAt) {
      const ageMs = now.getTime() - Date.parse(fileBackup.lastSuccessAt);
      const ageSeconds = Math.floor(ageMs / 1000);
      result.fileBackup = {
        ...result.fileBackup, state: 'observed', latestAt: fileBackup.lastSuccessAt, ageSeconds,
        status: observedStatus(ageMs > deps.backupStaleAfterSeconds * 1000 ? 'warn' : 'good'),
      };
    }
    result.cloudBackup.state = cloudBackup.state;
    if (cloudBackup.state === 'observed' && cloudBackup.lastSuccessAt !== null && cloudBackup.archiveBytes !== null) {
      const ageMs = now.getTime() - Date.parse(cloudBackup.lastSuccessAt);
      result.cloudBackup = {
        ...result.cloudBackup, state: 'observed', latestAt: cloudBackup.lastSuccessAt, ageSeconds: Math.floor(ageMs / 1000),
        archiveBytes: cloudBackup.archiveBytes, status: observedStatus(ageMs > deps.backupStaleAfterSeconds * 1000 ? 'warn' : 'good'),
      };
    }
    result.timers = timers.map((timer) => ({
      id: timer.id, state: timer.state, nextRunAt: timer.nextRunAt,
      status: observedStatus(timer.state === 'failed' ? 'error' : timer.state === 'inactive' ? 'warn'
        : timer.state === 'active' ? (timer.nextRunAt && Date.parse(timer.nextRunAt) > now.getTime() ? 'good' : 'warn') : 'unknown'),
    }));
  }
  result.status = worst([result.process.status, result.database.status, result.wamBackup.status, result.email.status,
    result.probe.status, result.fileBackup.status, result.cloudBackup.status, result.certificate.status, ...result.timers.map((timer) => timer.status)]);
  return result;
}

export { readOperationalProbe };
