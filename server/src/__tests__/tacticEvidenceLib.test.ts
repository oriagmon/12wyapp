import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  MAX_ORIGINAL_FILENAME_CODEPOINTS,
  buildContentDispositionFilenameParts,
  currentEvidenceStoredName,
  deleteOrphanedEvidenceFiles,
  ensureEvidenceDir,
  findOrphanedEvidenceFiles,
  generateStoredFilename,
  normalizeOriginalFilename,
  upsertEvidenceFileRecord,
  writeEvidenceFile,
} from '../lib/tacticEvidence.js';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import request from 'supertest';

const TEMP_ROOT = path.resolve(process.cwd(), '.tmp-evidence-tests');
function makeTempEvidenceDir(): string {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_ROOT, 'lib-run-'));
}

describe('normalizeOriginalFilename', () => {
  it('strips a path-like prefix down to just the final segment', () => {
    expect(normalizeOriginalFilename('a/b/c.png')).toBe('c.png');
    expect(normalizeOriginalFilename('a\\b\\c.png')).toBe('c.png');
    expect(normalizeOriginalFilename('a/b\\c.png')).toBe('c.png');
    expect(normalizeOriginalFilename('../../../etc/passwd.png')).toBe('passwd.png');
  });

  it('strips NUL and other raw control characters', () => {
    expect(normalizeOriginalFilename('a\x00b\x01c.png')).toBe('abc.png');
    expect(normalizeOriginalFilename('a\nb\tc.png')).toBe('abc.png');
    expect(normalizeOriginalFilename('a\r\nb.png')).toBe('ab.png');
  });

  it('bounds an emoji-only name to 255 Unicode code points without splitting a surrogate pair in half', () => {
    const emoji = '😀'; // one code point, two UTF-16 code units
    const huge = emoji.repeat(300);
    const normalized = normalizeOriginalFilename(huge);
    const codepoints = Array.from(normalized);
    expect(codepoints.length).toBe(MAX_ORIGINAL_FILENAME_CODEPOINTS);
    // Every code point must be a whole, valid emoji — a naive UTF-16 slice would instead
    // produce a lone (invalid) surrogate at the boundary.
    for (const ch of codepoints) {
      expect(ch).toBe(emoji);
    }
  });

  it('bounds a huge Hebrew name to exactly 255 code points', () => {
    const hugeHebrew = 'א'.repeat(400);
    const normalized = normalizeOriginalFilename(hugeHebrew);
    expect(Array.from(normalized).length).toBe(255);
  });

  it('returns an empty string for an empty or all-stripped input', () => {
    expect(normalizeOriginalFilename('')).toBe('');
    expect(normalizeOriginalFilename('\x00\x01\x02')).toBe('');
  });
});

describe('buildContentDispositionFilenameParts', () => {
  it('never throws for Hebrew, emoji, quotes, CRLF, path separators, or malformed input', () => {
    const inputs: (string | null | undefined)[] = [
      'עדות.png',
      '😀🎉.png',
      'a"b.png',
      'a\r\nb.png',
      'a/b\\c.png',
      null,
      undefined,
      '',
      '\uD83D', // a lone high surrogate — malformed on its own
    ];
    for (const input of inputs) {
      expect(() => buildContentDispositionFilenameParts(input)).not.toThrow();
    }
  });

  it('produces an ASCII-only fallback even for a fully non-ASCII name (the actual bug being fixed: Node throws ERR_INVALID_CHAR on a raw non-Latin1 header value)', () => {
    const { asciiFallback } = buildContentDispositionFilenameParts('עדות-😀.png');
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e]*$/.test(asciiFallback)).toBe(true);
  });

  it('never lets a raw quote or backslash reach the ASCII fallback (quoted-string escape safety)', () => {
    const { asciiFallback } = buildContentDispositionFilenameParts('a"b\\c.png');
    expect(asciiFallback).not.toContain('"');
    expect(asciiFallback).not.toContain('\\');
  });

  it('produces a percent-encoded filename* value that round-trips back to the original for Hebrew/emoji', () => {
    const { utf8Encoded } = buildContentDispositionFilenameParts('עדות-😀.png');
    expect(decodeURIComponent(utf8Encoded)).toBe('עדות-😀.png');
  });

  it('encodes characters excluded by the RFC 5987 attr-char grammar while preserving the filename', () => {
    const original = "report's (final)*.pdf";
    const { utf8Encoded } = buildContentDispositionFilenameParts(original);
    expect(utf8Encoded).not.toMatch(/['()*]/);
    expect(decodeURIComponent(utf8Encoded)).toBe(original);
  });

  it('falls back to a generic name when nothing usable remains', () => {
    const { asciiFallback, utf8Encoded } = buildContentDispositionFilenameParts('\x00\x01');
    expect(asciiFallback).toBe('evidence');
    expect(decodeURIComponent(utf8Encoded)).toBe('evidence');
  });

  it('never includes a literal CR or LF (header-injection safety)', () => {
    const { asciiFallback, utf8Encoded } = buildContentDispositionFilenameParts('a\r\nSet-Cookie: x=1');
    expect(asciiFallback).not.toMatch(/[\r\n]/);
    expect(decodeURIComponent(utf8Encoded)).not.toMatch(/[\r\n]/);
  });
});

describe('ensureEvidenceDir / writeEvidenceFile private permissions (POSIX only)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempEvidenceDir();
    process.env.EVIDENCE_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.EVIDENCE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('creates/tightens the evidence directory to owner-only 0700, even if it already existed with looser permissions', () => {
    fs.chmodSync(tempDir, 0o777);
    expect(fs.statSync(tempDir).mode & 0o777).toBe(0o777);
    ensureEvidenceDir();
    expect(fs.statSync(tempDir).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('writes evidence files with mode 0600 (owner-only read/write)', async () => {
    ensureEvidenceDir();
    const storedName = generateStoredFilename('.png');
    await writeEvidenceFile(storedName, Buffer.from('hello'));
    const mode = fs.statSync(path.join(tempDir, storedName)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('config.evidenceDir itself never creates the directory as a side effect (only ensureEvidenceDir/writeEvidenceFile do)', async () => {
    const freshDir = path.join(TEMP_ROOT, `never-created-${Date.now()}`);
    process.env.EVIDENCE_DIR = freshDir;
    const { config } = await import('../config.js');
    // Merely reading the getter must not create anything.
    expect(config.evidenceDir).toBe(path.resolve(freshDir));
    expect(fs.existsSync(freshDir)).toBe(false);
  });
});

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function setupCompletedOccurrence(app: ReturnType<typeof freshApp>, owner: { cookie: string }) {
  await request(app).post('/api/cycle').set('Cookie', owner.cookie).send({ name: 'Cycle A' });
  const goal = await request(app).post('/api/goals').set('Cookie', owner.cookie).send({ title: 'Goal A' });
  const tactic = await request(app)
    .post('/api/tactics')
    .set('Cookie', owner.cookie)
    .send({ goalId: goal.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
  const tacticId = tactic.body.id as number;
  await request(app)
    .post('/api/completions/toggle')
    .set('Cookie', owner.cookie)
    .send({ tacticId, week: 1, weekday: 0, done: true });
  return { tacticId };
}

describe('upsertEvidenceFileRecord (unit-level race-safety helper)', () => {
  let app: ReturnType<typeof freshApp>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempEvidenceDir();
    process.env.EVIDENCE_DIR = tempDir;
    app = freshApp();
  });

  afterEach(() => {
    delete process.env.EVIDENCE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it('commits and creates a brand-new record when the occurrence is completed', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    const db = getDb();
    const result = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'a.png',
      fileStoredName: 'aaa000.png',
      fileMime: 'image/png',
      fileSize: 3,
    });
    expect(result).toEqual({ status: 'committed', previousStoredName: null });
  });

  it('aborts (never creates a row) if there is no existing record and the occurrence is not completed', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goal.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
    const tacticId = tactic.body.id as number;
    const db = getDb();

    const result = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'a.png',
      fileStoredName: 'aaa001.png',
      fileMime: 'image/png',
      fileSize: 3,
    });
    expect(result.status).toBe('aborted');
    const row = db.prepare('SELECT * FROM tactic_evidence WHERE tactic_id = ?').get(tacticId);
    expect(row).toBeUndefined();
  });

  it('aborts if a record does not yet exist and the occurrence was unchecked since an earlier (advisory) check', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    // Simulates "unchecked during the caller's own async file-write await" — the fresh
    // re-check inside upsertEvidenceFileRecord must catch this, not an earlier stale check.
    await request(app).post('/api/completions/toggle').set('Cookie', a.cookie).send({ tacticId, week: 1, weekday: 0, done: false });
    const db = getDb();
    const result = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'a.png',
      fileStoredName: 'aaa002.png',
      fileMime: 'image/png',
      fileSize: 3,
    });
    expect(result.status).toBe('aborted');
  });

  it('captures the freshest previous stored name at call time, not any snapshot the caller may have taken earlier', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    const db = getDb();

    const first = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'a.png',
      fileStoredName: 'stored-a.png',
      fileMime: 'image/png',
      fileSize: 1,
    });
    expect(first).toEqual({ status: 'committed', previousStoredName: null });

    // Simulates "a different concurrent request already replaced the file" between when a
    // caller might have taken its own stale snapshot and when this call actually runs.
    const second = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'b.png',
      fileStoredName: 'stored-b.png',
      fileMime: 'image/png',
      fileSize: 1,
    });
    expect(second).toEqual({ status: 'committed', previousStoredName: 'stored-a.png' });

    // A third call must see "stored-b.png" as the fresh previous name — never the original
    // "stored-a.png" — proving the read is always fresh at call time.
    const third = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'c.png',
      fileStoredName: 'stored-c.png',
      fileMime: 'image/png',
      fileSize: 1,
    });
    expect(third).toEqual({ status: 'committed', previousStoredName: 'stored-b.png' });
  });

  it('editing an existing record never re-requires the occurrence to be completed', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    const db = getDb();
    upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'a.png',
      fileStoredName: 'stored-a.png',
      fileMime: 'image/png',
      fileSize: 1,
    });
    await request(app).post('/api/completions/toggle').set('Cookie', a.cookie).send({ tacticId, week: 1, weekday: 0, done: false });

    const result = upsertEvidenceFileRecord(db, {
      tacticId,
      week: 1,
      weekday: 0,
      fileOriginalName: 'b.png',
      fileStoredName: 'stored-b.png',
      fileMime: 'image/png',
      fileSize: 1,
    });
    expect(result).toEqual({ status: 'committed', previousStoredName: 'stored-a.png' });
  });
});

describe('currentEvidenceStoredName (post-commit self-race-check helper)', () => {
  let app: ReturnType<typeof freshApp>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempEvidenceDir();
    process.env.EVIDENCE_DIR = tempDir;
    app = freshApp();
  });

  afterEach(() => {
    delete process.env.EVIDENCE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it('reflects whichever call committed most recently, letting an earlier caller detect it lost a later race', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    const db = getDb();

    upsertEvidenceFileRecord(db, { tacticId, week: 1, weekday: 0, fileOriginalName: 'a.png', fileStoredName: 'stored-a.png', fileMime: 'image/png', fileSize: 1 });
    expect(currentEvidenceStoredName(db, tacticId, 1, 0)).toBe('stored-a.png');

    upsertEvidenceFileRecord(db, { tacticId, week: 1, weekday: 0, fileOriginalName: 'b.png', fileStoredName: 'stored-b.png', fileMime: 'image/png', fileSize: 1 });
    // The earlier ("a") caller, checking after the fact, would see it lost the race.
    expect(currentEvidenceStoredName(db, tacticId, 1, 0)).not.toBe('stored-a.png');
    expect(currentEvidenceStoredName(db, tacticId, 1, 0)).toBe('stored-b.png');
  });

  it('returns null for an occurrence with no evidence at all', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    expect(currentEvidenceStoredName(getDb(), tacticId, 1, 0)).toBeNull();
  });
});

describe('findOrphanedEvidenceFiles / deleteOrphanedEvidenceFiles (offline maintenance helpers)', () => {
  let app: ReturnType<typeof freshApp>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempEvidenceDir();
    process.env.EVIDENCE_DIR = tempDir;
    app = freshApp();
  });

  afterEach(() => {
    delete process.env.EVIDENCE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it('reports zero orphans and zero scanned when the directory is empty', async () => {
    await registerAndLogin(app, 'a@a.com');
    const result = findOrphanedEvidenceFiles(getDb());
    expect(result).toEqual({ orphanedFilenames: [], scannedCount: 0, skippedEntries: [] });
  });

  it('never reports a referenced (DB-known) file as orphaned', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    await request(app)
      .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
      .set('Cookie', a.cookie)
      .set('Content-Type', 'image/png')
      .set('X-Evidence-Filename', encodeURIComponent('a.png'))
      .send(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('body')]));

    const result = findOrphanedEvidenceFiles(getDb());
    expect(result.orphanedFilenames).toEqual([]);
    expect(result.scannedCount).toBe(1);
  });

  it('reports a generated-name file with no DB row as orphaned, and deleteOrphanedEvidenceFiles removes exactly it', async () => {
    await registerAndLogin(app, 'a@a.com');
    const orphanName = generateStoredFilename('.png');
    fs.writeFileSync(path.join(tempDir, orphanName), 'orphan bytes');

    const result = findOrphanedEvidenceFiles(getDb());
    expect(result.orphanedFilenames).toEqual([orphanName]);
    expect(result.scannedCount).toBe(1);

    const deleted = await deleteOrphanedEvidenceFiles(result.orphanedFilenames);
    expect(deleted).toEqual([orphanName]);
    expect(fs.existsSync(path.join(tempDir, orphanName))).toBe(false);
  });

  it('never touches a symlink or an unrecognized filename, even if it looks unreferenced — reports it as skipped instead', async () => {
    await registerAndLogin(app, 'a@a.com');
    // An unrecognized filename (doesn't match the generated-name pattern at all).
    fs.writeFileSync(path.join(tempDir, 'not-a-generated-name.txt'), 'hello');
    // A symlink pointing at a real file, even one with a technically-matching name.
    const realTarget = path.join(tempDir, 'real-target.png');
    fs.writeFileSync(realTarget, 'real bytes');
    const linkName = generateStoredFilename('.png');
    fs.symlinkSync(realTarget, path.join(tempDir, linkName));

    const result = findOrphanedEvidenceFiles(getDb());
    expect(result.orphanedFilenames).not.toContain(linkName);
    expect(result.skippedEntries).toContain('not-a-generated-name.txt');
    expect(result.skippedEntries).toContain(linkName);

    // Even if a caller mistakenly passed the symlink's name in, deleteOrphanedEvidenceFiles
    // re-validates against the same pattern and would still only accept generated-looking
    // names — this specific symlink's name DOES match the pattern (it was deliberately named
    // like one), so the real defense here is that findOrphanedEvidenceFiles never included it
    // in orphanedFilenames to begin with (asserted above).
  });

  it("documents the known gap: a raw cascading DB deletion (bypassing the app's own routes) leaves the evidence file behind on disk — exactly what the maintenance scan/CLI exists to find later", async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);
    await request(app)
      .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
      .set('Cookie', a.cookie)
      .set('Content-Type', 'image/png')
      .set('X-Evidence-Filename', encodeURIComponent('a.png'))
      .send(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('body')]));
    const db = getDb();
    const storedName = (
      db.prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as { file_stored_name: string }
    ).file_stored_name;

    // Simulates a hypothetical future user-deletion path (there is no such app route today —
    // see the module doc comment in lib/tacticEvidence.ts). A plain, fully-cascading delete
    // (foreign_keys stays ON, as it already is for every freshApp() database) correctly
    // removes the tactic_evidence row along with everything above it (cycle → goal → tactic),
    // but SQL's own ON DELETE CASCADE has no way to also remove the corresponding file from
    // disk — that's the gap this maintenance scan exists to catch.
    db.prepare('DELETE FROM users WHERE id = ?').run(a.userId);

    expect(fs.existsSync(path.join(tempDir, storedName))).toBe(true); // orphaned, as documented
    const result = findOrphanedEvidenceFiles(db);
    expect(result.orphanedFilenames).toEqual([storedName]); // exactly what the maintenance CLI would find
  });
});
