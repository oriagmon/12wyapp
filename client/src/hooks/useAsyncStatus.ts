import { useCallback, useRef, useState } from 'react';
import { publishSaveStatus } from '../lib/saveStatusBus';

export type AsyncStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Standardizes the saving/saved/error indicator pattern used across mutation controls.
 * `run` executes an async action, sets status to 'saving' immediately, then 'saved' briefly
 * on success (auto-reverting to 'idle') or 'error' (with a message) on failure — and never
 * reports 'saved' when the action throws. Every call also publishes to the global save-status
 * bus so the top status row can surface a single "saving.../נשמר" indicator for any mutation
 * happening anywhere in the dashboard.
 */
export function useAsyncStatus() {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus('saving');
    setError(null);
    publishSaveStatus('saving');
    try {
      const result = await action();
      setStatus('saved');
      publishSaveStatus('saved');
      timeoutRef.current = setTimeout(() => setStatus('idle'), 1800);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      setStatus('error');
      setError(message);
      publishSaveStatus('error', message);
      return undefined;
    }
  }, []);

  return { status, error, run };
}

