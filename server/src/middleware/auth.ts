import type { Request, Response, NextFunction } from 'express';
import { tReq } from '../lib/i18n/index.js';
import { getDb } from '../db.js';
import { getSession } from '../lib/sessions.js';
import { config } from '../config.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';
import { sessionCookieScope } from '../lib/sessionCookie.js';

export interface AuthedUser {
  id: number;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[config.sessionCookieName];
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    res.status(401).json({ error: tReq(req, 'api.auth.notAuthenticated') });
    return;
  }
  const db = getDb();
  const session = getSession(db, token);
  if (!session) {
    res.clearCookie(config.sessionCookieName, sessionCookieScope(req));
    res.status(401).json({ error: tReq(req, 'api.auth.sessionExpired') });
    return;
  }
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(session.user_id) as
    | AuthedUser
    | undefined;
  if (!user || !isUserAdmitted(user.id)) {
    res.clearCookie(config.sessionCookieName, sessionCookieScope(req));
    res.status(401).json({ error: tReq(req, 'api.auth.userNotFound') });
    return;
  }
  req.user = user;
  next();
}
