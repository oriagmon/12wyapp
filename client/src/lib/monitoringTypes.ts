export type MonitoringStatus = 'good' | 'warn' | 'unknown' | 'error';
export type TimerId = 'weekly' | 'reminders' | 'broost' | 'backup';
type ObservationState = 'observed' | 'unknown' | 'not_configured';
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
    channels: Array<{
      id: 'weekly' | 'reminders' | 'broost' | 'calendar';
      status: MonitoringStatus;
      counts: { sent: number; failed: number; pending: number; sending: number; cancelled: number } | null;
    }>;
  };
  probe: {
    status: MonitoringStatus;
    reason: 'fresh' | 'stale' | 'missing' | 'not_configured' | 'unavailable' | 'malformed' | 'oversized' | 'future';
    sampledAt: string | null;
    ageSeconds: number | null;
    staleAfterSeconds: number;
  };
  fileBackup: { status: MonitoringStatus; state: ObservationState; latestAt: string | null; ageSeconds: number | null; staleAfterSeconds: number };
  cloudBackup: { status: MonitoringStatus; state: ObservationState; latestAt: string | null; ageSeconds: number | null; archiveBytes: number | null; staleAfterSeconds: number };
  certificate: { status: MonitoringStatus; state: ObservationState; validFrom: string | null; expiresAt: string | null; daysRemaining: number | null };
  timers: Array<{
    id: TimerId;
    state: 'active' | 'inactive' | 'failed' | 'unknown' | 'not_configured';
    nextRunAt: string | null;
    status: MonitoringStatus;
  }>;
}
