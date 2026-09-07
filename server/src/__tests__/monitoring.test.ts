import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { runMigrations } from '../migrate.js';
import { createMonitoringRouter } from '../routes/monitoring.js';
import { getMonitoringSnapshot, certificateStatus, type MonitoringDependencies } from '../lib/monitoring.js';
import { readOperationalProbe, positiveSeconds } from '../lib/monitoringProbe.js';
import { MAX_PROBE_BYTES, MonitoringFileError } from '../lib/monitoringFiles.js';
import { TIMER_UNITS, type OperationalProbe } from '../lib/monitoringTypes.js';

vi.mock('../config.js', () => ({ config: { sessionCookieName: 'session_token', nodeEnv: 'test' } }));

const NOW = new Date('2026-09-05T08:00:00.000Z');
const SECRET = 'do-not-leak-user@example.invalid /private/secret.sqlite Password=sentinel SELECT secret';
const freshProbe = (): OperationalProbe => ({
  version: 1, sampledAt: NOW.toISOString(),
  timers: (Object.keys(TIMER_UNITS) as Array<keyof typeof TIMER_UNITS>).map((id) => ({ id, state: 'active', nextRunAt: '2026-09-06T08:00:00.000Z' })),
  certificate: { state: 'observed', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z' },
  fileBackup: { state: 'observed', lastSuccessAt: '2026-09-05T07:00:00.000Z' },
  cloudBackup: { state: 'not_configured', lastSuccessAt: null, archiveBytes: null },
});
const encoded = (data: unknown) => Buffer.from(JSON.stringify(data));

describe('private monitoring route and database aggregates', () => {
  let db: Database.Database;
  let deps: MonitoringDependencies;
  let queries: string[];
  beforeEach(() => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', undefined);
    queries = [];
    db = new Database(':memory:', { verbose: (sql) => queries.push(String(sql)) });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    runMigrations(db);
    log.mockRestore();
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)').run('do-not-leak-user@example.invalid', SECRET);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, ?)').run('test-session-secret', '2027-01-01T00:00:00.000Z');
    deps = {
      db: () => db, now: () => NOW, uptime: () => 1234,
      statFile: vi.fn().mockResolvedValue({ size: 2048, isFile: () => true }),
      readProbe: async (now) => readOperationalProbe({ directory: '/fake-operator-only', now, staleAfterSeconds: 900, readFile: async () => encoded(freshProbe()) }),
      probeStaleAfterSeconds: 900, backupStaleAfterSeconds: 129600,
    };
    queries.length = 0;
  });
  afterEach(() => { if (db.open) db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  function app() {
    const instance = express();
    instance.use(cookieParser());
    instance.use('/api/monitoring', createMonitoringRouter(deps));
    return instance;
  }
  const cookie = 'session_token=test-session-secret';

  it('rejects an unapproved existing cookie with SELECT-only auth before reading operational providers', async () => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', '2');
    const readProbe = vi.fn(deps.readProbe);
    deps.readProbe = readProbe;
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'authentication_required' });
    expect(readProbe).not.toHaveBeenCalled();
    expect(deps.statFile).not.toHaveBeenCalled();
    expect(queries.length).toBe(1);
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('allows an approved existing session on GET/HEAD, with no database writes', async () => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', '1');
    expect((await request(app()).get('/api/monitoring').set('Cookie', cookie)).status).toBe(200);
    const head = await request(app()).head('/api/monitoring').set('Cookie', cookie);
    expect(head.status).toBe(200);
    expect(head.text).toBeUndefined();
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('fails malformed admission configuration closed without operational access or session cleanup', async () => {
    vi.stubEnv('APP_ALLOWED_USER_IDS', '');
    const readProbe = vi.fn(deps.readProbe);
    deps.readProbe = readProbe;
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'monitoring_unavailable' });
    expect(readProbe).not.toHaveBeenCalled();
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('requires authentication before touching any operational provider', async () => {
    const readProbe = vi.fn(deps.readProbe);
    deps.readProbe = readProbe;
    const response = await request(app()).get('/api/monitoring');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'authentication_required' });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(readProbe).not.toHaveBeenCalled();
    expect(deps.statFile).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it.each(['bad', '', 'x'.repeat(257)])('rejects invalid sessions without leaking identity', async (token) => {
    const response = await request(app()).get('/api/monitoring').set('Cookie', `session_token=${token}`);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'authentication_required' });
  });

  it('rejects expired sessions at the exact boundary without deleting them', async () => {
    db.prepare('UPDATE sessions SET expires_at = ?').run(NOW.toISOString());
    queries.length = 0;
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(401);
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('reports empty history/memory file size as unknown, not healthy', async () => {
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.wamBackup).toEqual({ status: 'unknown', count: 0, latestAt: null });
    expect(response.body.database).toEqual({ status: 'unknown', bytes: null, walBytes: null });
    expect(response.body.email.channels).toHaveLength(4);
    expect(response.body.email.channels.every((c: { status: string }) => c.status === 'unknown')).toBe(true);
    expect(response.body.process).toEqual({ status: 'good', uptimeSeconds: 1234, startedAt: '2026-09-05T07:39:26.000Z' });
    expect(deps.statFile).not.toHaveBeenCalled();
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('returns only allowlisted metadata and current delivery counts, never private fields', async () => {
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (2, ?, ?)').run('other@example.invalid', SECRET);
    db.exec('INSERT INTO partnerships (id, initiator_id, invitee_id) VALUES (1, 1, 2)');
    db.exec('INSERT INTO wams (id, partnership_id, week) VALUES (1, 1, 1)');
    db.prepare(`INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json, created_at)
      VALUES (1, 1, ?, 5, ?, ?)`).run(NOW.toISOString(), JSON.stringify({ secret: SECRET }), '2026-09-04T10:00:00.000Z');
    db.prepare(`INSERT INTO wam_email_reminders (iso_week, partnership_id, recipient_user_id, status, error)
      VALUES ('2026-W36', 1, 1, 'failed', ?)`).run(SECRET);
    db.prepare(`INSERT INTO scheduled_email_reminders (creator_user_id, recipient_user_id, title, body, scheduled_for, status, last_error)
      VALUES (1, 1, ?, ?, ?, 'sent', ?)`).run(SECRET, SECRET, NOW.toISOString(), SECRET);
    db.prepare(`INSERT INTO partner_broosts (sender_id, recipient_id, message, email_status, email_last_error)
      VALUES (1, 2, ?, 'pending', ?)`).run(SECRET, SECRET);
    db.prepare(`INSERT INTO wam_calendar_invitations (wam_id, recipient_user_id, event_sequence, status, error)
      VALUES (1, 1, 1, 'sent', ?)`).run(SECRET);
    queries.length = 0;
    const response = await request(app()).get('/api/monitoring?path=/private/secret&unit=evil.service').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.wamBackup).toEqual({ status: 'good', count: 1, latestAt: '2026-09-04T10:00:00.000Z' });
    expect(response.body.email.channels.map((channel: { counts: unknown }) => channel.counts)).toEqual([
      { sent: 0, failed: 1, pending: 0, sending: 0, cancelled: 0 },
      { sent: 1, failed: 0, pending: 0, sending: 0, cancelled: 0 },
      { sent: 0, failed: 0, pending: 1, sending: 0, cancelled: 0 },
      { sent: 1, failed: 0, pending: 0, sending: 0, cancelled: 0 },
    ]);
    expect(Object.keys(response.body).sort()).toEqual(['version', 'checkedAt', 'status', 'process', 'database', 'wamBackup', 'email', 'probe', 'fileBackup', 'cloudBackup', 'certificate', 'timers'].sort());
    expect(Object.keys(response.body.database).sort()).toEqual(['bytes', 'status', 'walBytes']);
    expect(Object.keys(response.body.certificate).sort()).toEqual(['daysRemaining', 'expiresAt', 'state', 'status', 'validFrom']);
    expect(Object.keys(response.body.probe).sort()).toEqual(['ageSeconds', 'reason', 'sampledAt', 'staleAfterSeconds', 'status']);
    const body = JSON.stringify(response.body);
    for (const forbidden of ['@', 'secret', '/private', '/fake', 'SELECT', 'snapshot_json', 'token', 'recipient', 'password', 'connection', 'last_error', 'username']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
    expect(queries.join(' ')).not.toContain('snapshot_json');
    expect(queries.join(' ')).not.toContain('SELECT *');
    expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('rejects %s control actions', async (method) => {
    const response = await request(app())[method]('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
    expect(queries.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('fails DB authentication closed with a fixed error', async () => {
    deps.db = () => { throw new Error(SECRET); };
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'monitoring_unavailable' });
  });

  it('returns a 503 error snapshot when a required aggregate table fails', async () => {
    db.exec('DROP TABLE wam_email_reminders');
    const response = await request(app()).get('/api/monitoring').set('Cookie', cookie);
    expect(response.status).toBe(503);
    expect(response.body.database.status).toBe('error');
    expect(response.body.wamBackup.count).toBeNull();
    expect(response.body.email.status).toBe('error');
    expect(response.body.status).toBe('error');
    expect(JSON.stringify(response.body)).not.toContain('wam_email_reminders');
  });

  it('collects only local DB and WAL sizes with injected file access', async () => {
    deps.db = () => ({ name: '/private/database.sqlite', prepare: db.prepare.bind(db) }) as Database.Database;
    const result = await getMonitoringSnapshot(deps);
    expect(result.database).toEqual({ status: 'good', bytes: 2048, walBytes: 2048 });
    expect(deps.statFile).toHaveBeenCalledWith('/private/database.sqlite');
    expect(deps.statFile).toHaveBeenCalledWith('/private/database.sqlite-wal');
    expect(JSON.stringify(result)).not.toContain('/private');
  });

  it('treats only a missing WAL as zero; other stat failures are errors', async () => {
    deps.db = () => ({ name: '/private/database.sqlite', prepare: db.prepare.bind(db) }) as Database.Database;
    deps.statFile = vi.fn().mockResolvedValueOnce({ size: 1024, isFile: () => true })
      .mockRejectedValueOnce(Object.assign(new Error(SECRET), { code: 'ENOENT' }));
    expect((await getMonitoringSnapshot(deps)).database).toEqual({ status: 'good', bytes: 1024, walBytes: 0 });
    deps.statFile = vi.fn().mockRejectedValue(Object.assign(new Error(SECRET), { code: 'EACCES' }));
    expect((await getMonitoringSnapshot(deps)).database.status).toBe('error');
  });

  it('downgrades stale good observations and preserves real error states', async () => {
    const old = freshProbe();
    old.sampledAt = '2026-09-05T07:30:00.000Z';
    old.certificate.validTo = '2026-09-05T08:00:00.000Z';
    deps.readProbe = (now) => readOperationalProbe({ directory: '/fake', now, staleAfterSeconds: 900, readFile: async () => encoded(old) });
    const result = await getMonitoringSnapshot(deps);
    expect(result.probe).toMatchObject({ status: 'warn', reason: 'stale', ageSeconds: 1800 });
    expect(result.fileBackup.status).toBe('warn');
    expect(result.timers.every((timer) => timer.status === 'warn')).toBe(true);
    expect(result.certificate.status).toBe('error');
  });

  it('reports missing providers and elapsed timer runs honestly', async () => {
    deps.readProbe = async () => { throw new Error(SECRET); };
    let result = await getMonitoringSnapshot(deps);
    expect(result.probe.status).toBe('unknown');
    expect(result.certificate.status).toBe('unknown');
    expect(result.fileBackup.status).toBe('unknown');
    expect(result.timers.every((timer) => timer.status === 'unknown')).toBe(true);
    const probe = freshProbe();
    probe.timers[0].state = 'failed';
    probe.timers[0].nextRunAt = null;
    probe.timers[1].nextRunAt = NOW.toISOString();
    probe.fileBackup.lastSuccessAt = '2026-09-01T00:00:00.000Z';
    deps.readProbe = (now) => readOperationalProbe({ directory: '/fake', now, staleAfterSeconds: 900, readFile: async () => encoded(probe) });
    result = await getMonitoringSnapshot(deps);
    expect(result.timers[0].status).toBe('error');
    expect(result.timers[1].status).toBe('warn');
    expect(result.fileBackup.status).toBe('warn');
  });

  it('enforces file-backup freshness at the exact duration boundary', async () => {
    const probe = freshProbe();
    probe.fileBackup.lastSuccessAt = new Date(NOW.getTime() - deps.backupStaleAfterSeconds * 1000).toISOString();
    deps.readProbe = (now) => readOperationalProbe({ directory: '/fake', now, staleAfterSeconds: 900, readFile: async () => encoded(probe) });
    expect((await getMonitoringSnapshot(deps)).fileBackup.status).toBe('good');
    deps.now = () => new Date(NOW.getTime() + 1);
    expect((await getMonitoringSnapshot(deps)).fileBackup.status).toBe('warn');
  });
  it('reports remote attestation separately, never exposing destination metadata', async () => {
    const probe = freshProbe();
    probe.cloudBackup = { state: 'observed', lastSuccessAt: '2026-09-01T00:00:00.000Z', archiveBytes: 1234 };
    deps.readProbe = (now) => readOperationalProbe({ directory: '/fake', now, staleAfterSeconds: 900, readFile: async () => encoded(probe) });
    const result = await getMonitoringSnapshot(deps);
    expect(result.fileBackup.status).toBe('good');
    expect(result.cloudBackup).toMatchObject({ status: 'warn', state: 'observed', archiveBytes: 1234 });
    expect(Object.keys(result.cloudBackup).sort()).toEqual(['ageSeconds', 'archiveBytes', 'latestAt', 'staleAfterSeconds', 'state', 'status']);
  });
});

describe('strict bounded probe contract', () => {
  async function parse(data: unknown, now = NOW) {
    return readOperationalProbe({ directory: '/operator-only', now, staleAfterSeconds: 900, readFile: async () => encoded(data) });
  }
  it('distinguishes unconfigured, missing, unavailable and oversized files', async () => {
    const readFile = vi.fn();
    expect((await readOperationalProbe({ now: NOW, staleAfterSeconds: 900, readFile })).reason).toBe('not_configured');
    expect(readFile).not.toHaveBeenCalled();
    for (const [error, reason] of [
      [Object.assign(new Error(SECRET), { code: 'ENOENT' }), 'missing'],
      [Object.assign(new Error(SECRET), { code: 'EACCES' }), 'unavailable'],
      [new MonitoringFileError('oversized'), 'oversized'],
    ] as const) {
      const result = await readOperationalProbe({ directory: '/fake', now: NOW, staleAfterSeconds: 900, readFile: async () => { throw error; } });
      expect(result).toEqual({ reason, data: null, ageSeconds: null, sampledAt: null });
    }
  });
  it('bounds provider payloads independently and rejects invalid JSON', async () => {
    for (const [buffer, reason] of [[Buffer.alloc(MAX_PROBE_BYTES + 1), 'oversized'], [Buffer.from('{bad'), 'malformed']] as const) {
      expect((await readOperationalProbe({ directory: '/fake', now: NOW, staleAfterSeconds: 900, readFile: async () => buffer })).reason).toBe(reason);
    }
  });
  it.each([
    (probe: OperationalProbe) => ({ ...probe, rawError: SECRET }),
    (probe: OperationalProbe) => ({ ...probe, certificate: { ...probe.certificate, subject: SECRET } }),
    (probe: OperationalProbe) => ({ ...probe, timers: [{ ...probe.timers[0], id: 'evil.service' }, ...probe.timers.slice(1)] }),
    (probe: OperationalProbe) => ({ ...probe, timers: [probe.timers[0], probe.timers[0], ...probe.timers.slice(2)] }),
    (probe: OperationalProbe) => ({ ...probe, timers: probe.timers.slice(1) }),
    (probe: OperationalProbe) => ({ ...probe, sampledAt: SECRET }),
    (probe: OperationalProbe) => ({ ...probe, sampledAt: '2026-02-30T00:00:00.000Z' }),
    (probe: OperationalProbe) => ({ ...probe, certificate: { state: 'unknown', validFrom: null, validTo: probe.certificate.validTo } }),
    (probe: OperationalProbe) => ({ ...probe, fileBackup: { state: 'observed', lastSuccessAt: null } }),
  ])('rejects malformed/unallowlisted fields without returning any payload', async (mutate) => {
    expect(await parse(mutate(freshProbe()))).toEqual({ reason: 'malformed', data: null, sampledAt: null, ageSeconds: null });
  });
  it('rejects future samples and future backup success attestations', async () => {
    const probe = freshProbe();
    probe.sampledAt = '2026-09-05T08:00:00.001Z';
    expect((await parse(probe)).reason).toBe('future');
    probe.sampledAt = NOW.toISOString();
    probe.fileBackup.lastSuccessAt = '2026-09-05T08:00:00.001Z';
    expect((await parse(probe)).reason).toBe('future');
    probe.fileBackup.lastSuccessAt = '2026-09-05T07:00:00.000Z';
    probe.cloudBackup = { state: 'observed', lastSuccessAt: '2026-09-05T08:00:00.001Z', archiveBytes: 1234 };
    expect((await parse(probe)).reason).toBe('future');
  });
  it('accepts pre-cloud probes as explicitly not configured', async () => {
    const { cloudBackup: _cloud, ...legacy } = freshProbe();
    expect((await parse(legacy)).data?.cloudBackup).toEqual({ state: 'not_configured', lastSuccessAt: null, archiveBytes: null });
  });
  it('has exact freshness boundaries, including subsecond staleness', async () => {
    expect((await parse(freshProbe(), new Date(NOW.getTime() + 900_000))).reason).toBe('fresh');
    expect((await parse(freshProbe(), new Date(NOW.getTime() + 900_001))).reason).toBe('stale');
  });
  it('uses bounded defaults for malformed operational thresholds', () => {
    for (const value of [undefined, '', 'NaN', '-1', '0', 'Infinity', '59', '9000000', '1e3']) {
      expect(positiveSeconds(value, 900, 86400)).toBe(900);
    }
    expect(positiveSeconds('3600', 900, 86400)).toBe(3600);
  });
});

describe('certificate time boundaries', () => {
  const from = '2026-09-01T00:00:00.000Z';
  const to = '2026-10-31T00:00:00.000Z';
  it.each([
    ['2026-08-31T23:59:59.999Z', 'error'],
    [from, 'good'],
    ['2026-09-30T23:59:59.999Z', 'good'],
    ['2026-10-01T00:00:00.000Z', 'warn'],
    ['2026-10-30T23:59:59.999Z', 'warn'],
    [to, 'error'],
    ['2026-11-01T00:00:00.000Z', 'error'],
  ])('evaluates %s as %s', (now, expected) => {
    expect(certificateStatus(from, to, new Date(now))).toBe(expected);
  });
  it('never treats invalid date input as healthy', () => {
    expect(certificateStatus('bad', to, NOW)).toBe('unknown');
    expect(certificateStatus(to, from, NOW)).toBe('unknown');
  });
});
