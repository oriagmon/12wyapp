import type { Request } from 'express';
import { config } from '../config.js';

/**
 * Cookies are host-only unless the response explicitly sends a Domain attribute.
 * Scoping the session cookie to a shared parent domain is what lets sibling hosts
 * (the dashboard on `<parent>` and the gym tracker on `gymtracker.<parent>`) share
 * a single login instead of prompting twice.
 *
 * The Domain is only emitted when the requested host actually sits inside that
 * domain. A browser silently DISCARDS a Set-Cookie whose Domain does not cover the
 * host it came from, so sending it unconditionally would break login outright on
 * every other hostname this deployment still answers on (the legacy Azure name).
 * Falling back to a host-only cookie keeps those hosts working exactly as before.
 */
export function sessionCookieDomain(req: Request): string | undefined {
  const domain = config.sessionCookieDomain;
  if (domain.length === 0) return undefined;
  const host = (req.hostname || '').toLowerCase();
  if (host.length === 0) return undefined;
  return host === domain || host.endsWith(`.${domain}`) ? domain : undefined;
}

/**
 * Attributes that must be identical when setting AND clearing the cookie — a
 * clearCookie whose path/domain differ from the original leaves the cookie in
 * place, which would strand a user in a half-logged-out state.
 */
export function sessionCookieScope(req: Request): { path: string; domain?: string } {
  const domain = sessionCookieDomain(req);
  return domain === undefined ? { path: '/' } : { path: '/', domain };
}
