import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TacticEvidenceModal } from '../components/TacticEvidenceModal';
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

describe('TacticEvidenceModal', () => {
  it('shows a loading state, then renders owner editable fields seeded from the loaded evidence', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE });
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />
    );
    expect(screen.getByText('טוען...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('מה עבד? (הערה)')).toHaveValue('עבדתי שעה'));
    expect(screen.getByLabelText('קישור (אופציונלי)')).toHaveValue('https://example.com');
  });

  it('surfaces a load error', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('owner can edit and save the note/link', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    vi.mocked(api.put).mockResolvedValue(SAMPLE_EVIDENCE);
    const onChanged = vi.fn();
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} onChanged={onChanged} />
    );
    await waitFor(() => expect(screen.getByLabelText('מה עבד? (הערה)')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('מה עבד? (הערה)'), { target: { value: 'עבדתי שעה' } });
    fireEvent.change(screen.getByLabelText('קישור (אופציונלי)'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1', { note: 'עבדתי שעה', link: 'https://example.com' })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('partner (read-only) sees the note/link/file but no editable inputs', async () => {
    const withFile = { ...SAMPLE_EVIDENCE, hasFile: true, fileOriginalName: 'proof.png', fileMime: 'image/png', fileSize: 2048 };
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, access: 'partner', evidence: withFile });
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner={false} onClose={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('עבדתי שעה')).toBeInTheDocument());
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText(/proof\.png/)).toBeInTheDocument();
    expect(screen.queryByLabelText('מה עבד? (הערה)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הורדה' })).toBeInTheDocument();
  });

  it('partner sees an empty state when there is no evidence yet', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, access: 'partner', evidence: null });
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner={false} onClose={vi.fn()} />
    );
    expect(await screen.findByText(/עדיין לא נוספה עדות/)).toBeInTheDocument();
  });

  it('rejects an unsupported file extension client-side, without ever calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('בחירת קובץ עדות')).toBeInTheDocument());

    const badFile = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('בחירת קובץ עדות'), { target: { files: [badFile] } });
    });
    expect(screen.getByText(/סוג קובץ לא נתמך/)).toBeInTheDocument();
    expect(api.putBinary).not.toHaveBeenCalled();
  });

  it('rejects an oversized file client-side, without ever calling the API', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('בחירת קובץ עדות')).toBeInTheDocument());

    const bigFile = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('בחירת קובץ עדות'), { target: { files: [bigFile] } });
    });
    expect(screen.getByText(/הקובץ גדול מדי/)).toBeInTheDocument();
    expect(api.putBinary).not.toHaveBeenCalled();
  });

  it('owner can upload a valid file and it becomes visible with a remove control', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    const withFile = { ...SAMPLE_EVIDENCE, note: null, link: null, hasFile: true, fileOriginalName: 'proof.png', fileMime: 'image/png', fileSize: 3 };
    vi.mocked(api.putBinary).mockResolvedValue(withFile);
    const onChanged = vi.fn();
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} onChanged={onChanged} />
    );
    await waitFor(() => expect(screen.getByLabelText('בחירת קובץ עדות')).toBeInTheDocument());

    const file = new File([new Uint8Array([1, 2, 3])], 'proof.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('בחירת קובץ עדות'), { target: { files: [file] } });
    });
    await waitFor(() => expect(api.putBinary).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/proof\.png/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'הסרת קובץ' })).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('owner can delete the whole evidence record, which also closes the modal', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE });
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(
      <TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={onClose} onChanged={onChanged} />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'מחיקת העדות השבועית' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת העדות השבועית' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('the close button calls onClose without saving anything', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: null });
    const onClose = vi.fn();
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText('סגירה')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('סגירה'));
    expect(onClose).toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows every legacy day together, leaves the weekly draft empty, and never provides a day picker', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...OWNER, evidence: null,
      legacyEvidence: [0, 4].map((weekday) => ({
        ...SAMPLE_EVIDENCE, weekday, note: `legacy-${weekday}`, link: `https://example.com/${weekday}`,
        hasFile: true, fileOriginalName: `old-${weekday}.png`,
      })),
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, blob: async () => new Blob(['synthetic']),
    } as Response);
    URL.createObjectURL = vi.fn(() => 'blob:synthetic');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />);
    expect(await screen.findByText('legacy-0')).toBeInTheDocument();
    expect(screen.getByText('legacy-4')).toBeInTheDocument();
    expect(screen.getByLabelText('מה עבד? (הערה)')).toHaveValue('');
    expect(screen.getByLabelText('קישור (אופציונלי)')).toHaveValue('');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'הורדת קובץ קודם · ה׳' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/tactic-evidence/10/1/4/file', { credentials: 'include' }));
    fetchSpy.mockRestore();
  });

  it('keeps legacy entries visible after deleting only the weekly record', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, evidence: SAMPLE_EVIDENCE, legacyEvidence: [{ ...SAMPLE_EVIDENCE, weekday: 1, note: 'preserved' }] });
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'מחיקת העדות השבועית' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/tactic-evidence/weekly/10/1'));
    expect(screen.getByText('preserved')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('מה עבד? (הערה)')).toHaveValue(''));
  });

  it('respects server partner access even if the owner prop is stale', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...OWNER, access: 'partner', evidence: SAMPLE_EVIDENCE });
    render(<TacticEvidenceModal tacticId={10} week={1} tacticTitle="הרגל יומי" isOwner onClose={vi.fn()} />);
    expect(await screen.findByText('עבדתי שעה')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שמירה' })).not.toBeInTheDocument();
  });
});
