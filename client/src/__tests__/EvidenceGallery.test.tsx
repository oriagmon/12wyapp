import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceGallery } from '../components/EvidenceGallery';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ ApiError: class extends Error {}, api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const item = {
  id: 1, cycleId: 5, week: 1, tacticId: null, weekday: null, scope: 'week', tacticTitle: null, goalTitle: null,
  note: 'whole week', link: null, hasFile: false, fileOriginalName: null, fileMime: null, fileSize: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
describe('EvidenceGallery', () => {
  it('reads all cycle albums and every legacy entry without editor controls', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'owner', items: [
      item,
      { ...item, id: 2, tacticId: 10, scope: 'tactic-day', weekday: 0, tacticTitle: 'legacy tactic', note: 'old daily' },
      { ...item, id: 3, week: 2, note: 'second week' },
    ] });
    render(<EvidenceGallery cycleId={5} />);
    expect(await screen.findByText('whole week')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/week-evidence/5');
    expect(screen.getByText('old daily')).toBeInTheDocument();
    expect(screen.getByText('second week')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^אלבום שבוע/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'מחיקת הפריט' })).not.toBeInTheDocument();
  });
  it('shows empty and error states', async () => {
    vi.mocked(api.get).mockResolvedValue({ access: 'partner', items: [] });
    const { rerender } = render(<EvidenceGallery cycleId={5} />);
    expect(await screen.findByText(/עדיין אין תמונות/)).toBeInTheDocument();
    vi.mocked(api.get).mockRejectedValue(new Error('denied'));
    rerender(<EvidenceGallery cycleId={6} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('denied');
  });
});
