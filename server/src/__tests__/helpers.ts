import Database from 'better-sqlite3';
import { setDb, closeDb } from '../db.js';
import { runMigrations } from '../migrate.js';
import { createApp } from '../app.js';

/** Creates a fresh in-memory SQLite database with migrations applied, wires it into the
 *  app's db singleton, and returns a ready-to-use supertest-able Express app. */
export function freshApp() {
  closeDb();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return createApp();
}

export function extractCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  if (!setCookie || setCookie.length === 0) throw new Error('no set-cookie header in response');
  return setCookie[0].split(';')[0];
}
