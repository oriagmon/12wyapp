import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import { useExecutionHeatmap } from '../hooks/useExecutionHeatmap';
import type { ExecutionHeatmapResponse } from '../lib/executionHeatmapTypes';
import { heatmapFixture } from './executionHeatmapFixtures';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
  }
  return { api: { get: vi.fn() }, ApiError };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('useExecutionHeatmap read-only loading', () => {
  it('loads the active cycle by default and the explicit archive when selected', async () => {
    vi.mocked(api.get).mockResolvedValue(heatmapFixture());
    const { result, rerender } = renderHook(({ cycleId }: { cycleId?: number }) => useExecutionHeatmap(1, cycleId), { initialProps: {} });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(api.get).toHaveBeenCalledWith('/execution-heatmap/1');
    rerender({ cycleId: 7 });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(api.get).toHaveBeenLastCalledWith('/execution-heatmap/1?cycleId=7');
  });

  it('does not request data for a null user', () => {
    const { result } = renderHook(() => useExecutionHeatmap(null));
    expect(result.current.loadStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('refreshes in place after mutations without a loading flash', async () => {
    vi.mocked(api.get).mockResolvedValue(heatmapFixture());
    const { result, rerender } = renderHook(({ signal }) => useExecutionHeatmap(1, undefined, signal), { initialProps: { signal: 1 } });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    rerender({ signal: 2 });
    expect(result.current.loadStatus).toBe('ready');
    expect(result.current.data?.cycle?.id).toBe(7);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('never exposes a stale response when switching user or archive', async () => {
    let resolveFirst!: (data: ExecutionHeatmapResponse) => void;
    let resolveSecond!: (data: ExecutionHeatmapResponse) => void;
    vi.mocked(api.get)
      .mockImplementationOnce(() => new Promise<ExecutionHeatmapResponse>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<ExecutionHeatmapResponse>((resolve) => { resolveSecond = resolve; }));
    const { result, rerender } = renderHook(({ id }) => useExecutionHeatmap(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    expect(result.current.data).toBeNull();
    await act(async () => { resolveSecond({ ...heatmapFixture(), access: 'partner' }); });
    expect(result.current.data?.access).toBe('partner');
    await act(async () => { resolveFirst(heatmapFixture()); });
    expect(result.current.data?.access).toBe('partner');
  });

  it('hides already-loaded data immediately on target change and when access is revoked', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(heatmapFixture()).mockRejectedValue(new ApiError('אין הרשאה', 403));
    const { result, rerender } = renderHook(({ id }) => useExecutionHeatmap(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    rerender({ id: 2 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBe('אין הרשאה');
    expect(result.current.data).toBeNull();
  });

  it('also discards stale data when a same-user background refresh is denied', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(heatmapFixture()).mockRejectedValue(new ApiError('אין הרשאה', 403));
    const { result } = renderHook(() => useExecutionHeatmap(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.data).toBeNull();
  });

  it('supports retry and clears an earlier error after success', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(heatmapFixture());
    const { result } = renderHook(() => useExecutionHeatmap(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBe('לא הצלחנו לטעון את מפת הביצוע');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.loadError).toBeNull();
  });

  it.each(['2026-09-01T20:59:59Z', '2026-03-26T21:59:59Z', '2026-10-25T21:59:59Z'])(
    'automatically refreshes at the next Israel midnight including DST at %s', async (instant) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      vi.mocked(api.get).mockResolvedValue(heatmapFixture());
      const { result } = renderHook(() => useExecutionHeatmap(1));
      await act(async () => {});
      expect(result.current.loadStatus).toBe('ready');
      await act(async () => { await vi.advanceTimersByTimeAsync(1_101); });
      expect(api.get).toHaveBeenCalledTimes(2);
    }
  );

  it('refreshes on window focus and removes listeners when unmounted', async () => {
    vi.mocked(api.get).mockResolvedValue(heatmapFixture());
    const { result, unmount } = renderHook(() => useExecutionHeatmap(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(api.get).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
