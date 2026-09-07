import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { runMigrations } from '../migrate.js';
import { buildCycleBundle } from '../lib/cycleBundle.js';
import type { CycleRow } from '../lib/repo.js';
import { collectEvidenceStoredFilenames, findOrphanedEvidenceFiles } from '../lib/tacticEvidence.js';
import { buildAppDataSnapshot } from '../lib/wamCompletionBackup.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic')]);
const migrationPath = fileURLToPath(new URL('../migrations/015_tactic_evidence.sql', import.meta.url));

describe('weekly tactic evidence compatibility', () => {
  let app: ReturnType<typeof freshApp>;
  let dir: string;
  let previousEvidenceDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.resolve(process.cwd(), '.weekly-evidence-test-'));
    previousEvidenceDir = process.env.EVIDENCE_DIR;
    process.env.EVIDENCE_DIR = dir;
    app = freshApp();
  });

  afterEach(() => {
    closeDb();
    if (previousEvidenceDir === undefined) delete process.env.EVIDENCE_DIR;
    else process.env.EVIDENCE_DIR = previousEvidenceDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function user(email: string) {
    const res = await request(app).post('/api/auth/register').send({ email, password: 'synthetic-password123' });
    expect(res.status).toBe(201);
    return { cookie: extractCookie(res), id: res.body.id as number };
  }

  async function fixture() {
    const owner = await user('weekly-owner@example.test');
    const cycle = await request(app).post('/api/cycle').set('Cookie', owner.cookie).send({ name: 'Synthetic cycle' });
    const goal = await request(app).post('/api/goals').set('Cookie', owner.cookie).send({ title: 'Synthetic goal' });
    const tactic = await request(app).post('/api/tactics').set('Cookie', owner.cookie)
      .send({ goalId: goal.body.id, title: 'Synthetic tactic', weekdays: [0, 4], startWeek: 1, endWeek: 12 });
    const tacticId = tactic.body.id as number;
    for (const weekday of [0, 4]) {
      expect((await request(app).post('/api/completions/toggle').set('Cookie', owner.cookie)
        .send({ tacticId, week: 1, weekday, done: true })).status).toBe(200);
    }
    return { owner, tacticId, cycleId: cycle.body.id as number, weekly: `/api/tactic-evidence/weekly/${tacticId}/1` };
  }

  function upload(url: string, cookie: string, name = 'synthetic.png') {
    return request(app).put(`${url}/file`).set('Cookie', cookie).set('Content-Type', 'image/png')
      .set('X-Evidence-Filename', encodeURIComponent(name)).send(PNG);
  }

  it('migrates all seven legacy rows byte-for-byte, keeping ids, timestamps, file references and sequence', async () => {
    const { owner, tacticId, weekly } = await fixture();
    const db = getDb();
    db.exec('DROP TABLE tactic_evidence');
    db.prepare('DELETE FROM schema_migrations WHERE name = ?').run('018_weekly_tactic_evidence.sql');
    db.prepare('DELETE FROM schema_migrations WHERE name = ?').run('019_cycle_week_evidence.sql');
    db.exec(fs.readFileSync(migrationPath, 'utf8'));
    const insert = db.prepare(`INSERT INTO tactic_evidence
      (id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name, file_mime, file_size, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'text/plain', 3, '2026-01-01T01:02:03Z', '2026-02-01T04:05:06Z')`);
    for (let day = 0; day < 7; day += 1) {
      const filename = `${'a'.repeat(47)}${day}.txt`;
      fs.writeFileSync(path.join(dir, filename), `old`);
      insert.run(day + 1, tacticId, day, `note-${day}`, `https://example.test/${day}`, `original-${day}.txt`, filename);
    }
    db.prepare('INSERT INTO tactic_evidence (id, tactic_id, week, weekday, note) VALUES (1000, ?, 2, 0, ?)').run(tacticId, 'deleted-before-migration');
    db.prepare('DELETE FROM tactic_evidence WHERE id = 1000').run();
    const original = db.prepare('SELECT * FROM tactic_evidence ORDER BY id').all().map((row) => ({ ...(row as object), cycle_id: null }));
    runMigrations(db);
    runMigrations(db);
    expect(db.prepare('SELECT * FROM tactic_evidence ORDER BY id').all()).toEqual(original);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tactic_evidence'").get()).toEqual({ seq: 1000 });
    const collection = await request(app).get(weekly).set('Cookie', owner.cookie);
    expect(collection.body.evidence).toBeNull();
    expect(collection.body.legacyEvidence.map((row: { weekday: number }) => row.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let day = 0; day < 7; day += 1) {
      const response = await request(app).get(`/api/tactic-evidence/${tacticId}/1/${day}/file`).set('Cookie', owner.cookie);
      expect(response.status).toBe(200);
      expect(response.text).toBe('old');
    }
    expect((await request(app).put(weekly).set('Cookie', owner.cookie).send({ note: 'weekly' })).status).toBe(200);
    expect(db.prepare('SELECT id FROM tactic_evidence WHERE weekday = -1').get()).toEqual({ id: 1001 });
    expect(db.prepare('SELECT * FROM tactic_evidence WHERE weekday >= 0 ORDER BY id').all()).toEqual(original);
  });

  it('weekly create/edit/delete never overwrites or removes either legacy file, note or link', async () => {
    const { owner, tacticId, cycleId, weekly } = await fixture();
    const db = getDb();
    for (const day of [0, 4]) {
      const daily = `/api/tactic-evidence/${tacticId}/1/${day}`;
      expect((await request(app).put(daily).set('Cookie', owner.cookie)
        .send({ note: `legacy-${day}`, link: `https://example.test/${day}` })).status).toBe(200);
      expect((await upload(daily, owner.cookie, `old-${day}.png`)).status).toBe(200);
    }
    const original = db.prepare('SELECT * FROM tactic_evidence ORDER BY weekday').all();
    const files = fs.readdirSync(dir).sort();
    const created = await request(app).put(weekly).set('Cookie', owner.cookie).send({ note: 'new weekly', link: 'https://example.test/weekly' });
    expect(created.status).toBe(200);
    expect(created.body.weekday).toBeNull();
    expect((await upload(weekly, owner.cookie)).status).toBe(200);
    const read = await request(app).get(weekly).set('Cookie', owner.cookie);
    expect(read.body.evidence.note).toBe('new weekly');
    expect(read.body.legacyEvidence).toHaveLength(2);
    expect(JSON.stringify(read.body)).not.toContain('file_stored_name');
    expect((await request(app).get(`${weekly}/file`).set('Cookie', owner.cookie)).body).toEqual(PNG);
    const gallery = await request(app).get(`/api/tactic-evidence/cycle/${cycleId}`).set('Cookie', owner.cookie);
    expect(gallery.body.items.map((row: { weekday: number | null }) => row.weekday)).toEqual([null, 0, 4]);
    const exported = await request(app).get('/api/export').set('Cookie', owner.cookie);
    const exportedEvidence = exported.body.cycles[0].goals[0].tactics[0].evidence;
    expect(exportedEvidence.map((row: { weekday: number | null }) => row.weekday)).toEqual([null, 0, 4]);
    expect(exportedEvidence.map((row: { note: string }) => row.note)).toEqual(['new weekly', 'legacy-0', 'legacy-4']);
    expect(exportedEvidence.every((row: { id: number; hasFile: boolean }) => row.id > 0 && row.hasFile)).toBe(true);
    expect(JSON.stringify(exported.body)).not.toContain('file_stored_name');
    const snapshot = buildAppDataSnapshot(db);
    const snapshotEvidence = snapshot.tables.tactic_evidence as { weekday: number; hasFile: number }[];
    expect(snapshotEvidence.map((row) => row.weekday).sort()).toEqual([-1, 0, 4]);
    expect(snapshotEvidence.every((row) => Boolean(row.hasFile))).toBe(true);
    expect(collectEvidenceStoredFilenames(db, [tacticId])).toHaveLength(3);
    expect(findOrphanedEvidenceFiles(db).orphanedFilenames).toEqual([]);
    expect((await request(app).delete(`${weekly}/file`).set('Cookie', owner.cookie)).body.evidence.note).toBe('new weekly');
    expect((await request(app).delete(weekly).set('Cookie', owner.cookie)).status).toBe(200);
    expect(db.prepare('SELECT * FROM tactic_evidence ORDER BY weekday').all()).toEqual(original);
    expect(fs.readdirSync(dir).sort()).toEqual(files);
    expect((await request(app).get(weekly).set('Cookie', owner.cookie)).body.legacyEvidence).toHaveLength(2);
  });

  it('weekly creation requires any completion in that week; editing after unchecking does not alter scores or completions', async () => {
    const { owner, tacticId, cycleId, weekly } = await fixture();
    const db = getDb();
    const cycle = db.prepare('SELECT * FROM cycles WHERE id = ?').get(cycleId) as CycleRow;
    const before = buildCycleBundle(db, cycle);
    const completions = db.prepare('SELECT * FROM completions ORDER BY id').all();
    expect((await request(app).put(weekly).set('Cookie', owner.cookie).send({ note: 'weekly' })).status).toBe(200);
    const after = buildCycleBundle(db, cycle);
    expect(after.weekScores).toEqual(before.weekScores);
    expect(after.averageScore).toEqual(before.averageScore);
    expect(db.prepare('SELECT * FROM completions ORDER BY id').all()).toEqual(completions);
    expect(after.goals[0].tactics[0].evidenceWeeks).toEqual([1]);
    expect(after.goals[0].tactics[0].completions.every((row) => row.weekday >= 0)).toBe(true);
    for (const day of [0, 4]) {
      await request(app).post('/api/completions/toggle').set('Cookie', owner.cookie).send({ tacticId, week: 1, weekday: day, done: false });
    }
    expect((await request(app).put(weekly).set('Cookie', owner.cookie).send({ note: 'edited after uncheck' })).status).toBe(200);
    expect((await request(app).put(`/api/tactic-evidence/weekly/${tacticId}/2`).set('Cookie', owner.cookie).send({ note: 'not yet completed' })).status).toBe(400);
    // Evidence indicators do not depend on a daily completion row surviving at all.
    db.prepare('DELETE FROM completions WHERE tactic_id = ?').run(tacticId);
    expect(buildCycleBundle(db, cycle).goals[0].tactics[0].evidenceWeeks).toEqual([1]);
    expect((await request(app).get(weekly).set('Cookie', owner.cookie)).body.evidence.note).toBe('edited after uncheck');
  });

  it('weekly evidence is owner-write, accepted-partner-read only, and immediately revoked on unpairing', async () => {
    const { owner, tacticId, weekly } = await fixture();
    const partner = await user('weekly-partner@example.test');
    const stranger = await user('weekly-stranger@example.test');
    const pair = await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie).send({ targetUserId: partner.id });
    expect(pair.status).toBe(201);
    expect((await upload(weekly, owner.cookie)).status).toBe(200);
    const read = await request(app).get(weekly).set('Cookie', partner.cookie);
    expect(read.status).toBe(200);
    expect(read.body.access).toBe('partner');
    expect(read.body.canCreate).toBe(false);
    const partnerExport = await request(app).get('/api/export').set('Cookie', partner.cookie);
    expect(partnerExport.body.cycles).toEqual([]);
    expect(JSON.stringify(partnerExport.body)).not.toContain('synthetic.png');
    const download = await request(app).get(`${weekly}/file`).set('Cookie', partner.cookie);
    expect(download.body).toEqual(PNG);
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-security-policy']).toBe('sandbox');
    expect((await request(app).put(weekly).set('Cookie', partner.cookie).send({ note: 'no' })).status).toBe(403);
    expect((await upload(weekly, partner.cookie)).status).toBe(403);
    expect((await request(app).delete(weekly).set('Cookie', partner.cookie)).status).toBe(403);
    expect((await request(app).delete(`${weekly}/file`).set('Cookie', partner.cookie)).status).toBe(403);
    expect((await request(app).get(weekly).set('Cookie', stranger.cookie)).status).toBe(403);
    expect((await request(app).get(`${weekly}/file`).set('Cookie', stranger.cookie)).status).toBe(403);
    expect((await request(app).get(weekly)).status).toBe(401);
    expect((await request(app).put(weekly).send({ note: 'no' })).status).toBe(401);
    expect((await request(app).delete(weekly)).status).toBe(401);
    expect((await request(app).get(`${weekly}/file`)).status).toBe(401);
    getDb().prepare('DELETE FROM partnerships').run();
    expect((await request(app).get(weekly).set('Cookie', partner.cookie)).status).toBe(403);
    expect((await request(app).get(`${weekly}/file`).set('Cookie', partner.cookie)).status).toBe(403);
    expect((await request(app).get(`/api/tactic-evidence/${tacticId}/1/-1`).set('Cookie', owner.cookie)).status).toBe(400);
  });

  it('validates weekly scope, metadata and file bytes without accepting the internal slot in a daily URL', async () => {
    const { owner, tacticId, weekly } = await fixture();
    for (const invalid of ['0', '13', '-1', 'nope']) {
      expect((await request(app).get(`/api/tactic-evidence/weekly/${tacticId}/${invalid}`).set('Cookie', owner.cookie)).status).toBe(400);
    }
    expect((await request(app).put(weekly).set('Cookie', owner.cookie).send({ link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await request(app).put(weekly).set('Cookie', owner.cookie).send({})).status).toBe(400);
    expect((await request(app).put(`${weekly}/file`).set('Cookie', owner.cookie).set('Content-Type', 'image/png')
      .set('X-Evidence-Filename', 'proof.png').send(Buffer.from('not PNG'))).status).toBe(400);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM tactic_evidence').get()).toEqual({ count: 0 });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
