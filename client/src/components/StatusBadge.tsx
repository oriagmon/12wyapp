import type { AsyncStatus } from '../hooks/useAsyncStatus';
import { useTranslation } from '../i18n';

const LABEL_KEYS: Record<Exclude<AsyncStatus, 'idle'>, string> = {
  saving: 'common.status.saving',
  saved: 'common.status.saved',
  error: 'common.status.error',
};

export function StatusBadge({ status, error }: { status: AsyncStatus; error?: string | null }) {
  const { t } = useTranslation();
  if (status === 'idle') return null;
  return (
    <span className={`status-badge ${status}`} role="status" aria-live="polite">
      {status === 'error' && error ? error : t(LABEL_KEYS[status])}
    </span>
  );
}
