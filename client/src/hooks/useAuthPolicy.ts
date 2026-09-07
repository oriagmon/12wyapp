import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

type PolicyState =
  | { status: 'loading'; registrationOpen: false }
  | { status: 'error'; registrationOpen: false }
  | { status: 'ready'; registrationOpen: boolean };

export function useAuthPolicy() {
  const [state, setState] = useState<PolicyState>({ status: 'loading', registrationOpen: false });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'loading', registrationOpen: false });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const policy = await api.get<{ registrationOpen?: unknown } | null>('/auth/policy');
        if (typeof policy?.registrationOpen !== 'boolean') throw new Error('Invalid auth policy');
        if (!cancelled) setState({ status: 'ready', registrationOpen: policy.registrationOpen });
      } catch {
        if (!cancelled) setState({ status: 'error', registrationOpen: false });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt]);

  return { ...state, retry };
}
