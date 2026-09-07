import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

export interface SessionRow {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createSession(db: Database.Database, userId: number): { token: string; expiresAt: Date } {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt.toISOString()
  );
  return { token, expiresAt };
}

/** SELECT-only validation for final credential transactions (never cleans up sessions). */
export function getValidSession(db: Database.Database, token: unknown, nowMs = Date.now()): SessionRow | undefined {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return undefined;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;
  if (!row || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= nowMs) return undefined;
  return row;
}

export function getSession(db: Database.Database, token: string): SessionRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;
  if (!row) return undefined;
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return undefined;
  }
  return row;
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Revokes every other active session for this user, preserving only `keepToken` (the
 *  caller's current session) — used after a password change so it takes effect everywhere
 *  else immediately without logging the user out of their own current session. */
export function destroyOtherSessions(db: Database.Database, userId: number, keepToken: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
}

/** Revokes every active session for this user, with no session to preserve — used after a
 *  password *reset* (as opposed to an authenticated in-session change), since the caller
 *  performing a reset is never logged in to begin with; every existing session, wherever it
 *  is, must end. */
export function destroyAllSessions(db: Database.Database, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
