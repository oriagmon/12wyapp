import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';

// Mocks writeEvidenceFile with a per-call-index gate so a specific upload's file write can be
// deterministically held open (never resolving) until the test explicitly releases it, and the
// test can deterministically wait for that write to have actually started before proceeding —
// no reliance on timing/sleep/tick-counting. Every other export passes through unchanged (see
// importOriginal), so every other route/behavior in this module is unaffected.
interface WriteGate {
  /** Resolves once `writeEvidenceFile` has actually been called for the armed call index and
   *  is now blocked awaiting `release()` — the deterministic signal tests wait on instead of
   *  any timing assumption. */
  entered: Promise<void>;
  /** Unblocks the gated `writeEvidenceFile` call, letting the real write proceed. */
  release: () => void;
}
let callIndex = 0;
const gatesByCallIndex = new Map<number, { gatePromise: Promise<void>; releaseGate: () => void; enteredPromise: Promise<void>; markEntered: () => void }>();

function armGateForNextCall(callSlot: number): WriteGate {
  let releaseGate: () => void = () => {};
  const gatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let markEntered: () => void = () => {};
  const enteredPromise = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  gatesByCallIndex.set(callSlot, { gatePromise, releaseGate, enteredPromise, markEntered });
  return { entered: enteredPromise, release: releaseGate };
}

vi.mock('../lib/tacticEvidence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tacticEvidence.js')>();
  return {
    ...actual,
    writeEvidenceFile: async (storedName: string, data: Buffer) => {
      const idx = callIndex++;
      const cfg = gatesByCallIndex.get(idx);
      if (cfg) {
        cfg.markEntered();
        await cfg.gatePromise;
      }
      return actual.writeEvidenceFile(storedName, data);
    },
    readEvidenceFile: async (storedName: string) => {
      const data = await actual.readEvidenceFile(storedName);
      const cfg = gatesByCallIndex.get(-1);
      if (cfg) {
        cfg.markEntered();
        await cfg.gatePromise;
      }
      return data;
    },
  };
});

import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

const TEMP_ROOT = path.resolve(process.cwd(), '.tmp-evidence-tests');
function makeTempEvidenceDir(): string {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_ROOT, 'race-run-'));
}

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('body-one')]);
const PNG_BYTES_2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('body-two-longer')]);
const PNG_BYTES_3 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('body-three-x')]);

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

function uploadPng(app: ReturnType<typeof freshApp>, cookie: string, tacticId: number, week: number, weekday: number | null, filename: string, bytes: Buffer) {
  const scope = weekday === null ? `weekly/${tacticId}/${week}` : `${tacticId}/${week}/${weekday}`;
  return request(app)
    .put(`/api/tactic-evidence/${scope}/file`)
    .set('Cookie', cookie)
    .set('Content-Type', 'image/png')
    .set('X-Evidence-Filename', encodeURIComponent(filename))
    .send(bytes);
}

describe('tactic evidence: deterministic concurrent-upload races (deferred file write)', () => {
  let app: ReturnType<typeof freshApp>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempEvidenceDir();
    process.env.EVIDENCE_DIR = tempDir;
    callIndex = 0;
    gatesByCallIndex.clear();
    app = freshApp();
  });

  afterEach(() => {
    delete process.env.EVIDENCE_DIR;
    gatesByCallIndex.clear();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it.each([null, 0])('aborts and cleans up when the last completion is unchecked during the write: %s', async (weekday) => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);

    // The very first writeEvidenceFile call in this test is call index 0 — gate it.
    const gate = armGateForNextCall(0);

    const uploadPromise = uploadPng(app, a.cookie, tacticId, 1, weekday, 'a.png', PNG_BYTES);
    // supertest/superagent `Test` objects are lazy thenables — the request is only actually
    // sent once something calls `.then()`/awaits them. Kick it off explicitly here (rather
    // than relying on the later `await uploadPromise` to do so), otherwise `gate.entered`
    // below would never resolve since the request would never actually reach the route.
    void uploadPromise.catch(() => undefined);
    // Deterministically wait until the write has actually started (and is now blocked on the
    // gate) before doing anything else — no timing assumptions.
    await gate.entered;

    const uncheck = await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId, week: 1, weekday: 0, done: false });
    expect(uncheck.status).toBe(200);

    gate.release();
    const res = await uploadPromise;
    expect(res.status).toBe(400);

    // No orphan file left behind, and no evidence row was ever created for what would have
    // been a brand-new record on a now-incomplete occurrence.
    expect(fs.readdirSync(tempDir)).toEqual([]);
    const row = getDb().prepare('SELECT * FROM tactic_evidence WHERE tactic_id = ?').get(tacticId);
    expect(row).toBeUndefined();
  });

  it.each([null, 0])('cleans the freshest previous file after overlapping replacements: %s', async (weekday) => {
    const a = await registerAndLogin(app, 'a@a.com');
    const { tacticId } = await setupCompletedOccurrence(app, a);

    // First upload completes normally (call index 0, unglated) to seed an existing file.
    const first = await uploadPng(app, a.cookie, tacticId, 1, weekday, 'first.png', PNG_BYTES);
    expect(first.status).toBe(200);
    const firstStoredName = (
      getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as { file_stored_name: string }
    ).file_stored_name;
    expect(fs.existsSync(path.join(tempDir, firstStoredName))).toBe(true);

    // The SECOND upload's write is call index 1 — gate it so it starts, then stalls.
    const gate = armGateForNextCall(1);
    const secondPromise = uploadPng(app, a.cookie, tacticId, 1, weekday, 'second.png', PNG_BYTES_2);
    // See the identical comment in the previous test — supertest's lazy thenable needs an
    // explicit kick before we can deterministically await its write having started.
    void secondPromise.catch(() => undefined);
    await gate.entered;

    // While the second upload's own file write is stalled, a THIRD upload for the very same
    // occurrence runs to completion first — this is the "overlapping replacement" the second
    // upload's own pre-write snapshot (taken before its own await) could not have known about.
    const third = await uploadPng(app, a.cookie, tacticId, 1, weekday, 'third.png', PNG_BYTES_3);
    expect(third.status).toBe(200);
    const thirdStoredName = (
      getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as { file_stored_name: string }
    ).file_stored_name;
    // Third's own upsert correctly saw "first" as the fresh previous file and cleaned it up.
    expect(fs.existsSync(path.join(tempDir, firstStoredName))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, thirdStoredName))).toBe(true);

    gate.release();
    const second = await secondPromise;
    expect(second.status).toBe(200);
    const finalStoredName = (
      getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as { file_stored_name: string }
    ).file_stored_name;

    // Whatever the DB says is current now, exactly one file remains on disk — the current
    // one. Neither "first" (already handled above) nor "third" (this test's actual point) is
    // left behind as an orphan: the second upload's own transaction re-read the occurrence
    // fresh and saw "third" as the previous file to clean up, not a stale "first".
    // Second (the later-completing request) correctly won and became current — proving its
    // own transaction's "previous" read was fresh (saw "third"), not the stale "first" its
    // own pre-write snapshot would have shown.
    expect(finalStoredName).not.toBe(thirdStoredName);
    expect(fs.readdirSync(tempDir)).toEqual([finalStoredName]);
  });

  it('rechecks owner session after a weekly file write and cleans only the rejected replacement', async () => {
    const owner = await registerAndLogin(app, 'owner@example.test');
    const { tacticId } = await setupCompletedOccurrence(app, owner);
    expect((await uploadPng(app, owner.cookie, tacticId, 1, null, 'original.png', PNG_BYTES)).status).toBe(200);
    const original = getDb().prepare('SELECT * FROM tactic_evidence').all();
    const originalFiles = fs.readdirSync(tempDir);
    const gate = armGateForNextCall(1);
    const pending = uploadPng(app, owner.cookie, tacticId, 1, null, 'rejected.png', PNG_BYTES_2);
    void pending.catch(() => undefined);
    await gate.entered;
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(owner.userId);
    gate.release();
    expect((await pending).status).toBe(401);
    expect(getDb().prepare('SELECT * FROM tactic_evidence').all()).toEqual(original);
    expect(fs.readdirSync(tempDir)).toEqual(originalFiles);
  });

  it.each(['partnership', 'session', 'file'] as const)('does not disclose bytes revoked during a weekly download: %s', async (revoked) => {
    const owner = await registerAndLogin(app, 'owner@example.test');
    const partner = await registerAndLogin(app, 'partner@example.test');
    expect((await request(app).post('/api/partnerships/pair').set('Cookie', owner.cookie)
      .send({ targetUserId: partner.userId })).status).toBe(201);
    const { tacticId } = await setupCompletedOccurrence(app, owner);
    expect((await uploadPng(app, owner.cookie, tacticId, 1, null, 'original.png', PNG_BYTES)).status).toBe(200);
    const gate = armGateForNextCall(-1);
    const url = `/api/tactic-evidence/weekly/${tacticId}/1/file`;
    const pending = request(app).get(url).set('Cookie', partner.cookie);
    void pending.catch(() => undefined);
    await gate.entered;
    if (revoked === 'partnership') getDb().prepare('DELETE FROM partnerships').run();
    else if (revoked === 'session') getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(partner.userId);
    else expect((await request(app).delete(url).set('Cookie', owner.cookie)).status).toBe(200);
    gate.release();
    const response = await pending;
    expect(response.status).toBe(revoked === 'partnership' ? 403 : revoked === 'session' ? 401 : 409);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toEqual(PNG_BYTES);
  });
});
