import { LOCALE_TAGS } from '../i18n/locales';
import { getActiveLocale } from '../i18n/activeLocale';
import { translateActive } from '../i18n';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    // Spread `options` first, then set `headers` last: this guarantees the default
    // 'Content-Type: application/json' always survives unless a caller's own `options.headers`
    // explicitly overrides it (e.g. putBinary's raw-upload Content-Type below), while still
    // preserving any other headers a caller may pass alongside it. Spreading `options` after
    // this merged `headers` object (the previous order) would silently discard the merge and
    // fall back to the caller's raw, un-merged headers.
    headers: {
      'Content-Type': 'application/json',
      // Lets the server localise its error messages to whatever the UI is currently showing,
      // so a validation failure never comes back in the wrong language.
      'Accept-Language': LOCALE_TAGS[getActiveLocale()],
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? translateActive('common.error.server', { status: res.status });
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data === undefined ? undefined : JSON.stringify(data) }),
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'DELETE', body: data === undefined ? undefined : JSON.stringify(data) }),
  /** Raw-body PUT for binary uploads (e.g. the profile avatar, tactic evidence files) — sends
   *  `body` as-is with the given Content-Type instead of JSON-encoding it, since `request()`'s
   *  default JSON header would otherwise corrupt binary data. `extraHeaders` lets a caller
   *  carry small out-of-band metadata a raw binary body has no other place for (e.g. the
   *  original filename for tactic evidence) without a multipart/base64/JSON dependency. */
  putBinary: <T>(path: string, body: Blob | ArrayBuffer, contentType: string, extraHeaders: Record<string, string> = {}) =>
    request<T>(path, { method: 'PUT', headers: { 'Content-Type': contentType, ...extraHeaders }, body }),
  postBinary: <T>(path: string, body: Blob | ArrayBuffer, contentType: string, extraHeaders: Record<string, string> = {}) =>
    request<T>(path, { method: 'POST', headers: { 'Content-Type': contentType, ...extraHeaders }, body }),
};
