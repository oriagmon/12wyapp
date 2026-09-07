import { useCallback, useRef, useState } from 'react';
import type { AsyncStatus } from './useAsyncStatus';

/**
 * Same idle/saving/saved/error lifecycle as useAsyncStatus, but scoped purely to the calling
 * component — it never publishes to the shared global save-status bus that TopBar reads from
 * (and unlike that bus, 'error' here only ever lives in this component's own local state).
 *
 * Use this instead of useAsyncStatus for actions whose error text is sensitive or otherwise
 * inappropriate to linger indefinitely in global chrome — useAsyncStatus's global 'error'
 * state is never auto-cleared (only 'saved' auto-reverts), so e.g. "current password is
 * wrong" would otherwise sit in TopBar's status badge until some unrelated save elsewhere
 * happens to overwrite it. The password-change form is the current example.
 */
export function useLocalAsyncStatus() {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus('saving');
    setError(null);
    try {
      const result = await action();
      setStatus('saved');
      timeoutRef.current = setTimeout(() => setStatus('idle'), 1800);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      setStatus('error');
      setError(message);
      return undefined;
    }
  }, []);

  return { status, error, run };
}
