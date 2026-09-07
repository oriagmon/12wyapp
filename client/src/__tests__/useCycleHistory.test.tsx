import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCycleDetail, useCycleHistory } from '../hooks/useCycleHistory';
import { api, ApiError } from '../lib/api';
import type { CycleHistoryDetailResponse } from '../lib/types';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: { get: vi.fn() } };
});
afterEach(() => vi.clearAllMocks());

const detail = (id: number) => ({ cycle: { id } }) as CycleHistoryDetailResponse;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('cycle history request isolation', () => {
  it('does not request absent users/cycles', () => {
    const { result } = renderHook(() => ({ history: useCycleHistory(null), detail: useCycleDetail(null, null) }));
    expect(result.current.history.loading).toBe(false);
    expect(result.current.detail.loadStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('drops stale history success after changing users', async () => {
    const first = deferred();
    vi.mocked(api.get).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ access: 'owner', cycles: [{ id: 22 }] });
    const { result, rerender } = renderHook(({ id }) => useCycleHistory(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => first.resolve({ access: 'owner', cycles: [{ id: 11 }] }));
    expect(result.current.list?.cycles[0].id).toBe(22);
  });

  it('drops stale history failures and makes retry clear the current error', async () => {
    const first = deferred();
    vi.mocked(api.get).mockReturnValueOnce(first.promise).mockRejectedValueOnce(new ApiError('denied', 403));
    const { result, rerender } = renderHook(({ id }) => useCycleHistory(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.error).toBe('denied'));
    vi.mocked(api.get).mockResolvedValueOnce({ access: 'owner', cycles: [] });
    await act(() => result.current.reload());
    await act(async () => first.reject(new Error('old failure')));
    expect(result.current.error).toBeNull();
    expect(result.current.list?.cycles).toEqual([]);
  });

  it('immediately clears previous detail/errors on a new cycle and ignores stale failures', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail(22));
    const { result, rerender } = renderHook(({ id }) => useCycleDetail(1, id), { initialProps: { id: 11 } });
    rerender({ id: 22 });
    expect(result.current.detail).toBeNull();
    await waitFor(() => expect(result.current.detail?.cycle.id).toBe(22));
    await act(async () => old.reject(new ApiError('old denied', 403)));
    expect(result.current.loadStatus).toBe('ready');
    expect(result.current.loadError).toBeNull();
  });

  it('ignores a late request after Back clears the selected cycle', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useCycleDetail(1, id), { initialProps: { id: 11 as number | null } });
    rerender({ id: null });
    await act(async () => old.resolve(detail(11)));
    expect(result.current.detail).toBeNull();
    expect(result.current.loadStatus).toBe('idle');
    expect(result.current.loadError).toBeNull();
  });

  it('guards overlapping same-cycle retries and does not accept a mismatched cycle response', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail(22));
    const { result } = renderHook(() => useCycleDetail(1, 11));
    await act(() => result.current.reload());
    expect(result.current.loadStatus).toBe('error');
    await act(async () => old.resolve(detail(11)));
    expect(result.current.loadStatus).toBe('error');
    expect(result.current.detail).toBeNull();
    vi.mocked(api.get).mockResolvedValueOnce(detail(11));
    await act(() => result.current.reload());
    expect(result.current.loadStatus).toBe('ready');
    expect(result.current.loadError).toBeNull();
  });
});
