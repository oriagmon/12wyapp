import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { translateActive } from '../i18n';

/**
 * Focused types for the tactic-evidence feature, kept local to this hook rather than added to
 * lib/types.ts (following the same convention used by useWeeklyPlanningRitual.ts /
 * useExecutionRecovery.ts / useBroosts.ts).
 */
export interface TacticEvidence {
  tacticId: number;
  week: number;
  /** null for the weekly entry; 0..6 only for preserved legacy daily entries. */
  weekday: number | null;
  note: string | null;
  link: string | null;
  hasFile: boolean;
  fileOriginalName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  createdAt: string;
  updatedAt: string;
}

export type TacticEvidenceAccess = 'owner' | 'partner';
export type TacticEvidenceLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The exact same allowlist the server sniffs/accepts (see server/src/lib/tacticEvidence.ts)
 *  — used here purely for a fast, friendly client-side precheck before ever uploading; the
 *  server's own content-signature sniffing remains the actual authority. */
export const EVIDENCE_ACCEPTED_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx', '.txt'];
export const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB

export function hasAcceptedEvidenceExtension(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return EVIDENCE_ACCEPTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Edits one tactic/week's evidence and loads all its legacy daily records alongside it.
 * Weekly mutations never target a legacy record.
 */
export function useTacticEvidence(tacticId: number | null, week: number | null) {
  const [evidence, setEvidence] = useState<TacticEvidence | null>(null);
  const [legacyEvidence, setLegacyEvidence] = useState<TacticEvidence[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [access, setAccess] = useState<TacticEvidenceAccess | null>(null);
  const [loadStatus, setLoadStatus] = useState<TacticEvidenceLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const requestId = useRef(0);

  const weekPath = tacticId !== null && week !== null ? `/tactic-evidence/weekly/${tacticId}/${week}` : null;
  const activePath = useRef(weekPath);
  activePath.current = weekPath;

  const reload = useCallback(async () => {
    if (!weekPath) return;
    const id = ++requestId.current;
    if (!hasDataRef.current) setLoadStatus('loading');
    try {
      const data = await api.get<{
        access: TacticEvidenceAccess;
        evidence: TacticEvidence | null;
        legacyEvidence: TacticEvidence[];
        canCreate: boolean;
      }>(weekPath);
      if (activePath.current !== weekPath || id !== requestId.current) return;
      setEvidence(data.evidence);
      setLegacyEvidence(data.legacyEvidence);
      setCanCreate(data.canCreate);
      setAccess(data.access);
      hasDataRef.current = true;
      setLoadStatus('ready');
      setLoadError(null);
    } catch (e) {
      if (activePath.current !== weekPath || id !== requestId.current) return;
      setEvidence(null);
      setLegacyEvidence([]);
      setAccess(null);
      setCanCreate(false);
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.evidence'));
      setLoadStatus('error');
    }
  }, [weekPath]);

  useEffect(() => {
    hasDataRef.current = false;
    setEvidence(null);
    setLegacyEvidence([]);
    setCanCreate(false);
    setAccess(null);
    setLoadStatus('idle');
    reload();
    return () => { requestId.current += 1; };
  }, [reload]);

  const saveMeta = useCallback(
    async (input: { note?: string; link?: string }) => {
      if (!weekPath) throw new Error(translateActive('common.guard.noWeek'));
      const id = ++requestId.current;
      const updated = await api.put<TacticEvidence>(weekPath, input);
      if (activePath.current === weekPath && requestId.current === id) setEvidence(updated);
      return updated;
    },
    [weekPath]
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (!weekPath) throw new Error(translateActive('common.guard.noWeek'));
      const id = ++requestId.current;
      const updated = await api.putBinary<TacticEvidence | { evidence: null }>(`${weekPath}/file`, file, file.type || 'application/octet-stream', {
        'X-Evidence-Filename': encodeURIComponent(file.name),
      });
      const record = 'evidence' in updated ? updated.evidence : updated;
      if (activePath.current === weekPath && requestId.current === id) setEvidence(record);
      return record;
    },
    [weekPath]
  );

  const deleteFile = useCallback(async () => {
    if (!weekPath) throw new Error(translateActive('common.guard.noWeek'));
    const id = ++requestId.current;
    const result = await api.delete<{ evidence: TacticEvidence | null }>(`${weekPath}/file`);
    if (activePath.current === weekPath && requestId.current === id) setEvidence(result.evidence);
    return result.evidence;
  }, [weekPath]);

  const deleteAll = useCallback(async () => {
    if (!weekPath) throw new Error(translateActive('common.guard.noWeek'));
    const id = ++requestId.current;
    await api.delete(weekPath);
    if (activePath.current === weekPath && requestId.current === id) setEvidence(null);
  }, [weekPath]);

  const downloadFile = useCallback(async () => {
    if (!weekPath || tacticId === null || week === null || !evidence?.hasFile) {
      throw new Error(translateActive('common.guard.noFile'));
    }
    await downloadTacticEvidenceFile(tacticId, week, null, evidence.fileOriginalName);
  }, [weekPath, tacticId, week, evidence]);

  return {
    evidence,
    legacyEvidence,
    canCreate,
    access,
    loadStatus,
    loadError,
    reload,
    saveMeta,
    uploadFile,
    deleteFile,
    deleteAll,
    downloadFile,
  };
}

/** Fetches one occurrence's evidence file as a blob and triggers a browser download/save —
 *  deliberately only ever called from a user click (never eagerly), per the "don't load file
 *  bytes until the user asks for them" requirement. Authenticated via the same-origin session
 *  cookie, exactly like ExportDataButton's own fetch-then-blob pattern. Standalone (not tied
 *  to a specific hook instance's state) so both useTacticEvidence and the cycle-wide
 *  EvidenceGallery (which lists many different occurrences at once) can share it. */
export async function downloadTacticEvidenceFile(
  tacticId: number,
  week: number,
  weekday: number | null,
  suggestedFilename: string | null
): Promise<void> {
  const scope = weekday === null ? `weekly/${tacticId}/${week}` : `${tacticId}/${week}/${weekday}`;
  const res = await fetch(`/api/tactic-evidence/${scope}/file`, { credentials: 'include' });
  if (!res.ok) {
    let message = translateActive('common.error.server', { status: res.status });
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore — keep the generic message
    }
    throw new ApiError(message, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedFilename || 'evidence';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
