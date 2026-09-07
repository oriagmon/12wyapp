import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTacticEvidence, downloadTacticEvidenceFile, hasAcceptedEvidenceExtension } from '../hooks/useTacticEvidence';
import { useTacticEvidenceGallery } from '../hooks/useTacticEvidenceGallery';
import { api } from '../lib/api';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      putBinary: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SAMPLE_EVIDENCE = {
  tacticId: 10,
  week: 1,
  weekday: null,
  note: 'עבדתי שעה',
  link: 'https://example.com',
  hasFile: false,
  fileOriginalName: null,
  fileMime: null,
  fileSize: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const OWNER = { access: 'owner', legacyEvidence: [], canCreate: true };

describe('hasAcceptedEvidenceExtension', () => {
  it('accepts every allowed extension case-insensitively and rejects everything else', () => {
    expect(hasAcceptedEvidenceExtension('a.PNG')).toBe(true);
    expect(hasAcceptedEvidenceExtension('a.docx')).toBe(true);
    expect(hasAcceptedEvidenceExtension('a.txt')).toBe(true);
    expect(hasAcceptedEvidenceExtension('a.svg')).toBe(false);
    expect(hasAcceptedEvidenceExtension('a.exe')).toBe(false);
    expect(hasAcceptedEvidenceExtension('a.html')).toBe(false);
  });
});

describe('useTacticEvidence', () => {
  it('loads evidence for the given tactic/week on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE });
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.evidence).toEqual(SAMPLE_EVIDENCE);
    expect(result.current.access).toBe('owner');
    expect(api.get).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1');
  });

  it('stays idle when tacticId/week are null', async () => {
    const { result } = renderHook(() => useTacticEvidence(null, null));
    expect(result.current.loadStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reloads with a fresh week when the ids change, resetting to idle first', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE });
    const { result, rerender } = renderHook(({ week }: { week: number }) => useTacticEvidence(10, week), {
      initialProps: { week: 1 },
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    rerender({ week: 2 });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tactic-evidence/weekly/10/2'));
    await waitFor(() => expect(result.current.evidence).toBeNull());
  });

  it('surfaces a load error rather than throwing', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBeTruthy();
  });

  it('saveMeta PUTs note/link and updates local state', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    vi.mocked(api.put).mockResolvedValue(SAMPLE_EVIDENCE);
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await act(async () => {
      await result.current.saveMeta({ note: 'עבדתי שעה', link: 'https://example.com' });
    });
    expect(api.put).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1', { note: 'עבדתי שעה', link: 'https://example.com' });
    expect(result.current.evidence).toEqual(SAMPLE_EVIDENCE);
  });

  it('uploadFile sends the file bytes with the X-Evidence-Filename header and updates local state', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    const withFile = { ...SAMPLE_EVIDENCE, hasFile: true, fileOriginalName: 'proof.png', fileMime: 'image/png', fileSize: 3 };
    vi.mocked(api.putBinary).mockResolvedValue(withFile);
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    const file = new File([new Uint8Array([1, 2, 3])], 'proof.png', { type: 'image/png' });
    await act(async () => {
      await result.current.uploadFile(file);
    });
    expect(api.putBinary).toHaveBeenCalledWith(
      '/tactic-evidence/weekly/10/1/file',
      expect.anything(),
      'image/png',
      { 'X-Evidence-Filename': encodeURIComponent('proof.png') }
    );
    expect(result.current.evidence).toEqual(withFile);
  });

  it('deleteFile DELETEs the file endpoint and updates local state (possibly to null)', async () => {
    const withFile = { ...SAMPLE_EVIDENCE, hasFile: true, fileOriginalName: 'proof.png' };
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: withFile });
    vi.mocked(api.delete).mockResolvedValue({ evidence: null });
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await act(async () => {
      await result.current.deleteFile();
    });
    expect(api.delete).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1/file');
    expect(result.current.evidence).toBeNull();
  });

  it('deleteAll deletes only the weekly record and preserves every legacy entry', async () => {
    const legacyEvidence = [0, 4].map((weekday) => ({ ...SAMPLE_EVIDENCE, weekday, note: `legacy-${weekday}` }));
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE, legacyEvidence });
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await act(async () => {
      await result.current.deleteAll();
    });
    expect(api.delete).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1');
    expect(result.current.evidence).toBeNull();
    expect(result.current.legacyEvidence).toEqual(legacyEvidence);
  });

  it('downloadFile throws without ever fetching when there is no file', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE });
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await expect(result.current.downloadFile()).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores a previous week response after switching weeks', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ week }) => useTacticEvidence(10, week), { initialProps: { week: 1 } });
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null, canCreate: false });
    rerender({ week: 2 });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => resolveOld({ ...OWNER, evidence: SAMPLE_EVIDENCE }));
    expect(result.current.evidence).toBeNull();
    expect(result.current.canCreate).toBe(false);
  });

  it('clears all sensitive metadata if a reload loses permission', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE, legacyEvidence: [{ ...SAMPLE_EVIDENCE, weekday: 0 }] });
    const { result } = renderHook(() => useTacticEvidence(10, 1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    vi.mocked(api.get).mockRejectedValue(new Error('revoked'));
    await act(async () => result.current.reload());
    expect(result.current.evidence).toBeNull();
    expect(result.current.legacyEvidence).toEqual([]);
    expect(result.current.access).toBeNull();
  });
});

describe('downloadTacticEvidenceFile', () => {
  it.each([null, 0, 4])('downloads the exact weekly or legacy scope only when called: %s', async (weekday) => {
    const blob = new Blob(['file bytes'], { type: 'image/png' });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    } as Response);
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    expect(fetchSpy).not.toHaveBeenCalled(); // never fetched before this explicit call
    await downloadTacticEvidenceFile(10, 1, weekday, 'proof.png');
    expect(fetchSpy).toHaveBeenCalledWith(
      weekday === null ? '/api/tactic-evidence/weekly/10/1/file' : `/api/tactic-evidence/10/1/${weekday}/file`,
      { credentials: 'include' }
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('surfaces a safe error message from a failed download rather than throwing an opaque error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'אין הרשאה' }),
    } as Response);
    await expect(downloadTacticEvidenceFile(10, 1, 0, 'proof.png')).rejects.toThrow('אין הרשאה');
  });
});

describe('useTacticEvidenceGallery', () => {
  it('loads the flat evidence list for a cycle', async () => {
    const items = [
      { ...SAMPLE_EVIDENCE, tacticTitle: 'טקטיקה', goalTitle: 'מטרה', goalColor: 'emerald' },
    ];
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items });
    const { result } = renderHook(() => useTacticEvidenceGallery(5));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.items).toEqual(items);
    expect(api.get).toHaveBeenCalledWith('/tactic-evidence/cycle/5');
  });

  it('stays idle when cycleId is null', () => {
    const { result } = renderHook(() => useTacticEvidenceGallery(null));
    expect(result.current.loadStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('surfaces a load error rather than throwing', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTacticEvidenceGallery(5));
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBeTruthy();
  });

  it('ignores stale cycle data and clears the collection after a denied reload', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ cycleId }) => useTacticEvidenceGallery(cycleId), { initialProps: { cycleId: 5 } });
    vi.mocked(api.get).mockResolvedValue({ access: 'partner', items: [] });
    rerender({ cycleId: 6 });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => resolveOld({ access: 'owner', items: [SAMPLE_EVIDENCE] }));
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBe('partner');
    vi.mocked(api.get).mockRejectedValue(new Error('revoked'));
    await act(async () => result.current.reload());
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBeNull();
  });
});
