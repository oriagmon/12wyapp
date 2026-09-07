import type { AsyncStatus } from '../hooks/useAsyncStatus';

const LABELS: Record<AsyncStatus, string> = {
  idle: '',
  saving: 'שומר...',
  saved: 'נשמר ✓',
  error: 'שגיאה בשמירה',
};

export function StatusBadge({ status, error }: { status: AsyncStatus; error?: string | null }) {
  if (status === 'idle') return null;
  return (
    <span className={`status-badge ${status}`} role="status" aria-live="polite">
      {status === 'error' && error ? error : LABELS[status]}
    </span>
  );
}
