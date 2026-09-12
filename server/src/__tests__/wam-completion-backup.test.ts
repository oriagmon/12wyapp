import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import {
  BACKUP_SNAPSHOT_SCHEMA_VERSION,
  INTENTIONALLY_EXCLUDED_TABLES,
  auditSnapshotSchema,
  buildAppDataSnapshot,
  computeSnapshotShapeId,
  describeSnapshotShape,
  insertWamCompletionBackupIfAbsent,
} from '../lib/wamCompletionBackup.js';
import { createResetToken } from '../lib/passwordReset.js';

vi.mock('../lib/emailSender.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../lib/emailSender.js';
import { getPresetByKey } from '../lib/broosts.js';

const sendEmailMock = vi.mocked(sendEmail);

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(app: ReturnType<typeof freshApp>, a: { cookie: string; userId: number }, b: { cookie: string; userId: number }): Promise<number> {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

function futureIso(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function backupCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as count FROM backup').get() as { count: number }).count;
}

/** BROOST email delivery is deliberately deferred via setImmediate until after the POST /
 *  response has already been sent (see routes/broosts.ts) — awaiting one macrotask tick here
 *  is enough to deterministically observe it having run to completion before this test moves
 *  on to check the resulting backup snapshot (mirrors the identical helper in
 *  broosts.test.ts/password-reset.test.ts). */
function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('WAM completion backups: API-level behavior', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  it('creates exactly one backup row when a WAM is completed (no scheduling, so no email involved)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    expect(backupCount()).toBe(0);
    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(completed.status).toBe(200);
    expect(backupCount()).toBe(1);

    const row = getDb().prepare('SELECT * FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      triggering_wam_id: number;
      schema_version: number;
      snapshot_json: string;
    };
    expect(row.triggering_wam_id).toBe(wamId);
    expect(row.schema_version).toBe(BACKUP_SNAPSHOT_SCHEMA_VERSION);
    expect(() => JSON.parse(row.snapshot_json)).not.toThrow();
  });

  it('the snapshot contains both partnered users and the just-completed WAM/frozen scores', async () => {
    const a = await registerAndLogin(app, 'owner-a@a.com');
    const b = await registerAndLogin(app, 'owner-b@a.com');
    await pairUsers(app, a, b);

    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const goalA = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
    const tacticA = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goalA.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId: tacticA.body.id, week: 1, weekday: 0, done: true });

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', b.cookie).send({});
    expect(completed.status).toBe(200);

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    const snapshot = JSON.parse(row.snapshot_json) as {
      schemaVersion: number;
      generatedAt: string;
      tables: Record<string, unknown[]>;
    };

    expect(snapshot.schemaVersion).toBe(BACKUP_SNAPSHOT_SCHEMA_VERSION);
    expect(typeof snapshot.generatedAt).toBe('string');

    const users = snapshot.tables.users as { id: number; email: string }[];
    expect(users.map((u) => u.email).sort()).toEqual(['owner-a@a.com', 'owner-b@a.com']);

    const wams = snapshot.tables.wams as { id: number; status: string }[];
    const snapshotWam = wams.find((w) => w.id === wamId);
    expect(snapshotWam?.status).toBe('complete');

    const reviews = snapshot.tables.wam_reviews as { wamId: number; scoreSnapshot: number | null }[];
    const reviewA = reviews.find((r) => r.wamId === wamId && r.scoreSnapshot !== null);
    expect(reviewA?.scoreSnapshot).toBe(100);

    // Representative data from every other current safe table is present as arrays (even if
    // empty for this scenario) — proves the full allowlist ran, not just a couple of tables.
    for (const table of [
      'user_settings',
      'partnerships',
      'cycles',
      'goals',
      'tactics',
      'tactic_week_overrides',
      'completions',
      'wam_commitments',
      'wam_email_reminders',
      'wam_calendar_invitations',
      'weekly_planning_rituals',
      'scheduled_email_reminders',
      'execution_recovery_plans',
      'partner_broosts',
      'week_milestone_emails',
      'week_recap_emails',
      'tactic_evidence',
      'wam_punishments',
    ]) {
      expect(Array.isArray(snapshot.tables[table])).toBe(true);
    }
  });

  it('includes actual execution_recovery_plans row data (not just an empty array) when one exists', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const meA = await request(app).get('/api/auth/me').set('Cookie', a.cookie);
    const cycleRes = await request(app).get(`/api/dashboard/${meA.body.id}`).set('Cookie', a.cookie);
    const cycleId = cycleRes.body.cycle.id as number;

    await request(app)
      .put(`/api/execution-recovery/${a.userId}`)
      .set('Cookie', a.cookie)
      .send({ note: 'תוכנית חילוץ לדוגמה עבור גיבוי' });

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    const snapshot = JSON.parse(row.snapshot_json) as { tables: Record<string, unknown[]> };
    const plans = snapshot.tables.execution_recovery_plans as { cycleId: number; strategy: string; note: string; status: string }[];
    const plan = plans.find((p) => p.cycleId === cycleId);
    expect(plan?.strategy).toBe('maneuver');
    expect(plan?.note).toBe('תוכנית חילוץ לדוגמה עבור גיבוי');
    expect(plan?.status).toBe('active');
  });

  it('includes actual partner_broosts row data (message content in full, email error redacted to a boolean)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);

    sendEmailMock.mockImplementation(async () => {
      throw new Error('ACS outage detail that must never leak');
    });
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
    const sent = await request(app).post('/api/broosts').set('Cookie', a.cookie).send({ presetKey: 'great_job' });
    expect(sent.status).toBe(201);
    await flushSetImmediate();
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    expect(row.snapshot_json).not.toContain('ACS outage detail that must never leak');
    const snapshot = JSON.parse(row.snapshot_json) as { tables: Record<string, unknown[]> };
    const broosts = snapshot.tables.partner_broosts as {
      senderId: number;
      message: string;
      emailStatus: string;
      hasEmailError: number;
    }[];
    expect(broosts.length).toBe(1);
    expect(broosts[0].senderId).toBe(a.userId);
    // Bound to the catalog rather than a copy of the sentence, so rewording a preset can never
    // silently break an unrelated backup test again.
    expect(broosts[0].message).toBe(getPresetByKey('great_job')!.message);
    expect(broosts[0].emailStatus).toBe('failed');
    expect(broosts[0].hasEmailError).toBe(1);
  });

  it('includes actual tactic_evidence row data (note/link/file metadata in full, hasFile computed) and excludes the random stored filename', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    const goalA = await request(app).post('/api/goals').set('Cookie', a.cookie).send({ title: 'Goal A' });
    const tacticA = await request(app)
      .post('/api/tactics')
      .set('Cookie', a.cookie)
      .send({ goalId: goalA.body.id, title: 'Tactic A', weekdays: [0], startWeek: 1, endWeek: 12 });
    const tacticId = tacticA.body.id as number;
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', a.cookie)
      .send({ tacticId, week: 1, weekday: 0, done: true });
    await request(app)
      .put(`/api/tactic-evidence/${tacticId}/1/0`)
      .set('Cookie', a.cookie)
      .send({ note: 'עדות לדוגמה עבור גיבוי', link: 'https://example.com/proof' });

    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    const rawEvidenceFileStoredName = (
      getDb().prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ?').get(tacticId) as
        | { file_stored_name: string | null }
        | undefined
    )?.file_stored_name;
    expect(rawEvidenceFileStoredName).toBeFalsy(); // no file uploaded in this scenario — nothing to redact-test here directly

    const snapshot = JSON.parse(row.snapshot_json) as { tables: Record<string, unknown[]> };
    const evidence = snapshot.tables.tactic_evidence as {
      tacticId: number;
      note: string;
      link: string;
      hasFile: number;
      fileOriginalName: string | null;
    }[];
    const evidenceRow = evidence.find((e) => e.tacticId === tacticId);
    expect(evidenceRow?.note).toBe('עדות לדוגמה עבור גיבוי');
    expect(evidenceRow?.link).toBe('https://example.com/proof');
    expect(evidenceRow?.hasFile).toBe(0);
    expect(Object.keys(evidenceRow ?? {})).not.toContain('fileStoredName');
    expect(Object.keys(evidenceRow ?? {})).not.toContain('file_stored_name');
  });

  it('includes actual wam_punishments row data in full (label/author/assignee/due-binding/done)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
    await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle B' });

    const wam1 = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wam1Id = wam1.body.id as number;
    await request(app)
      .post(`/api/wams/${wam1Id}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'לשטוף כלים כל השבוע', assignedUserId: b.userId });

    const wam2 = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 2 });
    const wam2Id = wam2.body.id as number;

    await request(app).post(`/api/wams/${wam1Id}/complete`).set('Cookie', a.cookie).send({});

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wam1Id) as {
      snapshot_json: string;
    };
    const snapshot = JSON.parse(row.snapshot_json) as { tables: Record<string, unknown[]> };
    const punishments = snapshot.tables.wam_punishments as {
      sourceWamId: number;
      dueWamId: number | null;
      authorUserId: number;
      assignedUserId: number;
      label: string;
      done: number;
    }[];
    const punishmentRow = punishments.find((p) => p.sourceWamId === wam1Id);
    expect(punishmentRow?.label).toBe('לשטוף כלים כל השבוע');
    expect(punishmentRow?.authorUserId).toBe(a.userId);
    expect(punishmentRow?.assignedUserId).toBe(b.userId);
    expect(punishmentRow?.dueWamId).toBe(wam2Id);
    expect(punishmentRow?.done).toBe(0);
  });

  it('never includes password hashes, avatar bytes, session tokens, reset tokens, prior backups, or raw delivery error text', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    const raw = row.snapshot_json;
    const snapshot = JSON.parse(raw) as { tables: Record<string, unknown[]> };

    // No table in the snapshot's structure is one of the explicitly-excluded ones.
    expect(Object.keys(snapshot.tables)).not.toContain('sessions');
    expect(Object.keys(snapshot.tables)).not.toContain('password_reset_tokens');
    expect(Object.keys(snapshot.tables)).not.toContain('backup');
    expect(Object.keys(snapshot.tables)).not.toContain('schema_migrations');

    const users = snapshot.tables.users as Record<string, unknown>[];
    for (const u of users) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('avatarData');
      expect(u).not.toHaveProperty('avatar_data');
    }

    // Belt-and-suspenders: none of these raw substrings appear anywhere in the serialized JSON.
    const passwordHash = (getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(a.userId) as {
      password_hash: string;
    }).password_hash;
    expect(raw).not.toContain(passwordHash);
    expect(raw).not.toMatch(/"error"\s*:/); // error/last_error columns are redacted to hasError booleans
    expect(raw).not.toMatch(/"last_error"\s*:/);
  });

  it('redacts wam_email_reminders/wam_calendar_invitations/scheduled_email_reminders error text to a boolean while keeping status', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    // First, force a per-recipient calendar-invite failure (draft stays draft, no backup yet).
    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'b@a.com') throw new Error('ACS send failed: simulated outage detail');
    });
    const failedAttempt = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });
    expect(failedAttempt.status).toBe(502);
    expect(backupCount()).toBe(0);

    // Now let both sends succeed and actually complete.
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    const completed = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });
    expect(completed.status).toBe(200);
    expect(backupCount()).toBe(1);

    const row = getDb().prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    expect(row.snapshot_json).not.toContain('simulated outage detail');
    const snapshot = JSON.parse(row.snapshot_json) as { tables: Record<string, unknown[]> };
    const invitations = snapshot.tables.wam_calendar_invitations as { wamId: number; status: string; hasError: number }[];
    const forThisWam = invitations.filter((i) => i.wamId === wamId);
    expect(forThisWam.length).toBe(2);
    expect(forThisWam.every((i) => i.status === 'sent')).toBe(true);
    expect(forThisWam.every((i) => typeof i.hasError === 'number')).toBe(true);
  });

  it('a failed calendar-invite delivery leaves the WAM in draft and creates no backup', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'b@a.com') throw new Error('simulated outage');
    });

    const attempt = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: futureIso() });
    expect(attempt.status).toBe(502);
    expect(backupCount()).toBe(0);

    const wamRow = getDb().prepare('SELECT status FROM wams WHERE id = ?').get(wamId) as { status: string };
    expect(wamRow.status).toBe('draft');
  });

  it('reopening a completed WAM does not delete its backup, and re-completing it preserves the original backup row (no duplicate)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const firstComplete = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(firstComplete.status).toBe(200);
    expect(backupCount()).toBe(1);
    const firstRow = getDb().prepare('SELECT id, created_at FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      id: number;
      created_at: string;
    };

    const reopened = await request(app).post(`/api/wams/${wamId}/reopen`).set('Cookie', a.cookie);
    expect(reopened.status).toBe(200);
    expect(backupCount()).toBe(1); // reopen never touches the backup table

    const secondComplete = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', b.cookie).send({});
    expect(secondComplete.status).toBe(200);
    expect(backupCount()).toBe(1); // still exactly one — the original is preserved, not replaced

    const secondRow = getDb().prepare('SELECT id, created_at FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      id: number;
      created_at: string;
    };
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.created_at).toBe(firstRow.created_at);
  });

  it('two racing completion attempts for the same WAM never produce more than one backup row', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    // Both requests pass the initial not-yet-complete check before either's synchronous
    // completion transaction runs, since both yield on the awaited (mocked) email send first.
    const [first, second] = await Promise.all([
      request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({ nextWamAt: when }),
      request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', b.cookie).send({ nextWamAt: when }),
    ]);

    const statuses = [first.status, second.status].sort();
    // At least one must succeed; the loser (if any) gets its own well-defined error, but
    // regardless of exactly how many "succeed" is reported, at most one backup row can exist.
    expect(statuses).toContain(200);
    expect(backupCount()).toBe(1);
  });

  it('has no API route surface at all for the backup table (no read/update/delete endpoint)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    for (const path of ['/api/backup', '/api/backups', '/api/wam-backups']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get(path).set('Cookie', a.cookie);
      expect(res.status).toBe(404);
    }
  });
});

describe('WAM completion backups: transactional atomicity', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
  });

  afterAll(() => closeDb());

  it('rolls back the entire completion (status, frozen scores, and backup) if snapshot construction throws', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    // Simulate an allowlisted table unexpectedly missing (e.g. a partial-migration scenario)
    // by dropping one out from under a live, fully-migrated DB — buildAppDataSnapshot must
    // then refuse to produce an incomplete snapshot, and that failure must roll back the
    // whole completion transaction, not just skip the backup.
    getDb().exec('DROP TABLE tactic_week_overrides');

    const attempt = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(attempt.status).toBe(500);

    const wamRow = getDb().prepare('SELECT status, completed_at FROM wams WHERE id = ?').get(wamId) as {
      status: string;
      completed_at: string | null;
    };
    expect(wamRow.status).toBe('draft');
    expect(wamRow.completed_at).toBeNull();
    expect(backupCount()).toBe(0);

    const reviews = getDb().prepare('SELECT score_snapshot FROM wam_reviews WHERE wam_id = ?').all(wamId) as {
      score_snapshot: number | null;
    }[];
    expect(reviews.every((r) => r.score_snapshot === null)).toBe(true);
  });
});

describe('WAM completion backups: buildAppDataSnapshot / insertWamCompletionBackupIfAbsent (unit-level)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('fails loudly (throws) rather than silently producing an incomplete snapshot if an allowlisted table is missing', () => {
    const db = getDb();
    db.exec('DROP TABLE weekly_planning_rituals');
    expect(() => buildAppDataSnapshot(db)).toThrow(/weekly_planning_rituals/);
  });

  it('produces byte-for-byte identical JSON across repeated calls against unchanged data (deterministic ordering)', async () => {
    await registerAndLogin(app, 'a@a.com');
    await registerAndLogin(app, 'b@a.com');
    const db = getDb();

    const first = JSON.stringify(buildAppDataSnapshot(db));
    const second = JSON.stringify(buildAppDataSnapshot(db));
    // generatedAt legitimately differs by wall-clock time between calls, so compare with it
    // stripped out; everything else (table contents, row order, key order) must be identical.
    const stripGeneratedAt = (s: string) => s.replace(/"generatedAt":"[^"]*"/, '"generatedAt":""');
    expect(stripGeneratedAt(first)).toBe(stripGeneratedAt(second));
  });

  it('insertWamCompletionBackupIfAbsent is idempotent when called twice for the same wam id directly', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const db = getDb();
    const wamMeta = { id: wamId, week: 1, completedAt: new Date().toISOString() };

    insertWamCompletionBackupIfAbsent(db, wamMeta);
    insertWamCompletionBackupIfAbsent(db, wamMeta);
    insertWamCompletionBackupIfAbsent(db, wamMeta);

    expect(backupCount()).toBe(1);
  });

  it('the UNIQUE(triggering_wam_id) index rejects a direct duplicate insert as a hard backstop', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const db = getDb();
    const nowIso = new Date().toISOString();

    db.prepare(
      'INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json) VALUES (?, ?, ?, ?, ?)'
    ).run(wamId, 1, nowIso, 1, '{}');
    expect(() =>
      db
        .prepare(
          'INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json) VALUES (?, ?, ?, ?, ?)'
        )
        .run(wamId, 1, nowIso, 1, '{}')
    ).toThrow();
  });

  it('rejects a non-JSON snapshot_json value at the schema level', () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          'INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json) VALUES (?, ?, ?, ?, ?)'
        )
        .run(999, 1, new Date().toISOString(), 1, 'not valid json')
    ).toThrow();
  });

  it('rejects a NULL triggering_wam_id (must always be a plain, non-null integer identity, never nullable)', () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          'INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json) VALUES (?, ?, ?, ?, ?)'
        )
        .run(null, 1, new Date().toISOString(), 1, '{}')
    ).toThrow();
  });
});

describe('WAM completion backups: durable identity survives cascade deletion', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
  });

  afterAll(() => closeDb());

  it('removing the partnership cascades away the WAM row itself, but the backup row (with its original id/week/completed timestamp) survives untouched', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 4 });
    const wamId = created.body.id;

    const completed = await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});
    expect(completed.status).toBe(200);

    const beforeRemoval = getDb()
      .prepare('SELECT id, triggering_wam_id, triggering_wam_week, wam_completed_at FROM backup WHERE triggering_wam_id = ?')
      .get(wamId) as { id: number; triggering_wam_id: number; triggering_wam_week: number; wam_completed_at: string };
    expect(beforeRemoval.triggering_wam_week).toBe(4);
    expect(typeof beforeRemoval.wam_completed_at).toBe('string');

    // Cascades: partnership -> wams -> wam_reviews/wam_commitments. The `backup` row has no
    // foreign key to any of this, so it must be completely unaffected.
    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', a.cookie);

    const wamRowAfter = getDb().prepare('SELECT id FROM wams WHERE id = ?').get(wamId);
    expect(wamRowAfter).toBeUndefined(); // the WAM itself really is gone

    expect(backupCount()).toBe(1);
    const afterRemoval = getDb()
      .prepare('SELECT id, triggering_wam_id, triggering_wam_week, wam_completed_at FROM backup WHERE triggering_wam_id = ?')
      .get(wamId) as { id: number; triggering_wam_id: number; triggering_wam_week: number; wam_completed_at: string };
    expect(afterRemoval.id).toBe(beforeRemoval.id);
    expect(afterRemoval.triggering_wam_id).toBe(wamId);
    expect(afterRemoval.triggering_wam_week).toBe(4);
    expect(afterRemoval.wam_completed_at).toBe(beforeRemoval.wam_completed_at);
  });
});

describe('WAM completion backups: schema-drift enforcement', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('the current, fully-migrated schema passes the audit with no changes needed', () => {
    expect(() => auditSnapshotSchema(getDb())).not.toThrow();
  });

  it('every table INTENTIONALLY_EXCLUDED_TABLES names actually exists in the current schema (keeps the exclusion list honest, not stale)', () => {
    const db = getDb();
    const existing = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name)
    );
    for (const name of INTENTIONALLY_EXCLUDED_TABLES) {
      expect(existing.has(name)).toBe(true);
    }
  });

  it('throws if an unreviewed new table is injected into the database', () => {
    const db = getDb();
    db.exec('CREATE TABLE mystery_table (id INTEGER PRIMARY KEY)');
    expect(() => auditSnapshotSchema(db)).toThrow(/mystery_table/);
    expect(() => buildAppDataSnapshot(db)).toThrow(/mystery_table/);
  });

  it('throws if an unreviewed new column (e.g. a future users.phone) is added to an already-allowlisted table', () => {
    const db = getDb();
    db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    expect(() => auditSnapshotSchema(db)).toThrow(/users/);
    expect(() => auditSnapshotSchema(db)).toThrow(/phone/);
  });

  it('does not flag sqlite-internal tables (e.g. sqlite_sequence) as unreviewed', () => {
    const db = getDb();
    // AUTOINCREMENT tables cause SQLite to maintain sqlite_sequence automatically; it must
    // never be treated as an unreviewed application table.
    const hasSqliteSequence = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`)
      .get();
    if (hasSqliteSequence) {
      expect(() => auditSnapshotSchema(db)).not.toThrow();
    }
  });
});

describe('WAM completion backups: snapshot metadata (migrations list + shape identifier)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('includes every applied migration name, sorted, as top-level metadata — never as an application-data table row', async () => {
    await registerAndLogin(app, 'a@a.com');
    const db = getDb();
    const snapshot = buildAppDataSnapshot(db);

    const expectedMigrations = (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[])
      .map((r) => r.name)
      .sort();
    expect(expectedMigrations.length).toBeGreaterThan(0);
    expect(snapshot.appliedMigrations).toEqual(expectedMigrations);
    expect([...snapshot.appliedMigrations]).toEqual([...snapshot.appliedMigrations].sort());
    expect(Object.keys(snapshot.tables)).not.toContain('schema_migrations');
  });

  it('includes a stable shapeId consistent with computeSnapshotShapeId(), unaffected by actual row data', async () => {
    await registerAndLogin(app, 'a@a.com');
    const db = getDb();
    const snapshot = buildAppDataSnapshot(db);
    expect(snapshot.shapeId).toBe(computeSnapshotShapeId());
    expect(snapshot.shapeId).toMatch(/^[0-9a-f]{64}$/);

    await registerAndLogin(app, 'b@a.com'); // adds more row data, must not affect the shape id
    const snapshotAfterMoreData = buildAppDataSnapshot(db);
    expect(snapshotAfterMoreData.shapeId).toBe(snapshot.shapeId);
  });

  it('GOLDEN: pins the exact current snapshot table/key shape and schema version — changing the allowlist must update this test deliberately', () => {
    expect(BACKUP_SNAPSHOT_SCHEMA_VERSION).toBe(11);
    expect(describeSnapshotShape()).toEqual([
      { table: 'users', columns: ['id', 'email', 'displayName', 'bio', 'hasAvatar', 'avatarMime', 'avatarVersion', 'locale', 'createdAt'] },
      { table: 'user_settings', columns: ['userId', 'theme', 'updatedAt'] },
      { table: 'partnerships', columns: ['id', 'initiatorId', 'inviteeId', 'createdAt'] },
      {
        table: 'cycles',
        columns: [
          'id', 'userId', 'name', 'currentWeek', 'isActive', 'createdAt', 'updatedAt', 'vision',
          'successDefinition', 'whyItMatters', 'blockers', 'risks', 'lagMeasures', 'leadMeasures', 'notes',
        ],
      },
      { table: 'goals', columns: ['id', 'cycleId', 'title', 'color', 'sortOrder', 'createdAt', 'updatedAt'] },
      { table: 'tactics', columns: ['id', 'goalId', 'title', 'weekdays', 'startWeek', 'endWeek', 'createdAt', 'updatedAt'] },
      { table: 'tactic_week_overrides', columns: ['id', 'tacticId', 'week', 'title', 'weekdays', 'createdAt', 'updatedAt'] },
      { table: 'completions', columns: ['id', 'tacticId', 'week', 'weekday', 'done', 'updatedAt'] },
      {
        table: 'wams',
        columns: [
          'id', 'partnershipId', 'week', 'status', 'wins', 'misses', 'blockers', 'lessonsLearned', 'notes',
          'adjustmentNotes', 'createdAt', 'updatedAt', 'completedAt', 'initiatorCycleId', 'inviteeCycleId',
          'nextWamAt', 'nextWamDurationMinutes', 'calendarEventUid', 'calendarEventSequence',
        ],
      },
      { table: 'wam_reviews', columns: ['wamId', 'userId', 'rating', 'scoreSnapshot', 'scoreFinalizedAt', 'updatedAt'] },
      { table: 'wam_commitments', columns: ['id', 'wamId', 'scope', 'label', 'done', 'sortOrder', 'createdAt', 'updatedAt'] },
      {
        table: 'wam_email_reminders',
        columns: ['id', 'isoWeek', 'partnershipId', 'recipientUserId', 'status', 'hasError', 'createdAt', 'updatedAt'],
      },
      {
        table: 'wam_calendar_invitations',
        columns: ['wamId', 'recipientUserId', 'eventSequence', 'status', 'hasError', 'sentAt', 'updatedAt'],
      },
      {
        table: 'weekly_planning_rituals',
        columns: [
          'id', 'cycleId', 'targetWeek', 'workedWell', 'improveNext', 'tacticsReviewed', 'weeklyFocus',
          'commitment', 'status', 'completedAt', 'createdAt', 'updatedAt',
        ],
      },
      {
        table: 'scheduled_email_reminders',
        columns: [
          'id', 'creatorUserId', 'recipientUserId', 'title', 'body', 'scheduledFor', 'status', 'attemptCount',
          'hasError', 'nextAttemptAt', 'claimedAt', 'sentAt', 'createdAt', 'updatedAt',
        ],
      },
      {
        table: 'execution_recovery_plans',
        columns: ['id', 'cycleId', 'week', 'strategy', 'note', 'status', 'adjustmentJson', 'createdAt', 'updatedAt', 'resolvedAt'],
      },
      {
        table: 'partner_broosts',
        columns: [
          'id', 'senderId', 'recipientId', 'partnershipId', 'presetKey', 'message', 'createdAt', 'readAt',
          'emailStatus', 'emailAttemptCount', 'hasEmailError', 'emailNextAttemptAt', 'emailClaimedAt', 'emailSentAt',
        ],
      },
      {
        table: 'week_milestone_emails',
        columns: [
          'id', 'partnershipId', 'achieverId', 'recipientId', 'weekKey', 'cycleWeek', 'score', 'phraseVariant',
          'createdAt', 'emailStatus', 'emailAttemptCount', 'hasEmailError', 'emailNextAttemptAt', 'emailClaimedAt',
          'emailSentAt',
        ],
      },
      {
        table: 'week_recap_emails',
        columns: [
          'id', 'userId', 'weekKey', 'cycleId', 'scoresJson', 'averageScore', 'latestWeek', 'phraseVariant',
          'createdAt', 'emailStatus', 'emailAttemptCount', 'hasEmailError', 'emailNextAttemptAt', 'emailClaimedAt',
          'emailSentAt',
        ],
      },
      {
        table: 'tactic_evidence',
        columns: [
          'id', 'tacticId', 'cycleId', 'week', 'weekday', 'note', 'link', 'fileOriginalName', 'fileMime', 'fileSize',
          'hasFile', 'createdAt', 'updatedAt',
        ],
      },
      {
        table: 'wam_punishments',
        columns: [
          'id', 'sourceWamId', 'dueWamId', 'authorUserId', 'assignedUserId', 'label', 'done', 'completedAt',
          'createdAt', 'updatedAt',
        ],
      },
      { table: 'gym_state', columns: ['userId', 'data', 'updatedAt'] },
      {
        table: 'body_weights',
        columns: ['id', 'userId', 'measuredOn', 'kg', 'condition', 'recordedAt'],
      },
    ]);
  });
});

describe('WAM completion backups: secrets never appear (reset tokens + session tokens)', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
  });

  afterAll(() => closeDb());

  it('a password-reset token hash and a live session token never appear anywhere in the snapshot JSON', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;

    const db = getDb();
    const { token: resetToken } = createResetToken(db, a.userId);
    const resetTokenHashRow = db.prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?').get(a.userId) as {
      token_hash: string;
    };
    const sessionRow = db.prepare('SELECT token FROM sessions WHERE user_id = ?').get(a.userId) as { token: string };

    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const backupRow = db.prepare('SELECT snapshot_json FROM backup WHERE triggering_wam_id = ?').get(wamId) as {
      snapshot_json: string;
    };
    expect(backupRow.snapshot_json).not.toContain(resetToken);
    expect(backupRow.snapshot_json).not.toContain(resetTokenHashRow.token_hash);
    expect(backupRow.snapshot_json).not.toContain(sessionRow.token);

    const snapshot = JSON.parse(backupRow.snapshot_json) as { tables: Record<string, unknown[]> };
    expect(Object.keys(snapshot.tables)).not.toContain('sessions');
    expect(Object.keys(snapshot.tables)).not.toContain('password_reset_tokens');
  });
});

describe('WAM completion backups: calendar-invite success + backup transaction failure edge case', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    process.env.ACS_EMAIL_CONNECTION_STRING = 'endpoint=https://example.communication.azure.com/;accesskey=fake';
    process.env.EMAIL_SENDER_ADDRESS = 'DoNotReply@example.azurecomm.net';
    process.env.APP_PUBLIC_URL = 'https://dashboard.example.com';
  });

  afterEach(() => {
    delete process.env.ACS_EMAIL_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;
    delete process.env.APP_PUBLIC_URL;
  });

  afterAll(() => closeDb());

  const RESTORE_TACTIC_WEEK_OVERRIDES_SQL = `
    CREATE TABLE IF NOT EXISTS tactic_week_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tactic_id INTEGER NOT NULL REFERENCES tactics(id) ON DELETE CASCADE,
      week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 12),
      title TEXT NOT NULL,
      weekdays TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (tactic_id, week)
    );
    CREATE INDEX IF NOT EXISTS idx_tactic_week_overrides_tactic ON tactic_week_overrides(tactic_id);
  `;

  it('when invites succeed but the backup transaction then fails, the WAM stays draft; after restoring the schema, retrying with the same persisted schedule completes with no duplicate invitation sends', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const created = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 1 });
    const wamId = created.body.id;
    const when = futureIso();

    // Force the backup transaction to fail (simulating e.g. an unexpected schema-drift
    // detection) *after* both calendar invites have already been sent and durably recorded —
    // this is the scenario where a sent invite genuinely cannot be "un-sent"/rolled back.
    getDb().exec('DROP TABLE tactic_week_overrides');

    const firstAttempt = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });
    expect(firstAttempt.status).toBe(500);
    expect(sendEmailMock).toHaveBeenCalledTimes(2); // both recipients' invites were sent

    const draftWam = getDb().prepare('SELECT status FROM wams WHERE id = ?').get(wamId) as { status: string };
    expect(draftWam.status).toBe('draft');
    expect(backupCount()).toBe(0);

    const invitationsAfterFailure = getDb()
      .prepare('SELECT recipient_user_id, status, event_sequence FROM wam_calendar_invitations WHERE wam_id = ?')
      .all(wamId) as { recipient_user_id: number; status: string; event_sequence: number }[];
    expect(invitationsAfterFailure.length).toBe(2);
    expect(invitationsAfterFailure.every((i) => i.status === 'sent')).toBe(true);

    // Restore the schema (the actual underlying cause of the failure is fixed) and retry with
    // the identical schedule already persisted on the WAM.
    getDb().exec(RESTORE_TACTIC_WEEK_OVERRIDES_SQL);

    const retry = await request(app)
      .post(`/api/wams/${wamId}/complete`)
      .set('Cookie', a.cookie)
      .send({ nextWamAt: when });
    expect(retry.status).toBe(200);
    expect(retry.body.wam.status).toBe('complete');

    // No additional sends happened on retry — the per-recipient (wam, recipient, sequence)
    // idempotency in sendWamCalendarInvitations correctly skipped both already-'sent'
    // recipients for the unchanged event sequence.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(backupCount()).toBe(1);

    const invitationsAfterRetry = getDb()
      .prepare('SELECT recipient_user_id, status, event_sequence FROM wam_calendar_invitations WHERE wam_id = ?')
      .all(wamId) as { recipient_user_id: number; status: string; event_sequence: number }[];
    expect(invitationsAfterRetry.length).toBe(2);
    expect(invitationsAfterRetry.every((i) => i.status === 'sent' && i.event_sequence === 0)).toBe(true);
  });
});
