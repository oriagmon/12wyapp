import Database from 'better-sqlite3';
import { config } from './config.js';

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!instance) {
    instance = new Database(config.dbPath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
  }
  return instance;
}

/** Used by tests to point the module at a fresh, isolated database file/connection. */
export function setDb(db: Database.Database): void {
  instance = db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
