import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CycleHistoryTab } from '../components/CycleHistoryTab';
import { api, ApiError } from '../lib/api';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import type { CycleHistoryDetailResponse } from '../lib/types';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('../components/Timeline', () => ({ Timeline: () => null }));
vi.mock('../components/ScoreSummary', () => ({ ScoreSummary: () => null }));
vi.mock('../components/EvidenceGallery', () => ({ EvidenceGallery: () => null }));
vi.mock('../components/ExecutionHeatmap', () => ({ ExecutionHeatmap: ({ userId, cycleId }: { userId: number; cycleId: number }) => <div data-testid="heatmap" data-user={userId} data-cycle={cycleId} /> }));
vi.mock('../components/CyclePlanningPanel', () => ({ CyclePlanningPanel: ({ isOwner }: { isOwner: boolean }) => <div data-testid="planning" data-owner={isOwner} /> }));
vi.mock('../components/GoalsPanel', () => ({ GoalsPanel: ({ isOwner }: { isOwner: boolean }) => <div data-testid="goals" data-owner={isOwner} /> }));
vi.mock('../components/WeeklyGrid', () => ({ WeeklyGrid: ({ isOwner, week }: { isOwner: boolean; week: number }) => <div data-testid="grid" data-owner={isOwner} data-week={week} /> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const selection: Extract<ArchiveSearchTarget, { kind: 'cycle' }> = {
  kind: 'cycle', userId: 7, cycleId: 11, week: 8, goalId: 21, tacticId: 31,
};

function detail(id = 11, isActive = false): CycleHistoryDetailResponse {
  return {
    access: 'owner',
    cycle: {
      id, name: `מחזור ${id}`, currentWeek: 12, isActive, vision: '', successDefinition: '', whyItMatters: '',
      blockers: '', risks: '', lagMeasures: '', leadMeasures: '', notes: '', createdAt: '', updatedAt: '',
    },
    goals: [{
      id: 21, title: 'מטרה שנמצאה', color: 'emerald',
      tactics: [{ id: 31, title: 'טקטיקה שנמצאה', weekdays: [1], startWeek: 8, endWeek: 10, completions: [] }],
    }],
    weekScores: [], averageScore: null,
  };
}
function setupApi(data = detail()) {
  vi.mocked(api.get).mockImplementation(async (path) => path === '/cycles/7' ? { access: 'owner', cycles: [data.cycle] } : data);
}

describe('CycleHistoryTab archive navigation', () => {
  it('emits exact controlled cycle/week selections and follows external Back/Forward props', async () => {
    setupApi();
    const onSelectionChange = vi.fn();
    const { rerender } = render(<CycleHistoryTab targetUserId={7} onSelectionChange={onSelectionChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'צפייה' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cycle', userId: 7, cycleId: 11, week: 1 }));
    rerender(<CycleHistoryTab targetUserId={7} selection={selection} onSelectionChange={onSelectionChange} />);
    expect(await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('8');
    fireEvent.change(screen.getByLabelText('בחירת שבוע להצגה במחזור ההיסטורי'), { target: { value: '9' } });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ ...selection, week: 9 });
    rerender(<CycleHistoryTab targetUserId={7} onSelectionChange={onSelectionChange} />);
    expect(await screen.findByText('כל המחזורים (1)')).toBeInTheDocument();
    rerender(<CycleHistoryTab targetUserId={7} selection={{ ...selection, week: 9 }} onSelectionChange={onSelectionChange} />);
    expect(await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('9');
    fireEvent.click(screen.getByRole('button', { name: /חזרה לרשימת המחזורים/ }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it.each([{ userId: 7, cycleId: 11, active: false }, { userId: 8, cycleId: 12, active: true }])(
    'lazily opens the viewed cycle heatmap with exact authorized context %j',
    async ({ userId, cycleId, active }) => {
      const data = detail(cycleId, active);
      vi.mocked(api.get).mockImplementation(async (path) => path === `/cycles/${userId}`
        ? { access: 'partner', cycles: [data.cycle] } : { ...data, access: 'partner' });
      render(<CycleHistoryTab targetUserId={userId} selection={{ ...selection, userId, cycleId }} />);
      const summary = await screen.findByText('מפת הביצוע היומי לכל המחזור · תאריכים משוערים');
      expect(screen.queryByTestId('heatmap')).not.toBeInTheDocument();
      fireEvent.click(summary);
      const heatmap = await screen.findByTestId('heatmap');
      expect(heatmap).toHaveAttribute('data-user', String(userId));
      expect(heatmap).toHaveAttribute('data-cycle', String(cycleId));
      fireEvent.click(summary);
      await waitFor(() => expect(screen.queryByTestId('heatmap')).not.toBeInTheDocument());
      expect(api.post).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])('opens the exact cycle/week and focuses its matched tactic read-only (active=%s)', async (isActive) => {
    setupApi(detail(11, isActive));
    render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    const match = await screen.findByRole('region', { name: 'תוצאת החיפוש במחזור' });
    expect(within(match).getByRole('heading', { name: 'טקטיקה שנמצאה' })).toBeInTheDocument();
    expect(within(match).getByText(/מטרה: מטרה שנמצאה/)).toBeInTheDocument();
    expect(match).toHaveFocus();
    expect(api.get).toHaveBeenCalledWith('/cycles/7/11');
    expect(screen.getByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('8');
    for (const name of ['planning', 'goals', 'grid']) expect(screen.getByTestId(name)).toHaveAttribute('data-owner', 'false');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-week', '8');
    fireEvent.change(screen.getByLabelText('בחירת שבוע להצגה במחזור ההיסטורי'), { target: { value: '9' } });
    expect(screen.getByTestId('grid')).toHaveAttribute('data-week', '9');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('focuses a goal-only result and leaves the cycle current week unchanged', async () => {
    setupApi();
    render(<CycleHistoryTab targetUserId={7} selection={{ ...selection, tacticId: undefined }} />);
    const match = await screen.findByRole('region', { name: 'תוצאת החיפוש במחזור' });
    expect(within(match).getByRole('heading', { name: 'מטרה שנמצאה' })).toBeInTheDocument();
    expect(match).toHaveFocus();
    expect(screen.getByText(/שבוע אחרון שנרשם: 12/)).toBeInTheDocument();
  });

  it('Back stays on the list when the parent recreates the same selection object', async () => {
    setupApi();
    const { rerender } = render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    await screen.findByRole('region', { name: 'תוצאת החיפוש במחזור' });
    fireEvent.click(screen.getByRole('button', { name: /חזרה לרשימת המחזורים/ }));
    expect(await screen.findByRole('heading', { name: 'כל המחזורים (1)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'היסטוריית מחזורים' })).toHaveFocus();
    rerender(<CycleHistoryTab targetUserId={7} selection={{ ...selection }} />);
    expect(screen.queryByRole('region', { name: 'תוצאת החיפוש במחזור' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'כל המחזורים (1)' })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/cycles/7/11')).toHaveLength(1);
    // Existing manual history navigation still opens normally after dismissing a search result.
    fireEvent.click(screen.getByRole('button', { name: 'צפייה' }));
    await screen.findByRole('heading', { name: 'מחזור 11' });
    expect(screen.getByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('1');
  });

  it.each([403, 404])('shows an actionable error rather than an endless spinner for HTTP %s', async (status) => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/cycles/7') return { access: 'owner', cycles: [detail().cycle] };
      throw new ApiError('אין גישה למחזור', status);
    });
    render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('אין גישה למחזור');
    expect(screen.queryByText('טוען מחזור...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeInTheDocument();
    setupApi();
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('region', { name: 'תוצאת החיפוש במחזור' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not let an independent history-list error block an authorized direct cycle result', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/cycles/7') throw new ApiError('list unavailable', 500);
      return detail();
    });
    render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    expect(await screen.findByRole('region', { name: 'תוצאת החיפוש במחזור' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /חזרה לרשימת המחזורים/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('list unavailable');
    setupApi();
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('heading', { name: 'כל המחזורים (1)' })).toBeInTheDocument();
  });

  it.each([{ goalId: 999 }, { tacticId: 999 }])('shows missing nested result %j without substituting another goal/tactic', async (overrides) => {
    setupApi();
    render(<CycleHistoryTab targetUserId={7} selection={{ ...selection, ...overrides }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('המטרה או הטקטיקה שחיפשתם אינה נמצאת');
    expect(screen.queryByRole('heading', { name: 'טקטיקה שנמצאה' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הצגת כל המחזור' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מחזור 11' })).toBeInTheDocument();
  });

  it('rejects mismatched owner context without requesting the cycle under a different user', async () => {
    setupApi();
    render(<CycleHistoryTab targetUserId={8} selection={selection} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('אינה תואמת למשתמש');
    expect(api.get).not.toHaveBeenCalledWith('/cycles/8/11');
  });

  it('ignores an old cycle response after navigating to a newer selection', async () => {
    let resolveOld!: (value: CycleHistoryDetailResponse) => void;
    const old = new Promise<CycleHistoryDetailResponse>((resolve) => { resolveOld = resolve; });
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/cycles/7') return { access: 'owner', cycles: [detail().cycle, detail(12, true).cycle] };
      return path === '/cycles/7/11' ? old : detail(12, true);
    });
    const { rerender } = render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    expect(screen.getByText('טוען מחזור...')).toBeInTheDocument();
    rerender(<CycleHistoryTab targetUserId={7} selection={{ ...selection, cycleId: 12, week: 9 }} />);
    await screen.findByRole('heading', { name: 'מחזור 12' });
    await act(async () => resolveOld(detail()));
    expect(screen.queryByRole('heading', { name: 'מחזור 11' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('9');
    expect(screen.getByRole('region', { name: 'תוצאת החיפוש במחזור' })).toHaveFocus();
  });

  it('allows Back during loading and ignores the delayed detail response', async () => {
    let resolve!: (value: CycleHistoryDetailResponse) => void;
    const pending = new Promise<CycleHistoryDetailResponse>((done) => { resolve = done; });
    vi.mocked(api.get).mockImplementation(async (path) => path === '/cycles/7'
      ? { access: 'owner', cycles: [detail().cycle] } : pending);
    render(<CycleHistoryTab targetUserId={7} selection={selection} />);
    fireEvent.click(screen.getByRole('button', { name: /חזרה לרשימת המחזורים/ }));
    await screen.findByRole('heading', { name: 'כל המחזורים (1)' });
    await act(async () => resolve(detail()));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'תוצאת החיפוש במחזור' })).not.toBeInTheDocument());
  });
});
