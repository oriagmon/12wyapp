export const TIMER_UNITS = {
  weekly: '12-week-dashboard-wam-reminders.timer',
  reminders: '12-week-dashboard-scheduled-reminders.timer',
  broost: '12-week-dashboard-broost-emails.timer',
  backup: '12-week-dashboard-backup.timer',
} as const;

export const BACKUP_TIMER_UNITS = {
  standard: TIMER_UNITS.backup,
  'standalone-blob': '12-week-dashboard-blob-backup.timer',
} as const;

export type TimerId = keyof typeof TIMER_UNITS;
export type BackupTimerSelection = keyof typeof BACKUP_TIMER_UNITS;
export type TimerUnit = typeof TIMER_UNITS[TimerId] | typeof BACKUP_TIMER_UNITS[BackupTimerSelection];
export type MonitoringStatus = 'good' | 'warn' | 'unknown' | 'error';
export type ObservationState = 'observed' | 'unknown' | 'not_configured';
export type TimerState = 'active' | 'inactive' | 'failed' | 'unknown' | 'not_configured';
export interface TimerObservation {
  id: TimerId;
  state: TimerState;
  nextRunAt: string | null;
}
export interface OperationalProbe {
  version: 1;
  sampledAt: string;
  timers: TimerObservation[];
  certificate: {
    state: ObservationState;
    validFrom: string | null;
    validTo: string | null;
  };
  fileBackup: {
    state: ObservationState;
    lastSuccessAt: string | null;
  };
  cloudBackup: {
    state: ObservationState;
    lastSuccessAt: string | null;
    archiveBytes: number | null;
  };
}
export type ProbeReason = 'fresh' | 'stale' | 'missing' | 'not_configured' | 'unavailable' | 'malformed' | 'oversized' | 'future';
export interface ProbeReading {
  reason: ProbeReason;
  sampledAt: string | null;
  ageSeconds: number | null;
  data: OperationalProbe | null;
}
export interface DeliveryCounts {
  sent: number;
  failed: number;
  pending: number;
  sending: number;
  cancelled: number;
}
export interface MonitoringSnapshot {
  version: 1;
  checkedAt: string;
  status: MonitoringStatus;
  process: { status: MonitoringStatus; startedAt: string; uptimeSeconds: number };
  database: { status: MonitoringStatus; bytes: number | null; walBytes: number | null };
  wamBackup: { status: MonitoringStatus; count: number | null; latestAt: string | null };
  email: {
    status: MonitoringStatus;
    scope: 'current_delivery_records';
    channels: Array<{ id: 'weekly' | 'reminders' | 'broost' | 'calendar'; status: MonitoringStatus; counts: DeliveryCounts | null }>;
  };
  probe: { status: MonitoringStatus; reason: ProbeReason; sampledAt: string | null; ageSeconds: number | null; staleAfterSeconds: number };
  fileBackup: {
    status: MonitoringStatus;
    state: ObservationState;
    latestAt: string | null;
    ageSeconds: number | null;
    staleAfterSeconds: number;
  };
  cloudBackup: {
    status: MonitoringStatus;
    state: ObservationState;
    latestAt: string | null;
    ageSeconds: number | null;
    archiveBytes: number | null;
    staleAfterSeconds: number;
  };
  certificate: {
    status: MonitoringStatus;
    state: ObservationState;
    validFrom: string | null;
    expiresAt: string | null;
    daysRemaining: number | null;
  };
  timers: Array<TimerObservation & { status: MonitoringStatus }>;
}
