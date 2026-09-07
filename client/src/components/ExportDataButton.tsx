import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { translateActive, useTranslation } from '../i18n';

/**
 * Downloads the caller's complete data (profile, settings, every cycle — active and
 * archived — with goals/tactics/completions, partnership status, and WAMs they
 * participate in) as a single JSON file. No CSV, no import, no account deletion in V1.
 */
export function ExportDataButton() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setStatus('working');
    setError(null);
    try {
      const data = await api.get<unknown>('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `12-week-dashboard-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : translateActive('common.load.export'));
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto' }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={handleExport} disabled={status === 'working'}>
        {status === 'working' ? t('common.export.working') : t('common.export.cta')}
      </button>
      {status === 'error' && <span className="status-badge error">{error}</span>}
    </span>
  );
}
