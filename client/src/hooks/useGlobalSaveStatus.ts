import { useEffect, useState } from 'react';
import { subscribeSaveStatus } from '../lib/saveStatusBus';
import type { AsyncStatus } from './useAsyncStatus';

export function useGlobalSaveStatus(): { status: AsyncStatus; error: string | null } {
  const [state, setState] = useState<{ status: AsyncStatus; error: string | null }>({
    status: 'idle',
    error: null,
  });

  useEffect(() => subscribeSaveStatus((status, error) => setState({ status, error })), []);

  return state;
}
