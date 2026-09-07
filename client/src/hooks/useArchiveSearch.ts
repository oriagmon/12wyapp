import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { ArchiveSearchResponse } from '../lib/archiveSearchTypes';
import { translateActive } from '../i18n';

export function useArchiveSearch() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ArchiveSearchResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => () => { sequence.current += 1; }, []);

  // Editing invalidates an in-flight request immediately, even before the next submission.
  const changeQuery = useCallback((value: string) => {
    sequence.current += 1;
    setQuery(value);
    setData(null);
    setError(null);
    setStatus('idle');
  }, []);

  const search = useCallback(async () => {
    const requestId = ++sequence.current;
    const value = query.trim();
    setData(null);
    if (!value || query.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) {
      setError(translateActive('common.search.tooLong'));
      setStatus('error');
      return;
    }
    setError(null);
    setStatus('loading');
    try {
      const response = await api.get<ArchiveSearchResponse>(`/archive-search?q=${encodeURIComponent(value)}`);
      if (requestId !== sequence.current) return;
      setData(response);
      setStatus('ready');
    } catch (cause) {
      if (requestId !== sequence.current) return;
      setError(cause instanceof ApiError ? cause.message : translateActive('common.load.results'));
      setStatus('error');
    }
  }, [query]);

  return { query, changeQuery, data, status, error, search };
}
