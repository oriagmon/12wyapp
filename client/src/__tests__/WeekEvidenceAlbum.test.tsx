import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekEvidenceAlbum } from '../components/WeekEvidenceAlbum';
import { useWeekEvidence, type WeekEvidenceItem } from '../hooks/useWeekEvidence';
import { api, ApiError } from '../lib/api';

vi.mock('../lib/api', () => ({
  ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), postBinary: vi.fn() },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function item(id: number, overrides: Partial<WeekEvidenceItem> = {}): WeekEvidenceItem {
  return {
    id, cycleId: 10, week: 1, tacticId: null, weekday: null, scope: 'week', tacticTitle: null, goalTitle: null,
    note: null, link: null, hasFile: true, fileOriginalName: `photo-${id}.png`, fileMime: 'image/png', fileSize: 8,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
  };
}
describe('WeekEvidenceAlbum', () => {
  it('offers one multi-file upload for the entire week with no tactic/completion prerequisites', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [] });
    vi.mocked(api.postBinary).mockResolvedValueOnce(item(1)).mockResolvedValueOnce(item(2));
    render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    const input = await screen.findByLabelText('הוספת תמונות או קבצים לשבוע 1');
    expect(input).toHaveAttribute('multiple');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })] } });
    await waitFor(() => expect(api.postBinary).toHaveBeenCalledTimes(2));
    expect(api.postBinary).toHaveBeenNthCalledWith(1, '/week-evidence/10/1/files', expect.any(File), 'image/png', { 'X-Evidence-Filename': 'a.png' });
    expect(await screen.findByText(/photo-1.png/)).toBeInTheDocument();
    expect(screen.getByText(/photo-2.png/)).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'אלבום שבוע 1' })).toHaveLength(1);
  });

  it('shows every daily/tactic-week item beside new weekly photos, with owner edits and scoped downloads', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [
      item(1), item(2, { scope: 'tactic-day', tacticId: 50, weekday: 4, tacticTitle: 'legacy tactic', note: 'daily note', link: 'https://example.test/old' }),
      item(3, { scope: 'tactic-week', tacticId: 50, note: 'old weekly note' }),
    ] });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['synthetic']) } as Response);
    URL.createObjectURL = vi.fn(() => 'blob:synthetic');
    URL.revokeObjectURL = vi.fn();
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    expect(await screen.findByText('daily note')).toBeInTheDocument();
    expect(screen.getByText('old weekly note')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    const legacy = screen.getByRole('listitem', { name: 'עדות קודמת · legacy tactic · ה׳' });
    fireEvent.click(within(legacy).getByRole('button', { name: 'הורדה' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/week-evidence/10/1/2/file', { credentials: 'include' }));
    expect(within(legacy).getByRole('link')).toHaveAttribute('href', 'https://example.test/old');
    expect(within(legacy).getByRole('button', { name: 'עריכת הערה וקישור' })).toBeInTheDocument();
    anchor.mockRestore(); fetch.mockRestore();
  });

  it('uses server partner access even with a stale owner prop', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'partner', items: [item(1)] });
    render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    expect(await screen.findByText(/photo-1.png/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/הוספת תמונות/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'מחיקת הפריט' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הורדה' })).toBeInTheDocument();
  });

  it('keeps successful uploads visible when another file fails and rejects unsupported/oversized inputs locally', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [] });
    vi.mocked(api.postBinary).mockResolvedValueOnce(item(1)).mockRejectedValueOnce(new Error('failed file'));
    render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    const input = await screen.findByLabelText('הוספת תמונות או קבצים לשבוע 1');
    fireEvent.change(input, { target: { files: [
      new File(['a'], 'good.png'), new File(['b'], 'failed.png'),
      new File(['svg'], 'bad.svg'), new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png'),
    ] } });
    expect(await screen.findByText(/photo-1.png/)).toBeInTheDocument();
    await waitFor(() => expect(api.postBinary).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/failed file/)).toBeInTheDocument();
    expect(screen.getByText(/סוג קובץ לא נתמך/)).toBeInTheDocument();
  });

  it('switching weeks clears drafts and old content and targets only the selected week', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [] });
    const { rerender } = render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    await screen.findByLabelText('הוספת תמונות או קבצים לשבוע 1');
    fireEvent.click(screen.getByText('הוספת הערה או קישור לשבוע'));
    fireEvent.change(screen.getByLabelText('הערה לשבוע'), { target: { value: 'old draft' } });
    rerender(<WeekEvidenceAlbum cycleId={10} week={2} isOwner />);
    await screen.findByLabelText('הוספת תמונות או קבצים לשבוע 2');
    expect(screen.getByLabelText('הערה לשבוע')).toHaveValue('');
    vi.mocked(api.post).mockResolvedValue(item(10, { week: 2, note: 'new note', hasFile: false }));
    fireEvent.click(screen.getByText('הוספת הערה או קישור לשבוע'));
    fireEvent.change(screen.getByLabelText('הערה לשבוע'), { target: { value: 'new note' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה לאלבום' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/week-evidence/10/2', { note: 'new note', link: '' }));
    expect(screen.queryByRole('region', { name: 'אלבום שבוע 1' })).not.toBeInTheDocument();
  });

  it('keeps captions when removing only a file and removes only the selected item', async () => {
    const caption = item(1, { note: 'keep this caption' });
    vi.mocked(api.get).mockResolvedValueOnce({ access: 'owner', items: [caption, item(2)] });
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    await screen.findByText('keep this caption');
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [{ ...caption, hasFile: false }, item(2)] });
    fireEvent.click(screen.getByRole('button', { name: 'הסרת הקובץ בלבד' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/week-evidence/10/1/1/file'));
    await waitFor(() => expect(screen.queryByText(/photo-1.png/)).not.toBeInTheDocument());
    expect(screen.getByText('keep this caption')).toBeInTheDocument();
    const second = screen.getByText(/photo-2.png/).closest('li')!;
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [{ ...caption, hasFile: false }] });
    fireEvent.click(within(second).getByRole('button', { name: 'מחיקת הפריט' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/week-evidence/10/1/2'));
    await waitFor(() => expect(screen.queryByText(/photo-2.png/)).not.toBeInTheDocument());
    expect(screen.getByText('keep this caption')).toBeInTheDocument();
  });

  it('does not create a preview for a previous week after its pending image request completes', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ access: 'owner', items: [item(1)] }).mockResolvedValue({ access: 'owner', items: [] });
    let finish!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    URL.createObjectURL = vi.fn(() => 'blob:old-week');
    const { rerender } = render(<WeekEvidenceAlbum cycleId={10} week={1} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'הצגת תמונה' }));
    rerender(<WeekEvidenceAlbum cycleId={10} week={2} isOwner />);
    await act(async () => finish({ ok: true, blob: async () => new Blob(['old']) } as Response));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fetch.mockRestore();
  });
});

describe('useWeekEvidence scope guards', () => {
  it('ignores an older cycle/week response and clears denied metadata', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ cycleId, week }) => useWeekEvidence(cycleId, week), { initialProps: { cycleId: 10, week: 1 } });
    vi.mocked(api.get).mockResolvedValue({ access: 'partner', items: [] });
    rerender({ cycleId: 20, week: 2 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => resolveOld({ access: 'owner', items: [item(1)] }));
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBe('partner');
    vi.mocked(api.get).mockRejectedValue(new Error('revoked'));
    await act(async () => result.current.reload());
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBeNull();
  });

  it('does not append an old upload or continue a batch after the week changes', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [] });
    let finish!: (value: unknown) => void;
    vi.mocked(api.postBinary).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ week }) => useWeekEvidence(10, week), { initialProps: { week: 1 } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const pending = result.current.uploadFiles([new File(['a'], 'a.png'), new File(['b'], 'b.png')]);
    rerender({ week: 2 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { finish(item(1)); await pending; });
    expect(result.current.items).toEqual([]);
    expect(api.postBinary).toHaveBeenCalledTimes(1);
  });

  it('never restores an old mutation response after a denied reload cleared the album', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [item(1)] });
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useWeekEvidence(10, 1));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const pending = result.current.save({ note: 'old mutation', link: '' });
    vi.mocked(api.get).mockRejectedValue(new Error('revoked'));
    await act(async () => result.current.reload());
    await act(async () => { finish(item(2)); await pending; });
    expect(result.current.status).toBe('error');
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBeNull();
  });

  it('clears revoked metadata and stops the remaining upload batch after an authorization denial', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [item(1)] });
    vi.mocked(api.postBinary).mockRejectedValueOnce(new ApiError('revoked', 403));
    const { result } = renderHook(() => useWeekEvidence(10, 1));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await expect(result.current.uploadFiles([new File(['a'], 'a.png'), new File(['b'], 'b.png')])).rejects.toThrow('revoked');
    });
    expect(api.postBinary).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([]);
    expect(result.current.access).toBeNull();
    expect(result.current.status).toBe('error');
  });
});
