import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';

function resolveDataDir(): string {
  const configured = process.env.DATA_DIR;
  const dir = configured && configured.trim().length > 0
    ? path.resolve(configured)
    : path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  dataDir: resolveDataDir(),
  get dbPath(): string {
    return path.join(this.dataDir, process.env.DB_FILE || 'app.sqlite');
  },
  /** Directory tactic-evidence file bytes are stored under (see lib/tacticEvidence.ts) — a
   *  getter (like `dbPath` above), not a value resolved once at import time, specifically so
   *  tests can point it at a fresh, isolated temp directory per test via `EVIDENCE_DIR`
   *  without needing to reload this whole module. Defaults to `<dataDir>/evidence` in
   *  production, alongside the SQLite file itself (see `.env.example`/README for the
   *  production path and the operational implication: a file-level backup of `DATA_DIR` alone
   *  does not include this directory unless it's nested inside it, as it is by default).
   *  Deliberately side-effect-free (never creates/chmods the directory itself) — see
   *  `ensureEvidenceDir()` in lib/tacticEvidence.ts, called once at server startup and again
   *  defensively before every file write, for that. */
  get evidenceDir(): string {
    const configured = process.env.EVIDENCE_DIR;
    return configured && configured.trim().length > 0 ? path.resolve(configured) : path.join(this.dataDir, 'evidence');
  },
  sessionCookieName: 'session_token',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  /** Parent domain the session cookie is scoped to, enabling one login across sibling
   *  hosts (e.g. the dashboard and the gym tracker). Empty means host-only cookies.
   *  Normalised here so a leading dot or stray case cannot cause a silent mismatch. */
  sessionCookieDomain: (process.env.SESSION_COOKIE_DOMAIN || '').trim().replace(/^\./, '').toLowerCase(),
  clientDistPath: path.resolve(process.cwd(), '..', 'client', 'dist'),
  /** Built bundle of the gym tracker. It is a separate Vite app rather than a route inside
   *  the main client because it is a different tool with a different rhythm — you open it
   *  mid-set, on a phone, one-handed — but it is served from this origin so it inherits the
   *  session cookie and needs no login of its own. */
  gymDistPath: path.resolve(process.cwd(), '..', 'gym', 'dist'),
};

export function getAllowedRequestOrigins(): ReadonlySet<string> {
  const production = config.nodeEnv === 'production';
  const raw = process.env.APP_PUBLIC_URL;
  const allowed = new Set<string>();
  if (raw !== undefined) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new Error('APP_PUBLIC_URL must be an absolute HTTP(S) URL (HTTPS in production)');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hostname.includes('*') || /[\s\\]/.test(raw.trim()) || (production && url.protocol !== 'https:')) {
      throw new Error('APP_PUBLIC_URL must be an absolute HTTP(S) URL without credentials or wildcards (HTTPS in production)');
    }
    allowed.add(url.origin);
  } else if (production) {
    throw new Error('APP_PUBLIC_URL is required in production for exact-origin request validation');
  }
  // Additional exact origins the same deployment also answers on (e.g. a dedicated
  // hostname for the gym tracker, or a legacy hostname kept alive during a move).
  // Same validation as APP_PUBLIC_URL: exact origins only, never wildcards.
  for (const entry of (process.env.APP_EXTRA_ORIGINS || '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    let extra: URL;
    try {
      extra = new URL(trimmed);
    } catch {
      throw new Error('APP_EXTRA_ORIGINS entries must each be an absolute HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(extra.protocol) || extra.username || extra.password ||
      extra.hostname.includes('*') || /[\s\\]/.test(trimmed) || (production && extra.protocol !== 'https:')) {
      throw new Error('APP_EXTRA_ORIGINS entries must be absolute HTTP(S) URLs without credentials or wildcards (HTTPS in production)');
    }
    allowed.add(extra.origin);
  }
  if (!production) {
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of [5173, config.port]) allowed.add(`http://${host}:${port}`);
    }
  }
  return allowed;
}

export interface EmailConfig {
  /** Azure Communication Services "Keys" connection string for the Email resource. */
  connectionString: string;
  /** Verified sender address from the ACS Email domain (or a verified custom domain). */
  senderAddress: string;
  /** Public URL of the deployed app, linked from the reminder email body. */
  appUrl: string;
}

/**
 * Reads the ACS Email env vars, throwing if any are missing/blank. Called by the standalone
 * WAM/scheduled-reminder CLIs (see sendWamReminders.ts, sendScheduledReminders.ts) **and** by
 * the main web server's POST /api/auth/forgot-password route — the only place the live
 * request path itself sends email. That route always catches this (and any send failure)
 * itself and never lets it affect its response. Missing provider credentials only disable
 * delivery (logged server-side); APP_PUBLIC_URL is separately required at production web
 * startup for exact-origin validation.
 */
export function getEmailConfig(): EmailConfig {
  const connectionString = process.env.ACS_EMAIL_CONNECTION_STRING?.trim() || '';
  const senderAddress = process.env.EMAIL_SENDER_ADDRESS?.trim() || '';
  const appUrl = process.env.APP_PUBLIC_URL?.trim() || '';
  const missing = [
    !connectionString && 'ACS_EMAIL_CONNECTION_STRING',
    !senderAddress && 'EMAIL_SENDER_ADDRESS',
    !appUrl && 'APP_PUBLIC_URL',
  ].filter((v): v is string => Boolean(v));
  if (missing.length > 0) {
    throw new Error(`missing required env var(s) for sending email: ${missing.join(', ')}`);
  }
  return { connectionString, senderAddress, appUrl };
}
