/**
 * Where to send someone after they sign in, when they arrived from somewhere else.
 *
 * The gym tracker runs on its own hostname but shares this login, so signing in there sends
 * people over here — and then leaves them staring at the dashboard instead of the workout
 * they were about to log. This carries them back.
 *
 * The target is validated against this deployment's own hostnames rather than trusted as
 * given. An unchecked redirect parameter is a textbook open redirect, and a sign-in screen is
 * precisely where one gets weaponised: a link that really does land on the genuine login page
 * is exactly what makes the next hop convincing.
 */

const RETURN_PARAM = 'next';

function isTrustedTarget(url: URL): boolean {
  if (url.origin === window.location.origin) return true;

  // Anything off-origin has to be one of ours, over TLS.
  if (url.protocol !== 'https:') return false;
  return url.hostname === '12wy.duckdns.org' || url.hostname.endsWith('.12wy.duckdns.org');
}

export function readReturnTarget(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(RETURN_PARAM);
    if (!raw) return null;

    const url = new URL(raw, window.location.origin);
    return isTrustedTarget(url) ? url.toString() : null;
  } catch {
    return null;
  }
}
