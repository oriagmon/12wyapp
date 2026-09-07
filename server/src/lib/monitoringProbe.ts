import path from 'node:path';
import { z } from 'zod';
import { MAX_PROBE_BYTES, PROBE_FILENAME, readBoundedFile, MonitoringFileError } from './monitoringFiles.js';
import { TIMER_UNITS, type OperationalProbe, type ProbeReading } from './monitoringTypes.js';
import { MAX_ARCHIVE_BYTES } from './cloudBackupConfig.js';

const timestamp = z.string().datetime({ precision: 3 }).refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
);
const observationState = z.enum(['observed', 'unknown', 'not_configured']);
export const operationalProbeSchema = z.object({
  version: z.literal(1),
  sampledAt: timestamp,
  timers: z.array(z.object({
    id: z.enum(['weekly', 'reminders', 'broost', 'backup']),
    state: z.enum(['active', 'inactive', 'failed', 'unknown', 'not_configured']),
    nextRunAt: timestamp.nullable(),
  }).strict().refine((timer) => timer.state === 'active' || timer.nextRunAt === null)).length(Object.keys(TIMER_UNITS).length),
  certificate: z.object({
    state: observationState,
    validFrom: timestamp.nullable(),
    validTo: timestamp.nullable(),
  }).strict().refine((cert) => cert.state === 'observed'
    ? cert.validFrom !== null && cert.validTo !== null && cert.validFrom < cert.validTo
    : cert.validFrom === null && cert.validTo === null),
  fileBackup: z.object({
    state: observationState,
    lastSuccessAt: timestamp.nullable(),
  }).strict().refine((backup) => (backup.state === 'observed') === (backup.lastSuccessAt !== null)),
  cloudBackup: z.object({
    state: observationState,
    lastSuccessAt: timestamp.nullable(),
    archiveBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES).nullable(),
  }).strict().refine((backup) => backup.state === 'observed'
    ? backup.lastSuccessAt !== null && backup.archiveBytes !== null
    : backup.lastSuccessAt === null && backup.archiveBytes === null)
    .default({ state: 'not_configured', lastSuccessAt: null, archiveBytes: null }),
}).strict().refine((probe) => new Set(probe.timers.map((timer) => timer.id)).size === Object.keys(TIMER_UNITS).length);

export interface ProbeReaderOptions {
  directory?: string;
  now: Date;
  staleAfterSeconds: number;
  readFile?: (filename: string, limit: number) => Promise<Buffer>;
}

export async function readOperationalProbe(options: ProbeReaderOptions): Promise<ProbeReading> {
  const empty = (reason: ProbeReading['reason']): ProbeReading => ({ reason, data: null, sampledAt: null, ageSeconds: null });
  if (!options.directory) return empty('not_configured');
  let bytes: Buffer;
  try {
    bytes = await (options.readFile ?? readBoundedFile)(path.join(options.directory, PROBE_FILENAME), MAX_PROBE_BYTES);
  } catch (error) {
    if (error instanceof MonitoringFileError && error.code === 'oversized') return empty('oversized');
    return empty((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unavailable');
  }
  if (bytes.length > MAX_PROBE_BYTES) return empty('oversized');
  let data: OperationalProbe;
  try {
    data = operationalProbeSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    return empty('malformed');
  }
  const delta = options.now.getTime() - Date.parse(data.sampledAt);
  if (delta < 0 || (data.fileBackup.lastSuccessAt !== null && data.fileBackup.lastSuccessAt > data.sampledAt)
    || (data.cloudBackup.lastSuccessAt !== null && data.cloudBackup.lastSuccessAt > data.sampledAt)) return empty('future');
  const ageSeconds = Math.floor(delta / 1000);
  return { data, sampledAt: data.sampledAt, ageSeconds, reason: delta > options.staleAfterSeconds * 1000 ? 'stale' : 'fresh' };
}

export function positiveSeconds(value: string | undefined, fallback: number, maximum: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 60 && parsed <= maximum ? parsed : fallback;
}
