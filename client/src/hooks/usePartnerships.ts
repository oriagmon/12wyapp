import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { PartnershipsState, RegisteredUser } from '../lib/types';
import { translateActive } from '../i18n';

/**
 * V1 direct-pairing model: no invitation/acceptance step. Any authenticated user can list
 * every other registered user and immediately select one as their accountability partner.
 */
export function usePartnerships() {
  const [state, setState] = useState<PartnershipsState | null>(null);
  const [candidates, setCandidates] = useState<RegisteredUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [partnershipState, candidatesRes] = await Promise.all([
        api.get<PartnershipsState>('/partnerships'),
        api.get<{ users: RegisteredUser[] }>('/partnerships/candidates'),
      ]);
      setState(partnershipState);
      setCandidates(candidatesRes.users);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : translateActive('common.load.partnerships'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const pair = useCallback(
    async (targetUserId: number) => {
      const res = await api.post<{ partner: NonNullable<PartnershipsState['partner']> }>('/partnerships/pair', {
        targetUserId,
      });
      await reload();
      return res;
    },
    [reload]
  );

  const remove = useCallback(
    async (id: number) => {
      await api.delete(`/partnerships/${id}`);
      await reload();
    },
    [reload]
  );

  return { state, candidates, loading, error, reload, pair, remove };
}
