import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveSearchPanel } from '../components/ArchiveSearchPanel';
import { api } from '../lib/api';
import { ARCHIVE_SEARCH_CATEGORIES, type ArchiveSearchResponse, type ArchiveSearchTarget } from '../lib/archiveSearchTypes';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: { get: vi.fn() } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const cycleTarget: ArchiveSearchTarget = { kind: 'cycle', cycleId: 11, userId: 7, week: 8, goalId: 12, tacticId: 13 };
const wamTarget: ArchiveSearchTarget = { kind: 'wam', cycleId: 11, userId: 7, week: 3, wamId: 91, commitmentId: 92 };
const reminderTarget: ArchiveSearchTarget = { kind: 'reminder', reminderId: 31 };
function fixture(): ArchiveSearchResponse {
  return {
    query: 'שלום', limit: 5, totalCount: 10,
    groups: ARCHIVE_SEARCH_CATEGORIES.map((category) => ({
      category,
      count: category === 'tactics' ? 8 : ['commitments', 'reminders'].includes(category) ? 1 : 0,
      hasMore: category === 'tactics',
      items: ['tactics', 'commitments', 'reminders'].includes(category) ? [{
        id: category === 'tactics' ? 13 : category === 'commitments' ? 92 : 31,
        title: `שלום ${category}`, snippet: 'לפני שלום אחרי', matchedField: 'תוכן',
        cycleName: category === 'reminders' ? null : 'מחזור קודם',
        isArchived: category === 'reminders' ? null : true,
        ownership: category === 'commitments' ? 'shared' : 'mine',
        target: category === 'tactics' ? cycleTarget : category === 'commitments' ? wamTarget : reminderTarget,
      }] : [],
    })),
  };
}
function submit(query = 'שלום') {
  fireEvent.change(screen.getByRole('searchbox', { name: 'מה לחפש?' }), { target: { value: query } });
  fireEvent.submit(screen.getByRole('search'));
}

describe('ArchiveSearchPanel', () => {
  it('supports labeled keyboard search, grouped exact counts, archive context and honest truncation', async () => {
    vi.mocked(api.get).mockResolvedValue(fixture());
    render(<ArchiveSearchPanel onNavigate={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'חיפוש בכל המחזורים' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'חיפוש' })).toBeDisabled();
    expect(api.get).not.toHaveBeenCalled();
    submit();
    expect(await screen.findByText('10 תוצאות עבור ״שלום״')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'טקטיקות 8' })).toBeInTheDocument();
    expect(screen.getAllByText('ארכיון')).toHaveLength(2);
    expect(screen.getByText('מוצגות 1 מתוך 8. דייקו את החיפוש כדי להגיע לתוצאות נוספות.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('סוג תוצאה'), { target: { value: 'reminders' } });
    expect(screen.getByText('1 תוצאות בקטגוריית תזכורות עבור ״שלום״')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'טקטיקות 8' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('emits exact navigation payloads for cycle, WAM and reminder surfaces', async () => {
    vi.mocked(api.get).mockResolvedValue(fixture());
    const onNavigate = vi.fn();
    render(<ArchiveSearchPanel onNavigate={onNavigate} />);
    submit();
    await screen.findByRole('heading', { name: 'טקטיקות 8' });
    for (const name of ['טקטיקות 8', 'התחייבויות 1', 'תזכורות 1']) {
      fireEvent.click(within(screen.getByRole('region', { name })).getByRole('button'));
    }
    expect(onNavigate.mock.calls).toEqual([[cycleTarget], [wamTarget], [reminderTarget]]);
  });

  it('renders literal highlights as escaped text, never HTML or regex expressions', async () => {
    const data = fixture();
    data.query = '[%_\\]';
    const item = data.groups.find((group) => group.category === 'tactics')!.items[0];
    item.snippet = '<img src=x onerror=alert(1)> [%_\\] then [%_\\]';
    vi.mocked(api.get).mockResolvedValue(data);
    const { container } = render(<ArchiveSearchPanel onNavigate={vi.fn()} />);
    submit('[%_\\]');
    await screen.findByRole('heading', { name: 'טקטיקות 8' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(Array.from(container.querySelectorAll('mark')).map((node) => node.textContent)).toEqual(['[%_\\]', '[%_\\]']);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });

  it('shows accessible loading, failure, retry and empty states', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    render(<ArchiveSearchPanel onNavigate={vi.fn()} />);
    submit();
    expect(screen.getByRole('status')).toHaveTextContent('מחפשים במחזורים ובארכיון');
    expect(screen.getByRole('button', { name: 'חיפוש' })).toBeDisabled();
    await act(async () => reject(new Error('failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('לא ניתן לטעון תוצאות');
    const empty = fixture();
    empty.totalCount = 0;
    empty.groups = empty.groups.map((group) => ({ ...group, count: 0, hasMore: false, items: [] }));
    vi.mocked(api.get).mockResolvedValueOnce(empty);
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('לא נמצאו תוצאות'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides stale results on editing/clearing instead of labeling old data with the new query', async () => {
    vi.mocked(api.get).mockResolvedValue(fixture());
    render(<ArchiveSearchPanel onNavigate={vi.fn()} />);
    submit();
    await screen.findByRole('heading', { name: 'טקטיקות 8' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'אחר' } });
    expect(screen.queryByRole('heading', { name: 'טקטיקות 8' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'חיפוש' })).toBeDisabled();
  });
});
