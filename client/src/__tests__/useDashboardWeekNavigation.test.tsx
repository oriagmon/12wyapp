import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboard } from '../hooks/useDashboard';
import { api } from '../lib/api';
import type { DashboardBundle } from '../lib/types';

const { refreshUser } = vi.hoisted(() => ({ refreshUser: vi.fn() }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1 }, refreshUser }),
}));
vi.mock('../lib/api', () => ({
  ApiError: Error,
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function bundle(currentWeek = 2, access: DashboardBundle['access'] = 'owner'): DashboardBundle {
  return {
    access, targetEmail: 'example@example.test', goals: [], weekScores: [], averageScore: null,
    cycle: {
      id: 1, name: 'Example', currentWeek, isActive: true, vision: '', successDefinition: '',
      whyItMatters: '', blockers: '', risks: '', lagMeasures: '', leadMeasures: '',
      notes: '', createdAt: '', updatedAt: '',
    },
  };
}

describe('useDashboard URL-controlled viewed weeks', () => {
  it('restores the URL week before async data and preserves it across data reloads', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle());
    const onViewedWeekChange = vi.fn();
    const { result, rerender } = renderHook(({ week }) =>
      useDashboard(1, { viewedWeek: week, onViewedWeekChange }),
    { initialProps: { week: 9 as number | null } });
    expect(result.current.viewedWeek).toBe(9);
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    vi.mocked(api.get).mockResolvedValue(bundle(7));
    await act(async () => { await result.current.reload(); });
    expect(result.current.viewedWeek).toBe(9);
    expect(onViewedWeekChange).not.toHaveBeenCalled();
    rerender({ week: 3 });
    expect(result.current.viewedWeek).toBe(3);
  });

  it('uses current cycle week only when a URL week is absent, without writing navigation', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle(6));
    const onViewedWeekChange = vi.fn();
    const { result } = renderHook(() => useDashboard(1, { viewedWeek: null, onViewedWeekChange }));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.viewedWeek).toBe(6);
    expect(onViewedWeekChange).not.toHaveBeenCalled();
  });

  it('sends valid user-selected weeks to the URL owner without locally overriding the controlled week', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle());
    const onViewedWeekChange = vi.fn();
    const { result } = renderHook(() => useDashboard(1, { viewedWeek: 4, onViewedWeekChange }));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    act(() => {
      result.current.setViewedWeek(8);
      result.current.setViewedWeek(0);
      result.current.setViewedWeek(13);
      result.current.setViewedWeek(1.5);
      result.current.setViewedWeek(4);
    });
    expect(onViewedWeekChange).toHaveBeenCalledTimes(1);
    expect(onViewedWeekChange).toHaveBeenCalledWith(8);
    expect(result.current.viewedWeek).toBe(4);
  });

  it('never fetches an own fallback while a bookmarked partner is unresolved', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle(2, 'partner'));
    const navigation = { viewedWeek: 10, onViewedWeekChange: vi.fn() };
    const { result, rerender } = renderHook(({ target }) => useDashboard(target, navigation), {
      initialProps: { target: null as number | null },
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.bundle).toBeNull();
    rerender({ target: 2 });
    await waitFor(() => expect(result.current.bundle?.access).toBe('partner'));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/dashboard/2');
    expect(result.current.viewedWeek).toBe(10);
  });

  it('hides the previous board immediately when the requested board becomes unavailable', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle(2, 'partner'));
    const { result, rerender } = renderHook(({ target }) => useDashboard(target), {
      initialProps: { target: 2 as number | null },
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    rerender({ target: null });
    expect(result.current.bundle).toBeNull();
    expect(result.current.loadStatus).toBe('loading');
  });

  it('keeps the previous uncontrolled API working for WAM and other existing consumers', async () => {
    vi.mocked(api.get).mockResolvedValue(bundle());
    const { result } = renderHook(() => useDashboard(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    act(() => result.current.setViewedWeek(7));
    await act(async () => { await result.current.reload(); });
    expect(result.current.viewedWeek).toBe(7);
  });
});
