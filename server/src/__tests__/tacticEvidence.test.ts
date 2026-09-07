import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

// A fresh, unique temp directory per test — created inside the project (never under /tmp)
// and removed again in afterEach, so no test ever leaves stray files on disk and no two
// tests can ever collide over the same evidence directory.
const TEMP_ROOT = path.resolve(process.cwd(), '.tmp-evidence-tests');

function makeTempEvidenceDir(): string {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_ROOT, 'run-'));
}

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body-content-for-tests'),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('fake-jpeg-body')]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('fake-webp-body'),
]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake pdf body for tests\n%%EOF');
const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake-docx-zip-body')]);
const TXT_BYTES = Buffer.from('זוהי עדות טקסטואלית לבדיקה — plain UTF-8 text.', 'utf-8');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>');
const NUL_BYTES = Buffer.from('valid-looking\x00but-has-a-nul-byte');

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(app: ReturnType<typeof freshApp>, a: { cookie: string }, b: { userId: number }): Promise<void> {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  expect(res.status).toBe(201);
}

async function markDone(app: ReturnType<typeof freshApp>, cookie: string, tacticId: number, week: number, weekday: number): Promise<void> {
  await request(app).post('/api/completions/toggle').set('Cookie', cookie).send({ tacticId, week, weekday, done: true });
}

/** Sets up one owner with an active cycle → goal → tactic scheduled every Sunday (weekday 0),
 *  with week 1 / Sunday marked complete — the one occurrence most tests attach evidence to. */
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

describe('tactic evidence', () => {
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

  describe('metadata (note/link) CRUD + auth', () => {
    it('requires authentication on every route', async () => {
      expect((await request(app).get('/api/tactic-evidence/1/1/0')).status).toBe(401);
      expect((await request(app).put('/api/tactic-evidence/1/1/0').send({ note: 'x' })).status).toBe(401);
      expect((await request(app).delete('/api/tactic-evidence/1/1/0')).status).toBe(401);
      expect((await request(app).get('/api/tactic-evidence/cycle/1')).status).toBe(401);
    });

    it('returns { evidence: null } for a completed occurrence with no evidence yet', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const res = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(res.status).toBe(200);
      expect(res.body.evidence).toBeNull();
      expect(res.body.access).toBe('owner');
    });

    it('owner can create evidence with a note and link for a completed occurrence', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const res = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'עבדתי על זה שעה', link: 'https://example.com/proof' });
      expect(res.status).toBe(200);
      expect(res.body.note).toBe('עבדתי על זה שעה');
      expect(res.body.link).toBe('https://example.com/proof');
      expect(res.body.hasFile).toBe(false);
    });

    it('rejects creating evidence for an occurrence that is not currently completed', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
      const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
      const tactic = await request(app)
        .post('/api/tactics')
        .set('Cookie', a.cookie)
        .send({ goalId: goal.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
      const res = await request(app)
        .put(`/api/tactic-evidence/${tactic.body.id}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'לא אמור לעבוד' });
      expect(res.status).toBe(400);
    });

    it('rejects an empty record (no note, no link, no file) on create', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const res = await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({});
      expect(res.status).toBe(400);
    });

    it('rejects a non-http(s) link (e.g. javascript:) and a malformed URL', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const badProtocol = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ link: 'javascript:alert(1)' });
      expect(badProtocol.status).toBe(400);

      const malformed = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ link: 'not a url at all' });
      expect(malformed.status).toBe(400);

      const ftp = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ link: 'ftp://example.com/file' });
      expect(ftp.status).toBe(400);
    });

    it('is upsert/idempotent: repeated PUTs for the same occurrence update one row, never create a second', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'גרסה 1' });
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'גרסה 2' });
      const count = getDb().prepare('SELECT COUNT(*) as count FROM tactic_evidence').get() as { count: number };
      expect(count.count).toBe(1);
      const res = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(res.body.evidence.note).toBe('גרסה 2');
    });

    it('validates week/weekday route params', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      expect((await request(app).get(`/api/tactic-evidence/${tacticId}/13/0`).set('Cookie', a.cookie)).status).toBe(400);
      expect((await request(app).get(`/api/tactic-evidence/${tacticId}/0/0`).set('Cookie', a.cookie)).status).toBe(400);
      expect((await request(app).get(`/api/tactic-evidence/${tacticId}/1/7`).set('Cookie', a.cookie)).status).toBe(400);
      expect((await request(app).get(`/api/tactic-evidence/${tacticId}/1/-1`).set('Cookie', a.cookie)).status).toBe(400);
    });

    it('preserves existing evidence after the completion is later unchecked, and still allows the owner to edit it, but blocks creating brand-new evidence on a not-currently-completed occurrence', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'עדות לפני ביטול' });

      // Uncheck the completion.
      await request(app)
        .post('/api/completions/toggle')
        .set('Cookie', a.cookie)
        .send({ tacticId, week: 1, weekday: 0, done: false });

      const stillThere = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(stillThere.body.evidence.note).toBe('עדות לפני ביטול');

      // Editing the *existing* record is still allowed even though the occurrence is no
      // longer marked done.
      const edited = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'עדות אחרי ביטול — עדיין ניתן לערוך' });
      expect(edited.status).toBe(200);
      expect(edited.body.note).toBe('עדות אחרי ביטול — עדיין ניתן לערוך');

      // But a brand-new record on a *different*, never-completed occurrence is still blocked.
      const newOne = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'שבוע חדש שלא הושלם' });
      expect(newOne.status).toBe(400);
    });

    it('accepted partner can read but never write', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'עדות של א' });

      const read = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', b.cookie);
      expect(read.status).toBe(200);
      expect(read.body.access).toBe('partner');
      expect(read.body.evidence.note).toBe('עדות של א');

      const write = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', b.cookie)
        .send({ note: 'ניסיון כתיבה של שותף' });
      expect(write.status).toBe(403);

      const del = await request(app).delete(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', b.cookie);
      expect(del.status).toBe(403);
    });

    it('a stranger (no partnership) is denied entirely', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'עדות' });

      const read = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', stranger.cookie);
      expect(read.status).toBe(403);
      const write = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', stranger.cookie)
        .send({ note: 'x' });
      expect(write.status).toBe(403);
    });

    it('owner CRUD still works for an archived (no longer active) cycle', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'עדות לפני ארכוב' });

      // Archive the cycle (finish & start a new one).
      await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle B', confirm: true });

      const readAfterArchive = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(readAfterArchive.body.evidence.note).toBe('עדות לפני ארכוב');

      const editAfterArchive = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0`)
        .set('Cookie', a.cookie)
        .send({ note: 'עריכה אחרי ארכוב — עדיין מותר' });
      expect(editAfterArchive.status).toBe(200);
      expect(editAfterArchive.body.note).toBe('עריכה אחרי ארכוב — עדיין מותר');
    });

    it('deleting the whole record removes it (idempotent — deleting again is a harmless no-op)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'עדות' });

      const del1 = await request(app).delete(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(del1.status).toBe(200);
      const afterDelete = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(afterDelete.body.evidence).toBeNull();

      const del2 = await request(app).delete(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(del2.status).toBe(200);
    });
  });

  describe('file upload/download/replace/delete', () => {
    function uploadPng(cookie: string, tacticId: number, week: number, weekday: number, filename = 'proof.png') {
      return request(app)
        .put(`/api/tactic-evidence/${tacticId}/${week}/${weekday}/file`)
        .set('Cookie', cookie)
        .set('Content-Type', 'image/png')
        .set('X-Evidence-Filename', encodeURIComponent(filename))
        .send(PNG_BYTES);
    }

    it('accepts a valid PNG upload and the file is downloadable byte-for-byte with correct headers', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const upload = await uploadPng(a.cookie, tacticId, 1, 0);
      expect(upload.status).toBe(200);
      expect(upload.body.hasFile).toBe(true);
      expect(upload.body.fileMime).toBe('image/png');
      expect(upload.body.fileOriginalName).toBe('proof.png');

      const download = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', a.cookie);
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toMatch(/^image\/png/);
      expect(download.headers['content-disposition']).toContain('inline');
      expect(download.headers['cache-control']).toBe('private, no-store');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(download.body as Buffer, PNG_BYTES)).toBe(0);
    });

    it('accepts JPEG, WebP, PDF, DOCX (signature + .docx name), and TXT (strict UTF-8 + .txt name)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);

      const jpeg = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/jpeg')
        .set('X-Evidence-Filename', encodeURIComponent('a.jpg'))
        .send(JPEG_BYTES);
      expect(jpeg.status).toBe(200);
      expect(jpeg.body.fileMime).toBe('image/jpeg');

      const webp = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/webp')
        .set('X-Evidence-Filename', encodeURIComponent('a.webp'))
        .send(WEBP_BYTES);
      expect(webp.status).toBe(400); // week 2 was never marked complete — creating new evidence there must be rejected

      await markDone(app, a.cookie, tacticId, 2, 0);
      const webpRetry = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/webp')
        .set('X-Evidence-Filename', encodeURIComponent('a.webp'))
        .send(WEBP_BYTES);
      expect(webpRetry.status).toBe(200);
      expect(webpRetry.body.fileMime).toBe('image/webp');

      await markDone(app, a.cookie, tacticId, 3, 0);
      const pdf = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/3/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/pdf')
        .set('X-Evidence-Filename', encodeURIComponent('a.pdf'))
        .send(PDF_BYTES);
      expect(pdf.status).toBe(200);
      expect(pdf.body.fileMime).toBe('application/pdf');

      await markDone(app, a.cookie, tacticId, 4, 0);
      const docx = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/4/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .set('X-Evidence-Filename', encodeURIComponent('a.docx'))
        .send(DOCX_BYTES);
      expect(docx.status).toBe(200);
      expect(docx.body.fileMime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

      await markDone(app, a.cookie, tacticId, 5, 0);
      const txt = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/5/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'text/plain')
        .set('X-Evidence-Filename', encodeURIComponent('a.txt'))
        .send(TXT_BYTES);
      expect(txt.status).toBe(200);
      expect(txt.body.fileMime).toBe('text/plain');
    });

    it('rejects DOCX-signature content without a .docx filename, and TXT content without a .txt filename', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const docxNoName = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .set('X-Evidence-Filename', encodeURIComponent('not-a-docx-name.zip'))
        .send(DOCX_BYTES);
      expect(docxNoName.status).toBe(400);

      await markDone(app, a.cookie, tacticId, 2, 0);
      const txtNoName = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'text/plain')
        .set('X-Evidence-Filename', encodeURIComponent('not-txt.dat'))
        .send(TXT_BYTES);
      expect(txtNoName.status).toBe(400);
    });

    it('rejects a NUL byte or other raw control character in a claimed TXT file', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const res = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'text/plain')
        .set('X-Evidence-Filename', encodeURIComponent('a.txt'))
        .send(NUL_BYTES);
      expect(res.status).toBe(400);
    });

    it('rejects SVG and HTML outright (not in the accepted Content-Type list at all)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const svg = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/svg+xml')
        .set('X-Evidence-Filename', encodeURIComponent('a.svg'))
        .send(SVG_BYTES);
      expect(svg.status).toBe(400);

      await markDone(app, a.cookie, tacticId, 2, 0);
      const html = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'text/html')
        .set('X-Evidence-Filename', encodeURIComponent('a.html'))
        .send(HTML_BYTES);
      expect(html.status).toBe(400);
    });

    it('rejects unrecognized/executable-looking content even under an allowed Content-Type header', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const fakeExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // "MZ" DOS header
      const res = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/pdf')
        .set('X-Evidence-Filename', encodeURIComponent('a.pdf'))
        .send(fakeExe);
      expect(res.status).toBe(400);
    });

    it('rejects a mismatched declared Content-Type vs. sniffed content (spoofing)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      // Real PNG bytes, but declared as application/pdf.
      const res = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/pdf')
        .set('X-Evidence-Filename', encodeURIComponent('a.pdf'))
        .send(PNG_BYTES);
      expect(res.status).toBe(400);
    });

    it('enforces the 8 MiB max file size', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      // Spoofs a Content-Length above the limit while sending only a tiny real body (mirrors
      // profile.test.ts's identical avatar-oversized-upload test): the Content-Length precheck
      // rejects (and drains) the request before any large payload would ever need to be
      // transferred, avoiding a slow/flaky large-payload transfer in the test itself.
      const res = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/png')
        .set('Content-Length', String(8 * 1024 * 1024 + 1))
        .send(PNG_BYTES);
      expect(res.status).toBe(413);
    });

    it('uses a random, unguessable stored filename — never the original name or anything path-traversal-like', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/png')
        .set('X-Evidence-Filename', encodeURIComponent('../../../etc/passwd.png'))
        .send(PNG_BYTES);

      const row = getDb().prepare('SELECT file_stored_name, file_original_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as {
        file_stored_name: string;
        file_original_name: string;
      };
      expect(row.file_stored_name).toMatch(/^[0-9a-f]{48}\.png$/);
      expect(row.file_stored_name).not.toContain('..');
      expect(row.file_stored_name).not.toContain('/');
      // The original (client-supplied) name is normalized at ingest — reduced to just its
      // final path segment (never trusted/used as an actual filesystem path either way, only
      // ever this display metadata) — see normalizeOriginalFilename in lib/tacticEvidence.ts.
      expect(row.file_original_name).toBe('passwd.png');

      const filesOnDisk = fs.readdirSync(tempDir);
      expect(filesOnDisk).toEqual([row.file_stored_name]);
    });

    it('replacing a file deletes the old one from disk only after the DB commit succeeds', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await uploadPng(a.cookie, tacticId, 1, 0, 'first.png');
      const firstRow = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as {
        file_stored_name: string;
      };
      const firstPath = path.join(tempDir, firstRow.file_stored_name);
      expect(fs.existsSync(firstPath)).toBe(true);

      await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'application/pdf')
        .set('X-Evidence-Filename', encodeURIComponent('second.pdf'))
        .send(PDF_BYTES);

      const secondRow = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as {
        file_stored_name: string;
      };
      expect(secondRow.file_stored_name).not.toBe(firstRow.file_stored_name);
      expect(fs.existsSync(firstPath)).toBe(false); // old file cleaned up
      expect(fs.existsSync(path.join(tempDir, secondRow.file_stored_name))).toBe(true);
      // Only ever the current file remains on disk — no accumulation of orphans.
      expect(fs.readdirSync(tempDir)).toEqual([secondRow.file_stored_name]);
    });

    it('rolls back (deletes) the just-written file if the DB write fails, leaving no orphan on disk', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const db = getDb();
      // Simulates the DB half of the operation failing after the file has already been
      // written to disk. Each test gets a brand-new in-memory DB (see beforeEach), so there's
      // no need to restore the schema afterward — the next test starts completely fresh.
      db.exec('ALTER TABLE tactic_evidence RENAME TO tactic_evidence_broken_for_test');
      const filesBefore = fs.readdirSync(tempDir).length;
      const res = await uploadPng(a.cookie, tacticId, 1, 0);
      expect(res.status).toBe(500);
      const filesAfter = fs.readdirSync(tempDir).length;
      expect(filesAfter).toBe(filesBefore);
    });

    it('deleting just the file removes it from disk; if note/link remain the metadata row survives, otherwise the whole row is removed', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);

      // Case 1: file-only record — deleting the file deletes the whole row.
      await uploadPng(a.cookie, tacticId, 1, 0);
      const row1 = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as {
        file_stored_name: string;
      };
      const delFile1 = await request(app).delete(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', a.cookie);
      expect(delFile1.status).toBe(200);
      expect(delFile1.body.evidence).toBeNull();
      expect(fs.existsSync(path.join(tempDir, row1.file_stored_name))).toBe(false);
      const afterCase1 = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie);
      expect(afterCase1.body.evidence).toBeNull();

      // Case 2: note + file — deleting the file keeps the metadata row alive.
      await markDone(app, a.cookie, tacticId, 2, 0);
      await request(app).put(`/api/tactic-evidence/${tacticId}/2/0`).set('Cookie', a.cookie).send({ note: 'נשאר' });
      await uploadPng(a.cookie, tacticId, 2, 0);
      const delFile2 = await request(app).delete(`/api/tactic-evidence/${tacticId}/2/0/file`).set('Cookie', a.cookie);
      expect(delFile2.status).toBe(200);
      expect(delFile2.body.evidence).not.toBeNull();
      expect(delFile2.body.evidence.note).toBe('נשאר');
      expect(delFile2.body.evidence.hasFile).toBe(false);
    });

    it('accepted partner can download the file but not upload/replace/delete it', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await uploadPng(a.cookie, tacticId, 1, 0);

      const download = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', b.cookie);
      expect(download.status).toBe(200);
      expect(Buffer.compare(download.body as Buffer, PNG_BYTES)).toBe(0);

      const upload = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', b.cookie)
        .set('Content-Type', 'image/png')
        .set('X-Evidence-Filename', encodeURIComponent('x.png'))
        .send(PNG_BYTES);
      expect(upload.status).toBe(403);

      const del = await request(app).delete(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', b.cookie);
      expect(del.status).toBe(403);
    });

    it('a stranger cannot download the file', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await uploadPng(a.cookie, tacticId, 1, 0);
      const res = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', stranger.cookie);
      expect(res.status).toBe(403);
    });

    it('deleting the whole tactic cleans up its evidence file from disk', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await uploadPng(a.cookie, tacticId, 1, 0);
      const row = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as {
        file_stored_name: string;
      };
      const filePath = path.join(tempDir, row.file_stored_name);
      expect(fs.existsSync(filePath)).toBe(true);

      const del = await request(app).delete(`/api/tactics/${tacticId}`).set('Cookie', a.cookie);
      expect(del.status).toBe(204);

      // File cleanup is scheduled via setImmediate and then does real (async) filesystem
      // I/O — poll briefly rather than assuming a single microtask/macrotask tick is enough.
      const deadline = Date.now() + 2000;
      while (fs.existsSync(filePath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('deleting a goal cleans up evidence files under every one of its tactics, not only the DB rows', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
      const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
      const goalId = goal.body.id as number;
      const tacticX = await request(app)
        .post('/api/tactics')
        .set('Cookie', a.cookie)
        .send({ goalId, title: 'Tactic X', weekdays: [0], startWeek: 1, endWeek: 12 });
      const tacticY = await request(app)
        .post('/api/tactics')
        .set('Cookie', a.cookie)
        .send({ goalId, title: 'Tactic Y', weekdays: [0], startWeek: 1, endWeek: 12 });
      const tacticXId = tacticX.body.id as number;
      const tacticYId = tacticY.body.id as number;
      await markDone(app, a.cookie, tacticXId, 1, 0);
      await markDone(app, a.cookie, tacticYId, 1, 0);
      await uploadPng(a.cookie, tacticXId, 1, 0, 'x.png');
      await uploadPng(a.cookie, tacticYId, 1, 0, 'y.png');

      const rowX = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticXId) as {
        file_stored_name: string;
      };
      const rowY = getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticYId) as {
        file_stored_name: string;
      };
      const pathX = path.join(tempDir, rowX.file_stored_name);
      const pathY = path.join(tempDir, rowY.file_stored_name);
      expect(fs.existsSync(pathX)).toBe(true);
      expect(fs.existsSync(pathY)).toBe(true);

      const del = await request(app).delete(`/api/goals/${goalId}`).set('Cookie', a.cookie).send({ confirm: true });
      expect(del.status).toBe(204);

      const deadline = Date.now() + 2000;
      while ((fs.existsSync(pathX) || fs.existsSync(pathY)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(fs.existsSync(pathX)).toBe(false);
      expect(fs.existsSync(pathY)).toBe(false);
    });

    it('never crashes on a Hebrew/emoji original filename and round-trips it correctly through Content-Disposition on download', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const upload = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/png')
        .set('X-Evidence-Filename', encodeURIComponent('עדות-😀-חשובה.png'))
        .send(PNG_BYTES);
      expect(upload.status).toBe(200);
      expect(upload.body.fileOriginalName).toBe('עדות-😀-חשובה.png');

      const download = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', a.cookie);
      expect(download.status).toBe(200);
      const disposition = download.headers['content-disposition'] as string;
      expect(disposition).toBeTruthy();
      expect(disposition).toContain('inline');
      expect(disposition).toContain("filename*=UTF-8''");
      const utf8Part = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? '';
      expect(decodeURIComponent(utf8Part)).toBe('עדות-😀-חשובה.png');
      expect(Buffer.compare(download.body as Buffer, PNG_BYTES)).toBe(0);
    });

    it('never crashes and never injects a header on a malicious original filename (quotes, CRLF, path separators)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      const maliciousName = 'a"; evil\r\nSet-Cookie: hacked=1\r\n.png';
      const upload = await request(app)
        .put(`/api/tactic-evidence/${tacticId}/1/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'image/png')
        .set('X-Evidence-Filename', encodeURIComponent(maliciousName))
        .send(PNG_BYTES);
      expect(upload.status).toBe(200);

      const download = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', a.cookie);
      expect(download.status).toBe(200);
      const disposition = download.headers['content-disposition'] as string;
      expect(disposition).toBeTruthy();
      expect(disposition).not.toMatch(/[\r\n]/);
      // No stray unescaped quote inside the ASCII filename="..." parameter that could break
      // out of the quoted string.
      const asciiMatch = disposition.match(/filename="([^]*?)";\s*filename\*/);
      expect(asciiMatch).toBeTruthy();
      expect(asciiMatch![1]).not.toContain('"');
      // Only one Set-Cookie-looking header actually present is our own session cookie, if
      // any — the malicious text must never have become its own header.
      const setCookieHeaders = download.headers['set-cookie'];
      if (setCookieHeaders) {
        for (const h of setCookieHeaders as unknown as string[]) {
          expect(h).not.toContain('hacked=1');
        }
      }
    });

    it('sets Content-Security-Policy: sandbox on an inline (image/PDF) download but not on an attachment (DOCX/TXT) download', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const { tacticId } = await setupCompletedOccurrence(app, a);
      await uploadPng(a.cookie, tacticId, 1, 0);
      const imageDownload = await request(app).get(`/api/tactic-evidence/${tacticId}/1/0/file`).set('Cookie', a.cookie);
      expect(imageDownload.headers['content-security-policy']).toBe('sandbox');

      await markDone(app, a.cookie, tacticId, 2, 0);
      await request(app)
        .put(`/api/tactic-evidence/${tacticId}/2/0/file`)
        .set('Cookie', a.cookie)
        .set('Content-Type', 'text/plain')
        .set('X-Evidence-Filename', encodeURIComponent('a.txt'))
        .send(TXT_BYTES);
      const txtDownload = await request(app).get(`/api/tactic-evidence/${tacticId}/2/0/file`).set('Cookie', a.cookie);
      expect(txtDownload.headers['content-disposition']).toContain('attachment');
      expect(txtDownload.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('cycle evidence gallery', () => {
    it('lists evidence grouped-ready by week/tactic with goal/tactic context, for owner and partner, denies a stranger', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      await pairUsers(app, a, b);

      const cycleRes = await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
      const cycleId = cycleRes.body.id as number;
      const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
      const tactic = await request(app)
        .post('/api/tactics')
        .set('Cookie', a.cookie)
        .send({ goalId: goal.body.id, title: 'Tactic A', weekdays: [0, 2], startWeek: 1, endWeek: 12 });
      const tacticId = tactic.body.id as number;
      await request(app).post('/api/completions/toggle').set('Cookie', a.cookie).send({ tacticId, week: 1, weekday: 0, done: true });
      await request(app).post('/api/completions/toggle').set('Cookie', a.cookie).send({ tacticId, week: 1, weekday: 2, done: true });
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'ראשון' });
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/2`).set('Cookie', a.cookie).send({ note: 'שני' });

      const ownerRes = await request(app).get(`/api/tactic-evidence/cycle/${cycleId}`).set('Cookie', a.cookie);
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.items).toHaveLength(2);
      expect(ownerRes.body.items[0].tacticTitle).toBe('Tactic A');
      expect(ownerRes.body.items[0].goalTitle).toBe('Goal A');
      expect(ownerRes.body.items[0].week).toBe(1);

      const partnerRes = await request(app).get(`/api/tactic-evidence/cycle/${cycleId}`).set('Cookie', b.cookie);
      expect(partnerRes.status).toBe(200);
      expect(partnerRes.body.access).toBe('partner');
      expect(partnerRes.body.items).toHaveLength(2);

      const strangerRes = await request(app).get(`/api/tactic-evidence/cycle/${cycleId}`).set('Cookie', stranger.cookie);
      expect(strangerRes.status).toBe(403);
    });

    it('remains accessible for an archived cycle', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const cycleRes = await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
      const cycleId = cycleRes.body.id as number;
      const goal = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
      const tactic = await request(app)
        .post('/api/tactics')
        .set('Cookie', a.cookie)
        .send({ goalId: goal.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
      const tacticId = tactic.body.id as number;
      await request(app).post('/api/completions/toggle').set('Cookie', a.cookie).send({ tacticId, week: 1, weekday: 0, done: true });
      await request(app).put(`/api/tactic-evidence/${tacticId}/1/0`).set('Cookie', a.cookie).send({ note: 'עדות' });

      await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle B', confirm: true });

      const res = await request(app).get(`/api/tactic-evidence/cycle/${cycleId}`).set('Cookie', a.cookie);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });
  });
});
