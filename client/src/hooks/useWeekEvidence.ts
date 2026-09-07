import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { hasAcceptedEvidenceExtension, MAX_EVIDENCE_FILE_BYTES, type TacticEvidence } from './useTacticEvidence';
import { translateActive } from '../i18n';

export interface WeekEvidenceItem extends Omit<TacticEvidence, 'tacticId'> {
  id: number;
  cycleId: number;
  tacticId: number | null;
  scope: 'week' | 'tactic-week' | 'tactic-day';
  tacticTitle: string | null;
  goalTitle: string | null;
}

interface AlbumState {
  path: string | null;
  items: WeekEvidenceItem[];
  access: 'owner' | 'partner' | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

/** A null week reads the complete cycle for history; only a concrete week can be edited. */
export function useWeekEvidence(cycleId: number | null, week: number | null) {
  const path = cycleId === null ? null : `/week-evidence/${cycleId}${week === null ? '' : `/${week}`}`;
  const active = useRef(path);
  active.current = path;
  const request = useRef(0);
  const generation = useRef(0);
  const [state, setState] = useState<AlbumState>({ path: null, items: [], access: null, status: 'idle', error: null });
  const current = state.path === path ? state : { path, items: [], access: null, status: 'loading' as const, error: null };

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++request.current;
    setState({ path, items: [], access: null, status: 'loading', error: null });
    try {
      const result = await api.get<{ items: WeekEvidenceItem[]; access: 'owner' | 'partner' }>(path);
      if (active.current !== path || id !== request.current) return;
      setState({ path, ...result, status: 'ready', error: null });
    } catch (error) {
      if (active.current !== path || id !== request.current) return;
      setState({ path, items: [], access: null, status: 'error', error: error instanceof Error ? error.message : translateActive('common.load.album') });
    }
  }, [path]);

  useEffect(() => {
    generation.current += 1;
    if (path) void reload();
    else setState({ path: null, items: [], access: null, status: 'idle', error: null });
    return () => { request.current += 1; generation.current += 1; };
  }, [path, reload]);

  const requireScope = () => {
    if (!path || week === null || current.access !== 'owner') throw new Error(translateActive('common.guard.readOnlyWeek'));
    return path;
  };
  const merge = (item: WeekEvidenceItem, target: string, version: number) => {
    if (active.current !== target || generation.current !== version) return;
    setState((previous) => previous.path !== target || previous.status !== 'ready' || previous.access !== 'owner' ? previous : {
      ...previous, items: [...previous.items.filter((existing) => existing.id !== item.id), item].sort((a, b) => a.id - b.id),
    });
  };
  const handleMutationFailure = (error: unknown, target: string, version: number) => {
    if (active.current !== target || generation.current !== version) return;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      generation.current += 1;
      request.current += 1;
      setState({ path: target, items: [], access: null, status: 'error', error: error.message });
    }
  };

  const uploadFiles = async (files: File[]) => {
    const target = requireScope();
    const version = generation.current;
    const errors: string[] = [];
    // Each accepted file is its own record. Failed files never erase successful siblings.
    for (const file of files) {
      if (active.current !== target || generation.current !== version) break;
      if (!hasAcceptedEvidenceExtension(file.name)) { errors.push(`${file.name}: ${translateActive('common.upload.badType')}`); continue; }
      if (file.size > MAX_EVIDENCE_FILE_BYTES) { errors.push(`${file.name}: ${translateActive('common.upload.tooLarge')}`); continue; }
      try {
        const mime = file.type || ({
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain',
        } as Record<string, string>)[file.name.split('.').pop()!.toLowerCase()] || 'application/octet-stream';
        const item = await api.postBinary<WeekEvidenceItem>(`${target}/files`, file, mime, { 'X-Evidence-Filename': encodeURIComponent(file.name) });
        merge(item, target, version);
      } catch (error) {
        handleMutationFailure(error, target, version);
        errors.push(`${file.name}: ${error instanceof Error ? error.message : translateActive('common.upload.failed')}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  };

  const save = async (input: { note: string; link: string }, id?: number) => {
    const target = requireScope();
    const version = generation.current;
    try {
      const item = id === undefined
        ? await api.post<WeekEvidenceItem>(target, input)
        : await api.put<WeekEvidenceItem>(`${target}/${id}`, input);
      merge(item, target, version);
    } catch (error) {
      handleMutationFailure(error, target, version);
      throw error;
    }
  };

  const remove = async (id: number, fileOnly = false) => {
    const target = requireScope();
    const version = generation.current;
    try {
      await api.delete(`${target}/${id}${fileOnly ? '/file' : ''}`);
      if (active.current === target && generation.current === version) await reload();
    } catch (error) {
      handleMutationFailure(error, target, version);
      throw error;
    }
  };

  return { ...current, reload, uploadFiles, save, remove };
}

export async function fetchWeekEvidenceFile(item: WeekEvidenceItem): Promise<Blob> {
  const response = await fetch(`/api/week-evidence/${item.cycleId}/${item.week}/${item.id}/file`, { credentials: 'include' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? translateActive('common.load.file'), response.status);
  }
  return response.blob();
}

export async function downloadWeekEvidenceFile(item: WeekEvidenceItem): Promise<void> {
  const url = URL.createObjectURL(await fetchWeekEvidenceFile(item));
  const link = document.createElement('a');
  link.href = url;
  link.download = item.fileOriginalName || 'evidence';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
