import type { RequestHandler } from 'express';
import cors from 'cors';
import { tReq } from '../lib/i18n/index.js';
import { getAllowedRequestOrigins } from '../config.js';

/** SameSite cookies do not protect against an attacker-controlled sibling origin. Check
 *  exact origins before any route (including simple requests that need no preflight). */
export function createOriginGuard(): RequestHandler[] {
  const allowed = getAllowedRequestOrigins();
  const guard: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const fetchSite = req.headers['sec-fetch-site'];
    if (
      (origin !== undefined && !allowed.has(origin)) ||
      (origin === undefined && unsafe && (fetchSite === 'cross-site' || fetchSite === 'same-site'))
    ) {
      res.status(403).json({ error: tReq(req, 'api.origin.forbidden') });
      return;
    }
    next();
  };
  return [
    guard,
    cors({
      origin: (origin, cb) => cb(null, origin !== undefined && allowed.has(origin) ? origin : false),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Evidence-Filename'],
    }),
  ];
}
