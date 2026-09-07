/**
 * Reads a password-reset token off the current URL, if present, and immediately strips it
 * back out of the visible address bar via history.replaceState — so it never lingers in
 * browser history, gets accidentally shared (e.g. via a screenshot or copied URL), survives a
 * page refresh, or is ever written to localStorage/sessionStorage (the caller only ever holds
 * it in component state, for exactly as long as the reset flow is in progress).
 *
 * New links carry the token in the URL *fragment* (`#resetToken=...`) — fragments are never
 * sent to the server by a browser, so they never appear in a reverse proxy's access log or in
 * the `Referer` header of any subsequent cross-origin navigation from the reset page. Older
 * already-sent emails may still use a legacy `?resetToken=...` query-string link, which is
 * still supported for backward compatibility. If both are somehow present, the fragment wins.
 *
 * This must be called from a component that always mounts regardless of auth state (see
 * App.tsx) — a currently-logged-in user opening a reset link must still see the reset UI.
 */
export function readAndClearResetTokenFromUrl(): string | null {
  const hashString = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hashString);
  const fromHash = hashParams.get('resetToken');

  const queryParams = new URLSearchParams(window.location.search);
  const fromQuery = queryParams.get('resetToken');

  const token = fromHash ?? fromQuery;
  if (!token) return null;

  if (fromHash !== null) hashParams.delete('resetToken');
  if (fromQuery !== null) queryParams.delete('resetToken');

  const newSearch = queryParams.toString();
  const newHash = hashParams.toString();
  const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${newHash ? `#${newHash}` : ''}`;
  window.history.replaceState(null, '', newUrl);

  return token;
}
