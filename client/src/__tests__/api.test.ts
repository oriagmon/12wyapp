import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';

/**
 * Regression coverage for the request()/options merge order in api.ts: the default
 * 'Content-Type: application/json' must survive for ordinary JSON calls, while a caller that
 * explicitly supplies its own Content-Type (like putBinary, for raw avatar uploads) must have
 * that header win outright — never end up with both a stale default and the override, and
 * never silently lose the override back to the default.
 */
describe('api request header merging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(responseBody: unknown = {}) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('ordinary JSON requests (e.g. PATCH) default to Content-Type: application/json and include credentials', async () => {
    const fetchMock = mockFetchOnce();
    await api.patch('/profile', { displayName: 'x' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('putBinary overrides Content-Type to the given type, with no leftover default application/json', async () => {
    const fetchMock = mockFetchOnce();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await api.putBinary('/profile/avatar', blob, 'image/png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('image/png');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include'); // defaults are preserved alongside the override
    expect(init.body).toBe(blob);
  });
});
