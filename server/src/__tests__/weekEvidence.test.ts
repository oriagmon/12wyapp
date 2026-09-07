import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Request, Response, Router } from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDb, closeDb, getDb } from '../db.js';
import { runMigrations } from '../migrate.js';
import { createSession } from '../lib/sessions.js';
import { config } from '../config.js';
import { weekEvidenceRouter } from '../routes/weekEvidence.js';
import { tacticEvidenceRouter } from '../routes/tacticEvidence.js';
import { exportRouter } from '../routes/export.js';
import * as files from '../lib/tacticEvidence.js';
import { buildAppDataSnapshot } from '../lib/wamCompletionBackup.js';
import { findWeekEvidence, listWeekEvidence, weekEvidenceAccess } from '../lib/weekEvidence.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic')]);
type Reply = { status: number; body: any; headers: Record<string, string> };

/** Invoke the existing Express router in-process: no app.listen, HTTP client or sockets. */
function invoke(router: Router, method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const raw = Buffer.isBuffer(body);
    const req = Readable.from(raw ? [body] : []) as unknown as Request;
    Object.assign(req, {
      method, url, path: url.split('?')[0], originalUrl: url, baseUrl: '', cookies: token ? { [config.sessionCookieName]: token } : {},
      headers: { ...(raw ? { 'content-type': 'image/png', 'content-length': String(body.length), 'x-evidence-filename': 'synthetic.png' } : {}), ...headers },
      body: raw ? undefined : body,
      get: (name: string) => req.headers[name.toLowerCase()],
    });
    let status = 200;
    const responseHeaders: Record<string, string> = {};
    const res = {
      status(code: number) { status = code; return this; },
      set(name: string, value: string) { responseHeaders[name.toLowerCase()] = value; return this; },
      setHeader(name: string, value: string) { responseHeaders[name.toLowerCase()] = value; return this; },
      clearCookie() { return this; },
      json(value: unknown) { resolve({ status, body: value, headers: responseHeaders }); return this; },
      send(value: unknown) { resolve({ status, body: value, headers: responseHeaders }); return this; },
    } as unknown as Response;
    router(req, res, (error?: unknown) => resolve({ status: error ? 500 : 404, body: error, headers: responseHeaders }));
  });
}

describe('whole-cycle-week album (in-process, no network)', () => {
  let db: Database.Database;
  let evidenceDir: string;
  let oldEvidenceDir: string | undefined;
  let owner: string;
  let partner: string;
  let stranger: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    oldEvidenceDir = process.env.EVIDENCE_DIR;
    evidenceDir = fs.mkdtempSync(path.resolve(process.cwd(), '.week-album-fixture-'));
    process.env.EVIDENCE_DIR = evidenceDir;
    for (const id of [1, 2, 3]) {
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, `synthetic-${id}@example.test`, 'not-a-login-hash');
    }
    db.exec(`INSERT INTO partnerships (initiator_id, invitee_id) VALUES (1, 2);
      INSERT INTO cycles (id, user_id, name, is_active) VALUES (10, 1, 'owner', 1), (11, 1, 'archive', 0), (20, 2, 'partner', 1);`);
    owner = createSession(db, 1).token;
    partner = createSession(db, 2).token;
    stranger = createSession(db, 3).token;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    if (oldEvidenceDir === undefined) delete process.env.EVIDENCE_DIR;
    else process.env.EVIDENCE_DIR = oldEvidenceDir;
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });
  const request = (method: string, url: string, token?: string, body?: unknown, headers?: Record<string, string>) =>
    invoke(weekEvidenceRouter, method, url, token, body, headers);

  it('adds concurrent files without tactics/completions and isolates week, cycle and item ids', async () => {
    const [first, second] = await Promise.all([
      request('POST', '/10/1/files', owner, PNG), request('POST', '/10/1/files', owner, PNG),
    ]);
    const nextWeek = await request('POST', '/10/2/files', owner, PNG);
    const archive = await request('POST', '/11/1/files', owner, PNG);
    for (const item of [first, second, nextWeek, archive]) expect(item.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    expect(first.body).toMatchObject({ cycleId: 10, week: 1, tacticId: null, weekday: null, scope: 'week' });
    expect((await request('GET', '/10/1', owner)).body.items).toHaveLength(2);
    expect((await request('GET', '/10/2', owner)).body.items).toHaveLength(1);
    expect((await request('GET', '/11/1', owner)).body.items).toHaveLength(1);
    expect((await request('GET', `/10/2/${first.body.id}/file`, owner)).status).toBe(404);
    expect((await request('DELETE', `/11/1/${first.body.id}`, owner)).status).toBe(404);
    const download = await request('GET', `/10/1/${first.body.id}/file`, owner);
    expect(download.body).toEqual(PNG);
    expect(download.headers).toMatchObject({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tactics').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM completions').get()).toEqual({ n: 0 });
    expect(files.findOrphanedEvidenceFiles(db).orphanedFilenames).toEqual([]);
  });

  it('enforces owner edits, partner reads, stranger denial and exact cycle ownership', async () => {
    const uploaded = await request('POST', '/10/1/files', owner, PNG);
    const id = uploaded.body.id;
    expect((await request('GET', '/10/1', partner)).body.access).toBe('partner');
    expect((await request('GET', `/10/1/${id}/file`, partner)).body).toEqual(PNG);
    for (const [method, url, body] of [
      ['POST', '/10/1', { note: 'blocked' }],
      ['POST', '/10/1/files', PNG],
      ['PUT', `/10/1/${id}`, { note: 'blocked' }],
      ['DELETE', `/10/1/${id}`, undefined],
      ['DELETE', `/10/1/${id}/file`, undefined],
    ] as const) expect((await request(method, url, partner, body)).status).toBe(403);
    expect((await request('GET', '/10/1', stranger)).status).toBe(403);
    expect((await request('GET', '/10/1')).status).toBe(401);
    expect((await request('POST', '/20/1/files', owner, PNG)).status).toBe(403);
    db.prepare('DELETE FROM partnerships').run();
    expect((await request('GET', `/10/1/${id}/file`, partner)).status).toBe(403);
    expect(weekEvidenceAccess(db, 1, 10, true)).toEqual({ ok: true, access: 'owner' });
  });

  it('edits notes/links, detaches just one file, exports all album items and preserves backup references', async () => {
    const first = await request('POST', '/10/1/files', owner, PNG);
    const second = await request('POST', '/10/1/files', owner, PNG);
    expect((await request('PUT', `/10/1/${first.body.id}`, owner, { note: 'caption', link: 'https://example.test/proof' })).status).toBe(200);
    const exported = await invoke(exportRouter, 'GET', '/', owner);
    expect(exported.status).toBe(200);
    expect(exported.body.cycles.find((cycle: any) => cycle.id === 10).weekEvidence).toHaveLength(2);
    expect(JSON.stringify(exported.body)).not.toContain('file_stored_name');
    expect((await invoke(exportRouter, 'GET', '/', partner)).body.cycles.every((cycle: any) => cycle.id !== 10)).toBe(true);
    const snapshot = buildAppDataSnapshot(db);
    expect(snapshot.schemaVersion).toBe(7);
    expect(snapshot.tables.tactic_evidence).toHaveLength(2);
    expect(snapshot.tables.tactic_evidence[0]).toMatchObject({ cycleId: 10, tacticId: null, hasFile: 1 });
    expect((await request('DELETE', `/10/1/${first.body.id}/file`, owner)).status).toBe(200);
    expect(findWeekEvidence(db, 10, 1, first.body.id)).toMatchObject({ note: 'caption', link: 'https://example.test/proof', file_stored_name: null });
    expect(fs.readdirSync(evidenceDir)).toHaveLength(1);
    expect((await request('DELETE', `/10/1/${second.body.id}`, owner)).status).toBe(200);
    expect(fs.readdirSync(evidenceDir)).toHaveLength(0);
    expect(listWeekEvidence(db, 10, 1)).toHaveLength(1);
  });

  it.each([
    ['week', 'file'],
    ['week', 'file/'],
    ['week', 'FILE'],
    ['legacy', 'file'],
    ['legacy', 'file/'],
    ['legacy', 'FILE'],
  ])('preserves %s entry metadata when detaching through /%s', async (kind, suffix) => {
    const uploaded = await request('POST', '/10/1/files', owner, PNG);
    expect(uploaded.status).toBe(201);
    const id = uploaded.body.id;
    if (kind === 'legacy') {
      db.exec(`INSERT INTO goals (id, cycle_id, title, color) VALUES (50, 10, 'goal', 'emerald');
        INSERT INTO tactics (id, goal_id, title, weekdays, start_week, end_week) VALUES (60, 50, 'old tactic', '[0]', 1, 12);`);
      db.prepare('UPDATE tactic_evidence SET tactic_id = 60, cycle_id = NULL, weekday = 0 WHERE id = ?').run(id);
    }
    expect((await request('PUT', `/10/1/${id}`, owner, {
      note: 'keep this caption', link: 'https://example.test/keep',
    })).status).toBe(200);
    const before = findWeekEvidence(db, 10, 1, id)!;
    const storedPath = path.join(evidenceDir, before.file_stored_name!);

    for (const [token, status] of [[partner, 403], [stranger, 403], [undefined, 401]] as const) {
      expect((await request('DELETE', `/10/1/${id}/${suffix}`, token)).status).toBe(status);
      expect(findWeekEvidence(db, 10, 1, id)).toEqual(before);
      expect(fs.existsSync(storedPath)).toBe(true);
    }

    expect((await request('DELETE', `/10/1/${id}/${suffix}`, owner)).status).toBe(200);
    const after = findWeekEvidence(db, 10, 1, id);
    expect(after).toMatchObject({
      file_original_name: null, file_stored_name: null, file_mime: null, file_size: null,
    });
    for (const key of ['id', 'tactic_id', 'cycle_id', 'week', 'weekday', 'note', 'link', 'created_at'] as const) {
      expect(after?.[key]).toEqual(before[key]);
    }
    expect(fs.existsSync(storedPath)).toBe(false);
  });

  it.each([
    ['image/png', 'a.png', PNG],
    ['image/jpeg', 'a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/webp', 'a.webp', Buffer.from('RIFF0000WEBPsynthetic')],
    ['application/pdf', 'a.pdf', Buffer.from('%PDF-1.4 synthetic')],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])],
    ['text/plain', 'a.txt', Buffer.from('synthetic text')],
  ])('preserves the existing supported format: %s', async (mime, name, bytes) => {
    const result = await request('POST', '/10/1/files', owner, bytes, { 'content-type': mime as string, 'x-evidence-filename': name as string });
    expect(result.status).toBe(201);
    expect(result.body.fileMime).toBe(mime);
  });

  it('rejects invalid scope, unsafe links, empty items, bad bytes and oversized files', async () => {
    for (const week of ['0', '13', 'bad']) expect((await request('GET', `/10/${week}`, owner)).status).toBe(400);
    expect((await request('POST', '/10/1', owner, { link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await request('POST', '/10/1', owner, {})).status).toBe(400);
    expect((await request('POST', '/10/1/files', owner, Buffer.from('<svg/>'))).status).toBe(400);
    expect((await request('POST', '/10/1/files', owner, PNG, { 'content-length': String(files.MAX_EVIDENCE_FILE_BYTES + 1) })).status).toBe(413);
    expect(fs.readdirSync(evidenceDir)).toEqual([]);
  });

  it('rolls back files when a session is revoked or the cycle disappears during upload', async () => {
    const realWrite = files.writeEvidenceFile;
    vi.spyOn(files, 'writeEvidenceFile').mockImplementationOnce(async (name, data) => {
      await realWrite(name, data);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(owner);
    });
    expect((await request('POST', '/10/1/files', owner, PNG)).status).toBe(401);
    expect(fs.readdirSync(evidenceDir)).toEqual([]);
    owner = createSession(db, 1).token;
    vi.mocked(files.writeEvidenceFile).mockImplementationOnce(async (name, data) => {
      await realWrite(name, data);
      db.prepare('DELETE FROM cycles WHERE id = 10').run();
    });
    expect((await request('POST', '/10/1/files', owner, PNG)).status).toBe(404);
    expect(fs.readdirSync(evidenceDir)).toEqual([]);
  });

  it.each(['partnership', 'session', 'file'])('rechecks access/current file after reading bytes: %s', async (revocation) => {
    const item = (await request('POST', '/10/1/files', owner, PNG)).body;
    const realRead = files.readEvidenceFile;
    vi.spyOn(files, 'readEvidenceFile').mockImplementationOnce(async (name) => {
      const data = await realRead(name);
      if (revocation === 'partnership') db.prepare('DELETE FROM partnerships').run();
      else if (revocation === 'session') db.prepare('DELETE FROM sessions WHERE token = ?').run(partner);
      else expect((await request('DELETE', `/10/1/${item.id}`, owner)).status).toBe(200);
      return data;
    });
    expect((await request('GET', `/10/1/${item.id}/file`, partner)).status).toBe(revocation === 'partnership' ? 403 : revocation === 'session' ? 401 : 409);
  });

  it('losslessly migrates every deployed018 daily/tactic-week row, ids, sequence and files', async () => {
    db.exec(`INSERT INTO goals (id, cycle_id, title, color) VALUES (50, 10, 'goal', 'emerald');
      INSERT INTO tactics (id, goal_id, title, weekdays, start_week, end_week) VALUES (60, 50, 'old tactic', '[0,1,2,3,4,5,6]', 1, 12);
      DROP TABLE tactic_evidence;`);
    db.exec(fs.readFileSync(new URL('../migrations/015_tactic_evidence.sql', import.meta.url), 'utf8'));
    db.exec(fs.readFileSync(new URL('../migrations/018_weekly_tactic_evidence.sql', import.meta.url), 'utf8'));
    db.prepare('DELETE FROM schema_migrations WHERE name = ?').run('019_cycle_week_evidence.sql');
    const insert = db.prepare(`INSERT INTO tactic_evidence
      (id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name, file_mime, file_size)
      VALUES (?, 60, 1, ?, ?, ?, ?, ?, 'image/png', ?)`);
    for (let day = -1; day <= 6; day += 1) {
      const filename = files.generateStoredFilename('.png');
      await files.writeEvidenceFile(filename, PNG);
      insert.run(day + 2, day, `old-${day}`, `https://example.test/${day}`, `old-${day}.png`, filename, PNG.length);
    }
    db.prepare("INSERT INTO tactic_evidence (id, tactic_id, week, weekday, note) VALUES (1000, 60, 2, 0, 'retired')").run();
    db.prepare('DELETE FROM tactic_evidence WHERE id = 1000').run();
    const original = db.prepare('SELECT * FROM tactic_evidence ORDER BY id').all();
    const migrations = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
    const physicalFiles = fs.readdirSync(evidenceDir).sort();
    runMigrations(db);
    runMigrations(db);
    expect(db.prepare('SELECT * FROM tactic_evidence ORDER BY id').all()).toEqual(original.map((row) => ({ ...(row as object), cycle_id: null })));
    expect(db.prepare("SELECT * FROM schema_migrations WHERE name <> '019_cycle_week_evidence.sql' ORDER BY name").all()).toEqual(migrations);
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tactic_evidence'").get()).toEqual({ seq: 1000 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(fs.readdirSync(evidenceDir).sort()).toEqual(physicalFiles);
    const album = await request('GET', '/10/1', owner);
    expect(album.body.items).toHaveLength(8);
    for (const item of album.body.items) {
      expect((await request('GET', `/10/1/${item.id}/file`, partner)).body).toEqual(PNG);
      const legacyPath = item.weekday === null ? '/weekly/60/1/file' : `/60/1/${item.weekday}/file`;
      expect((await invoke(tacticEvidenceRouter, 'GET', legacyPath, owner)).body).toEqual(PNG);
    }
    const added = await request('POST', '/10/1/files', owner, PNG);
    expect(added.body.id).toBe(1001);
    expect(listWeekEvidence(db, 10, 1)).toHaveLength(9);
    const exported = (await invoke(exportRouter, 'GET', '/', owner)).body.cycles.find((cycle: any) => cycle.id === 10);
    expect(exported.weekEvidence).toHaveLength(9);
    expect(exported.weekEvidence.filter((item: any) => item.scope !== 'week').map((item: any) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(exported)).not.toContain('file_stored_name');
    expect(files.findOrphanedEvidenceFiles(db).orphanedFilenames).toEqual([]);
    // Removing a tactic only cascades its old content, never the independent week album.
    const oldFiles = files.collectEvidenceStoredFilenames(db, [60]);
    expect(oldFiles).toHaveLength(8);
    db.prepare('DELETE FROM tactics WHERE id = 60').run();
    await Promise.all(oldFiles.map((file) => files.deleteEvidenceFile(file)));
    expect(listWeekEvidence(db, 10, 1)).toHaveLength(1);
    expect(fs.readdirSync(evidenceDir)).toHaveLength(1);
    expect(getDb()).toBe(db);
  });

  it('retains the deployed018 high-water mark even when its last evidence row was already removed', async () => {
    db.exec(`INSERT INTO goals (id, cycle_id, title, color) VALUES (50, 10, 'goal', 'emerald');
      INSERT INTO tactics (id, goal_id, title, weekdays, start_week, end_week) VALUES (60, 50, 'old tactic', '[0]', 1, 12);
      DROP TABLE tactic_evidence;`);
    db.exec(fs.readFileSync(new URL('../migrations/015_tactic_evidence.sql', import.meta.url), 'utf8'));
    db.exec(fs.readFileSync(new URL('../migrations/018_weekly_tactic_evidence.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO tactic_evidence (id, tactic_id, week, weekday, note) VALUES (900, 60, 1, -1, 'deleted');
      DELETE FROM tactic_evidence;
      DELETE FROM schema_migrations WHERE name = '019_cycle_week_evidence.sql';`);
    runMigrations(db);
    expect((await request('POST', '/10/1', owner, { note: 'independent weekly note' })).body.id).toBe(901);
  });
});
