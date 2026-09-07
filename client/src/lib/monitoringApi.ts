import type { MonitoringSnapshot } from './monitoringTypes';

export class MonitoringRequestError extends Error {
  constructor(public readonly kind: 'authentication' | 'unavailable') {
    super(kind);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isStatus = (value: unknown) => typeof value === 'string' && ['good', 'warn', 'unknown', 'error'].includes(value);
const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isOptionalCount = (value: unknown) => value === null || isCount(value);
const isTimestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isOptionalTimestamp = (value: unknown) => value === null || isTimestamp(value);
const isObservation = (value: unknown) => typeof value === 'string' && ['observed', 'unknown', 'not_configured'].includes(value);

export function isMonitoringSnapshot(value: unknown): value is MonitoringSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isTimestamp(value.checkedAt) || !isStatus(value.status)) return false;
  const { process, database, wamBackup, email, probe, fileBackup, cloudBackup, certificate, timers } = value;
  if (![process, database, wamBackup, email, probe, fileBackup, cloudBackup, certificate].every((v) => isRecord(v) && isStatus(v.status))) return false;
  if (!isRecord(process) || !isTimestamp(process.startedAt) || !isCount(process.uptimeSeconds)) return false;
  if (!isRecord(database) || !isOptionalCount(database.bytes) || !isOptionalCount(database.walBytes)) return false;
  if (!isRecord(wamBackup) || !isOptionalCount(wamBackup.count) || !isOptionalTimestamp(wamBackup.latestAt)) return false;
  if (!isRecord(probe) || !['fresh', 'stale', 'missing', 'not_configured', 'unavailable', 'malformed', 'oversized', 'future'].includes(String(probe.reason))
    || !isOptionalTimestamp(probe.sampledAt) || !isOptionalCount(probe.ageSeconds) || !isCount(probe.staleAfterSeconds)) return false;
  if (!isRecord(fileBackup) || !isObservation(fileBackup.state) || !isOptionalTimestamp(fileBackup.latestAt)
    || !isOptionalCount(fileBackup.ageSeconds) || !isCount(fileBackup.staleAfterSeconds)) return false;
  if (!isRecord(cloudBackup) || !isObservation(cloudBackup.state) || !isOptionalTimestamp(cloudBackup.latestAt)
    || !isOptionalCount(cloudBackup.ageSeconds) || !isCount(cloudBackup.staleAfterSeconds) || !isOptionalCount(cloudBackup.archiveBytes)) return false;
  if (!isRecord(certificate) || !isObservation(certificate.state) || !isOptionalTimestamp(certificate.validFrom) || !isOptionalTimestamp(certificate.expiresAt)
    || !(certificate.daysRemaining === null || (typeof certificate.daysRemaining === 'number' && Number.isSafeInteger(certificate.daysRemaining)))) return false;
  if (!isRecord(email) || email.scope !== 'current_delivery_records' || !Array.isArray(email.channels) || email.channels.length !== 4) return false;
  if (!email.channels.every((channel) => isRecord(channel) && ['weekly', 'reminders', 'broost', 'calendar'].includes(String(channel.id))
    && isStatus(channel.status) && (channel.counts === null || (isRecord(channel.counts)
      && ['sent', 'failed', 'pending', 'sending', 'cancelled'].every((key) => isCount((channel.counts as Record<string, unknown>)[key])))))) return false;
  if (new Set(email.channels.map((channel: { id: string }) => channel.id)).size !== 4) return false;
  if (!Array.isArray(timers) || timers.length !== 4 || !timers.every((timer) => isRecord(timer)
    && ['weekly', 'reminders', 'broost', 'backup'].includes(String(timer.id)) && isStatus(timer.status)
    && ['active', 'inactive', 'failed', 'unknown', 'not_configured'].includes(String(timer.state)) && isOptionalTimestamp(timer.nextRunAt))) return false;
  return new Set(timers.map((timer: { id: string }) => timer.id)).size === 4;
}

export async function fetchMonitoringSnapshot(signal: AbortSignal): Promise<MonitoringSnapshot> {
  const response = await fetch('/api/monitoring', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal });
  if (response.status === 401 || response.status === 403) throw new MonitoringRequestError('authentication');
  if (!response.ok && response.status !== 503) throw new MonitoringRequestError('unavailable');
  let value: unknown;
  try {
    const text = await response.text();
    if (text.length > 32_768) throw new Error('oversized');
    value = JSON.parse(text);
  } catch {
    throw new MonitoringRequestError('unavailable');
  }
  if (!isMonitoringSnapshot(value)) throw new MonitoringRequestError('unavailable');
  return value;
}
