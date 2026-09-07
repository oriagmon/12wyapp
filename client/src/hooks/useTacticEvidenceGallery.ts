import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { TacticEvidence } from './useTacticEvidence';
import { translateActive } from '../i18n';

export interface TacticEvidenceGalleryItem extends TacticEvidence {
  tacticTitle: string;
  goalTitle: string;
  goalColor: string;
}

export type TacticEvidenceGalleryAccess = 'owner' | 'partner';
export type TacticEvidenceGalleryLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Loads every evidence record for one whole cycle (active or archived), for the evidence
 *  gallery shown alongside a cycle's summary/history — grouping by week then tactic is done
 *  client-side (see EvidenceGallery.tsx) from this flat, already-ordered (week, tactic,
 *  weekday) list. Never includes file bytes; only metadata. */
export function useTacticEvidenceGallery(cycleId: number | null) {
  const [items, setItems] = useState<TacticEvidenceGalleryItem[]>([]);
  const [access, setAccess] = useState<TacticEvidenceGalleryAccess | null>(null);
  const [loadStatus, setLoadStatus] = useState<TacticEvidenceGalleryLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const activeCycle = useRef(cycleId);
  activeCycle.current = cycleId;

  const reload = useCallback(async () => {
    if (cycleId === null) return;
    const id = ++requestId.current;
    setLoadStatus('loading');
    try {
      const data = await api.get<{ access: TacticEvidenceGalleryAccess; items: TacticEvidenceGalleryItem[] }>(
        `/tactic-evidence/cycle/${cycleId}`
      );
      if (activeCycle.current !== cycleId || id !== requestId.current) return;
      setItems(data.items);
      setAccess(data.access);
      setLoadStatus('ready');
      setLoadError(null);
    } catch (e) {
      if (activeCycle.current !== cycleId || id !== requestId.current) return;
      setItems([]);
      setAccess(null);
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.gallery'));
      setLoadStatus('error');
    }
  }, [cycleId]);

  useEffect(() => {
    setItems([]);
    setAccess(null);
    setLoadStatus('idle');
    reload();
    return () => { requestId.current += 1; };
  }, [reload]);

  return { items, access, loadStatus, loadError, reload };
}
