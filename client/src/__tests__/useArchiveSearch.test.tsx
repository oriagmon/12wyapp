import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { api, ApiError } from '../lib/api';
import type { ArchiveSearchResponse } from '../lib/archiveSearchTypes';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: { get: vi.fn() } };
});
afterEach(() => vi.clearAllMocks());

const response = (query: string): ArchiveSearchResponse => ({ query, limit: 5, totalCount: 0, groups: [] });
function deferred() {
  let resolve!: (value: ArchiveSearchResponse) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ArchiveSearchResponse>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('useArchiveSearch', () => {
  it('waits for explicit submission and safely encodes literal Hebrew/wildcard input', async () => {
    vi.mocked(api.get).mockResolvedValue(response('שלום %_\\'));
    const { result } = renderHook(() => useArchiveSearch());
    expect(result.current.status).toBe('idle');
    act(() => result.current.changeQuery('  שלום %_\\  '));
    expect(api.get).not.toHaveBeenCalled();
    await act(() => result.current.search());
    expect(api.get).toHaveBeenCalledWith(`/archive-search?q=${encodeURIComponent('שלום %_\\')}`);
    expect(result.current.status).toBe('ready');
  });

  it('ignores an older success after a new search completes', async () => {
    const old = deferred();
    const latest = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery('old'));
    let first!: Promise<void>;
    act(() => { first = result.current.search(); });
    expect(result.current.status).toBe('loading');
    act(() => result.current.changeQuery('new'));
    let second!: Promise<void>;
    act(() => { second = result.current.search(); });
    await act(async () => { latest.resolve(response('new')); await second; });
    await act(async () => { old.resolve(response('old')); await first; });
    expect(result.current.data?.query).toBe('new');
    expect(result.current.status).toBe('ready');
  });

  it('ignores stale failures after input changes, even without submitting again', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery('old'));
    let first!: Promise<void>;
    act(() => { first = result.current.search(); });
    act(() => result.current.changeQuery('draft'));
    await act(async () => { old.reject(new Error('stale error')); await first; });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it('does not restore results after clearing or unmounting', async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise);
    const { result, unmount } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery('old'));
    let first!: Promise<void>;
    act(() => { first = result.current.search(); });
    act(() => result.current.changeQuery(''));
    unmount();
    await act(async () => { old.resolve(response('old')); await first; });
    expect(result.current.data).toBeNull();
  });

  it('ignores a stale success while the newest search is still loading', async () => {
    const old = deferred();
    const latest = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery('old'));
    let first!: Promise<void>;
    act(() => { first = result.current.search(); });
    act(() => result.current.changeQuery('new'));
    let second!: Promise<void>;
    act(() => { second = result.current.search(); });
    await act(async () => { old.resolve(response('old')); await first; });
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
    await act(async () => { latest.resolve(response('new')); await second; });
    expect(result.current.data?.query).toBe('new');
  });

  it.each(['', '   ', 'x'.repeat(121), 'hello\nworld', '\0x'])('validates %j without sending a request', async (query) => {
    const { result } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery(query));
    await act(() => result.current.search());
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeTruthy();
  });

  it('surfaces current API errors and permits retry without stale data', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError('אין הרשאה', 403)).mockResolvedValueOnce(response('hello'));
    const { result } = renderHook(() => useArchiveSearch());
    act(() => result.current.changeQuery('hello'));
    await act(() => result.current.search());
    expect(result.current.error).toBe('אין הרשאה');
    expect(result.current.data).toBeNull();
    await act(() => result.current.search());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
  });
});
