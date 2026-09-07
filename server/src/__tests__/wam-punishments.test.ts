import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, userId: me.body.id as number, email };
}

async function pairUsers(
  app: ReturnType<typeof freshApp>,
  a: { cookie: string; userId: number },
  b: { cookie: string; userId: number }
) {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

async function createWam(app: ReturnType<typeof freshApp>, cookie: string, week: number) {
  const res = await request(app).post('/api/wams').set('Cookie', cookie).send({ week });
  return res.body.id as number;
}

describe('WAM Punishments', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('lets either partner add a punishment assigned to self or to the other member, with the author always server-derived', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wamId = await createWam(app, a.cookie, 1);

    const selfAssigned = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'לנקות את המטבח', assignedUserId: a.userId });
    expect(selfAssigned.status).toBe(201);
    expect(selfAssigned.body.wam.punishments).toHaveLength(1);
    expect(selfAssigned.body.wam.punishments[0].authorUserId).toBe(a.userId);
    expect(selfAssigned.body.wam.punishments[0].assignedUserId).toBe(a.userId);

    const partnerAssignedByB = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', b.cookie)
      .send({ label: 'לקפל כביסה', assignedUserId: a.userId });
    expect(partnerAssignedByB.status).toBe(201);
    const authored = partnerAssignedByB.body.wam.punishments.find((p: { label: string }) => p.label === 'לקפל כביסה');
    expect(authored.authorUserId).toBe(b.userId);
    expect(authored.assignedUserId).toBe(a.userId);

    // Author is always derived from the session (a.userId/b.userId above, via each cookie),
    // never from the request body — the strict schema outright rejects any attempt to send
    // an extra `authorUserId` field at all (see "strict schema validation" below), which is a
    // stronger guarantee than silently ignoring a spoofed value would be.
  });

  it('rejects an assignee who is not one of the two WAM participants', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await pairUsers(app, a, b);
    const wamId = await createWam(app, a.cookie, 1);

    const res = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש לא חוקי', assignedUserId: stranger.userId });
    expect(res.status).toBe(400);
  });

  it('rejects empty/too-long labels and requires membership/existence for the source WAM', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await pairUsers(app, a, b);
    const wamId = await createWam(app, a.cookie, 1);

    const empty = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: '   ', assignedUserId: a.userId });
    expect(empty.status).toBe(400);

    const tooLong = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'א'.repeat(301), assignedUserId: a.userId });
    expect(tooLong.status).toBe(400);

    const notFound = await request(app)
      .post(`/api/wams/999999/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש', assignedUserId: a.userId });
    expect(notFound.status).toBe(404);

    const strangerAdd = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', stranger.cookie)
      .send({ label: 'עונש', assignedUserId: a.userId });
    expect(strangerAdd.status).toBe(404);
  });

  it('only the author may edit or delete their own punishment', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wamId = await createWam(app, a.cookie, 1);

    const created = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש של א', assignedUserId: b.userId });
    const punishmentId = created.body.punishmentId as number;

    const bEditAttempt = await request(app)
      .patch(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', b.cookie)
      .send({ label: 'שינוי לא מורשה' });
    expect(bEditAttempt.status).toBe(403);

    const bDeleteAttempt = await request(app)
      .delete(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', b.cookie);
    expect(bDeleteAttempt.status).toBe(403);

    const aEdit = await request(app)
      .patch(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש מעודכן', assignedUserId: a.userId });
    expect(aEdit.status).toBe(200);
    const updatedPunishment = aEdit.body.punishments.find((p: { id: number }) => p.id === punishmentId);
    expect(updatedPunishment.label).toBe('עונש מעודכן');
    expect(updatedPunishment.assignedUserId).toBe(a.userId);

    const aDelete = await request(app)
      .delete(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', a.cookie);
    expect(aDelete.status).toBe(200);
    expect(aDelete.body.punishments).toHaveLength(0);
  });

  it('locks source-side CRUD once the source WAM is complete or historical', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wamId = await createWam(app, a.cookie, 1);

    const created = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש', assignedUserId: a.userId });
    const punishmentId = created.body.punishmentId as number;

    await request(app).post(`/api/wams/${wamId}/complete`).set('Cookie', a.cookie).send({});

    const addAfterComplete = await request(app)
      .post(`/api/wams/${wamId}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש נוסף', assignedUserId: a.userId });
    expect(addAfterComplete.status).toBe(400);

    const editAfterComplete = await request(app)
      .patch(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', a.cookie)
      .send({ label: 'לא אמור לעבוד' });
    expect(editAfterComplete.status).toBe(400);

    const deleteAfterComplete = await request(app)
      .delete(`/api/wams/${wamId}/punishments/${punishmentId}`)
      .set('Cookie', a.cookie);
    expect(deleteAfterComplete.status).toBe(400);
  });

  it('rejects adding a punishment when the already-existing next WAM is complete/historical (would create a dead item)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    const wam2 = await createWam(app, a.cookie, 2);
    await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});

    const res = await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש חסר תוחלת', assignedUserId: a.userId });
    expect(res.status).toBe(400);
  });

  describe('serialized canAddPunishment', () => {
    it('is true for a fresh draft WAM with no next WAM yet', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const detail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(detail.body.canAddPunishment).toBe(true);
    });

    it('is false once the source WAM itself is complete, and true again after reopening', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await request(app).post(`/api/wams/${wam1}/complete`).set('Cookie', a.cookie).send({});
      const completeDetail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(completeDetail.body.canAddPunishment).toBe(false);

      await request(app).post(`/api/wams/${wam1}/reopen`).set('Cookie', a.cookie);
      const reopenedDetail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(reopenedDetail.body.canAddPunishment).toBe(true);
    });

    it('is false when a next WAM already exists and is complete/historical, even though the source itself is still an editable draft', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const wam2 = await createWam(app, a.cookie, 2);
      await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});

      const detail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(detail.body.status).toBe('draft');
      expect(detail.body.isHistorical).toBe(false);
      expect(detail.body.canAddPunishment).toBe(false);

      // Reopening the blocking next WAM restores it.
      await request(app).post(`/api/wams/${wam2}/reopen`).set('Cookie', a.cookie);
      const detailAfterReopen = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(detailAfterReopen.body.canAddPunishment).toBe(true);
    });

    it('is true when a next WAM exists but is still a non-historical draft', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await createWam(app, a.cookie, 2);

      const detail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(detail.body.canAddPunishment).toBe(true);
    });
  });

  describe('deterministic next-WAM binding (by WAM id, never by week number)', () => {
    it('binds an unassigned punishment to the next WAM created afterwards', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);

      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש ממתין', assignedUserId: b.userId });
      expect(created.body.wam.punishments[0].dueWamId).toBeNull();

      const wam2 = await createWam(app, a.cookie, 2);

      const wam2Detail = await request(app).get(`/api/wams/${wam2}`).set('Cookie', a.cookie);
      expect(wam2Detail.body.duePunishments).toHaveLength(1);
      expect(wam2Detail.body.duePunishments[0].label).toBe('עונש ממתין');
      expect(wam2Detail.body.duePunishments[0].sourceWamId).toBe(wam1);

      const wam1Detail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      expect(wam1Detail.body.punishments[0].dueWamId).toBe(wam2);
    });

    it('binds immediately at creation time when a later WAM already exists', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const wam2 = await createWam(app, a.cookie, 2);

      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש עם יעד קיים', assignedUserId: b.userId });
      expect(created.body.wam.punishments[0].dueWamId).toBe(wam2);

      const wam2Detail = await request(app).get(`/api/wams/${wam2}`).set('Cookie', a.cookie);
      expect(wam2Detail.body.duePunishments).toHaveLength(1);
    });

    it('correctly binds across skipped weeks (multiple earlier unbound punishments all bind to the same later WAM)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      // Both punishments are added while wam1 is still the latest WAM in the partnership (no
      // later WAM exists yet), so both stay unbound simultaneously.
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש ראשון ממתין', assignedUserId: b.userId });
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש שני ממתין', assignedUserId: b.userId });

      // Week 2 is skipped entirely — wam3's own creation-time sweep must bind BOTH
      // still-unbound punishments from wam1 at once, in a single UPDATE.
      const wam3 = await createWam(app, a.cookie, 3);
      const wam3Detail = await request(app).get(`/api/wams/${wam3}`).set('Cookie', a.cookie);
      expect(wam3Detail.body.duePunishments).toHaveLength(2);
      const labels = wam3Detail.body.duePunishments.map((p: { label: string }) => p.label).sort();
      expect(labels).toEqual(['עונש ראשון ממתין', 'עונש שני ממתין']);
    });

    it('never rebinds an already-bound punishment when yet another later WAM is created', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const wam2 = await createWam(app, a.cookie, 2);
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש קבוע', assignedUserId: b.userId });

      const wam3 = await createWam(app, a.cookie, 3);

      const wam2Detail = await request(app).get(`/api/wams/${wam2}`).set('Cookie', a.cookie);
      expect(wam2Detail.body.duePunishments).toHaveLength(1);
      const wam3Detail = await request(app).get(`/api/wams/${wam3}`).set('Cookie', a.cookie);
      expect(wam3Detail.body.duePunishments).toHaveLength(0);
    });

    it('binds correctly across a week-12-to-new-cycle transition (same week numbers reused across cycle generations)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam12 = await createWam(app, a.cookie, 12);
      await request(app)
        .post(`/api/wams/${wam12}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש סוף מחזור', assignedUserId: b.userId });

      // Start a brand new cycle for both — a fresh week 1 WAM is a *different* wam id, created
      // strictly after wam12, and must still receive the binding correctly.
      await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle 2' });
      await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle 2 (B)' });
      const newWam1 = await createWam(app, a.cookie, 1);

      const detail = await request(app).get(`/api/wams/${newWam1}`).set('Cookie', a.cookie);
      expect(detail.body.duePunishments).toHaveLength(1);
      expect(detail.body.duePunishments[0].label).toBe('עונש סוף מחזור');
    });

    it('idempotent WAM creation does not double-bind or duplicate', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });

      const wam2First = await request(app).post('/api/wams').set('Cookie', a.cookie).send({ week: 2 });
      expect(wam2First.status).toBe(201);
      const wam2Id = wam2First.body.id;

      // Re-requesting the same week returns the existing meeting (200, not 201) and must not
      // re-run the binding update a second time (harmless either way since due_wam_id IS NULL
      // guards it, but the count must stay exactly 1).
      const wam2Second = await request(app).post('/api/wams').set('Cookie', b.cookie).send({ week: 2 });
      expect(wam2Second.status).toBe(200);
      expect(wam2Second.body.id).toBe(wam2Id);

      const rows = getDb().prepare('SELECT COUNT(*) as c FROM wam_punishments WHERE due_wam_id = ?').get(wam2Id) as {
        c: number;
      };
      expect(rows.c).toBe(1);
    });
  });

  describe('Due Punishments checklist', () => {
    it('only the assigned user may toggle their own due item; the source author cannot toggle merely by authorship', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie) // a is the author
        .send({ label: 'עונש על ב', assignedUserId: b.userId }); // b is assigned
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);

      // Author (a) attempts to toggle — must be rejected even though they wrote it.
      const authorToggle = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ done: true });
      expect(authorToggle.status).toBe(403);

      // Assignee (b) toggles successfully.
      const assigneeToggle = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      expect(assigneeToggle.status).toBe(200);
      const toggled = assigneeToggle.body.duePunishments.find((p: { id: number }) => p.id === punishmentId);
      expect(toggled.done).toBe(true);
      expect(toggled.completedAt).toBeTruthy();

      // Toggling back off clears completedAt.
      const untoggle = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: false });
      expect(untoggle.status).toBe(200);
      const untoggled = untoggle.body.duePunishments.find((p: { id: number }) => p.id === punishmentId);
      expect(untoggled.done).toBe(false);
      expect(untoggled.completedAt).toBeNull();
    });

    it('rejects toggling using a mismatched/stale due WAM id (route validates due_wam_id equals the URL id)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2); // binds the punishment to wam2

      // Attempting to toggle it via the SOURCE wam id (wam1) — not its actual due_wam_id — must 404.
      const wrongWam = await request(app)
        .patch(`/api/wams/${wam1}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      expect(wrongWam.status).toBe(404);

      // A nonexistent WAM id entirely.
      const nonexistentWam = await request(app)
        .patch(`/api/wams/999999/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      expect(nonexistentWam.status).toBe(404);
    });

    it('only allows toggling while the due WAM is draft and non-historical', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);
      await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});

      const res = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      expect(res.status).toBe(400);
    });

    it('does not require every due punishment to be complete before the due WAM itself can be completed', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש שלא הושלם', assignedUserId: b.userId });
      const wam2 = await createWam(app, a.cookie, 2);

      const completeRes = await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.wam.duePunishments[0].done).toBe(false);
    });
  });

  it('completing the source WAM preserves all outgoing punishments and their due binding/null state', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש שנשאר ללא יעד', assignedUserId: b.userId });

    const completeRes = await request(app).post(`/api/wams/${wam1}/complete`).set('Cookie', a.cookie).send({});
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.wam.punishments).toHaveLength(1);
    expect(completeRes.body.wam.punishments[0].dueWamId).toBeNull();
  });

  it('search finds a WAM by its punishment label', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'מילת_מפתח_ייחודית_לחיפוש', assignedUserId: b.userId });

    const res = await request(app).get('/api/wams/search?q=מילת_מפתח_ייחודית_לחיפוש').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { id: number }) => r.id)).toContain(wam1);
  });

  it('WAM summaries expose punishmentsDueTotal/punishmentsDueDone counts', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    const created = await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש', assignedUserId: b.userId });
    const punishmentId = created.body.punishmentId as number;
    const wam2 = await createWam(app, a.cookie, 2);
    await request(app)
      .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
      .set('Cookie', b.cookie)
      .send({ done: true });

    const list = await request(app).get('/api/wams').set('Cookie', a.cookie);
    const wam2Summary = list.body.wams.find((w: { id: number }) => w.id === wam2);
    expect(wam2Summary.punishmentsDueTotal).toBe(1);
    expect(wam2Summary.punishmentsDueDone).toBe(1);
    const wam1Summary = list.body.wams.find((w: { id: number }) => w.id === wam1);
    expect(wam1Summary.punishmentsDueTotal).toBe(0);
  });

  it('strangers cannot view, add, edit, delete, or toggle punishments on a WAM they are not a member of', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    const created = await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש', assignedUserId: b.userId });
    const punishmentId = created.body.punishmentId as number;
    const wam2 = await createWam(app, a.cookie, 2);

    expect((await request(app).get(`/api/wams/${wam1}`).set('Cookie', stranger.cookie)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/wams/${wam1}/punishments`)
          .set('Cookie', stranger.cookie)
          .send({ label: 'x', assignedUserId: a.userId })
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
          .set('Cookie', stranger.cookie)
          .send({ label: 'x' })
      ).status
    ).toBe(404);
    expect((await request(app).delete(`/api/wams/${wam1}/punishments/${punishmentId}`).set('Cookie', stranger.cookie)).status).toBe(
      404
    );
    expect(
      (
        await request(app)
          .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
          .set('Cookie', stranger.cookie)
          .send({ done: true })
      ).status
    ).toBe(404);
  });

  it('deleting the source WAM cascades and removes its punishments (via partnership removal, which cascades all its WAMs)', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    const partnershipId = await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש', assignedUserId: b.userId });

    const beforeCount = (getDb().prepare('SELECT COUNT(*) as c FROM wam_punishments').get() as { c: number }).c;
    expect(beforeCount).toBe(1);

    await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', a.cookie);

    const afterCount = (getDb().prepare('SELECT COUNT(*) as c FROM wam_punishments').get() as { c: number }).c;
    expect(afterCount).toBe(0);
  });

  it('uncompleted due items remain bound to only their due WAM and never migrate to a later WAM', async () => {
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await pairUsers(app, a, b);
    const wam1 = await createWam(app, a.cookie, 1);
    await request(app)
      .post(`/api/wams/${wam1}/punishments`)
      .set('Cookie', a.cookie)
      .send({ label: 'עונש שלא בוצע', assignedUserId: b.userId });
    const wam2 = await createWam(app, a.cookie, 2);
    // wam2's due punishment is left unchecked, then wam3 is created — the unbound-punishment
    // sweep must not touch an *already-bound* item, so it must stay on wam2 only.
    const wam3 = await createWam(app, a.cookie, 3);

    const wam2Detail = await request(app).get(`/api/wams/${wam2}`).set('Cookie', a.cookie);
    expect(wam2Detail.body.duePunishments).toHaveLength(1);
    expect(wam2Detail.body.duePunishments[0].done).toBe(false);

    const wam3Detail = await request(app).get(`/api/wams/${wam3}`).set('Cookie', a.cookie);
    expect(wam3Detail.body.duePunishments).toHaveLength(0);
  });

  describe('frozen due history (source-side mutation locked once the due WAM itself is frozen)', () => {
    it('rejects label edit, reassignment, and deletion once the due WAM completes, even though the source WAM is still (or again) a draft', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש קפוא בעתיד', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);

      // Complete and reopen the SOURCE WAM (wam1) to prove the source's own draft/historical
      // state alone is not what blocks the mutation — only the due WAM's frozen state is.
      await request(app).post(`/api/wams/${wam1}/complete`).set('Cookie', a.cookie).send({});
      await request(app).post(`/api/wams/${wam1}/reopen`).set('Cookie', a.cookie).send({});

      // Toggle the due item, then complete the DUE WAM (wam2) — this is what must freeze it.
      await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});

      const editAttempt = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'ניסיון עריכה אחרי הקפאה' });
      expect(editAttempt.status).toBe(400);

      const reassignAttempt = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ assignedUserId: a.userId });
      expect(reassignAttempt.status).toBe(400);

      const deleteAttempt = await request(app)
        .delete(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie);
      expect(deleteAttempt.status).toBe(400);

      // The serialized canEdit must reflect the same frozen state so the UI hides controls.
      const wam1Detail = await request(app).get(`/api/wams/${wam1}`).set('Cookie', a.cookie);
      const serializedPunishment = wam1Detail.body.punishments.find((p: { id: number }) => p.id === punishmentId);
      expect(serializedPunishment.canEdit).toBe(false);
    });

    it('also freezes source-side mutation once the due WAM becomes historical (archived cycle), not just complete', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      await request(app).post('/api/cycle').set('Cookie', a.cookie).send({ name: 'Cycle A' });
      await request(app).post('/api/cycle').set('Cookie', b.cookie).send({ name: 'Cycle B' });
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);

      // Archive A's cycle by resetting it — wam2 (referencing the now-archived cycle)
      // becomes permanently historical without ever being "completed".
      await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle A2', confirm: true });

      const editAttempt = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'ניסיון עריכה' });
      expect(editAttempt.status).toBe(400);
    });

    it('still allows source-side mutation while the due WAM exists but is not yet frozen', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      await createWam(app, a.cookie, 2); // due WAM exists but stays a draft

      const editAttempt = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'עריכה תקינה' });
      expect(editAttempt.status).toBe(200);
      expect(editAttempt.body.punishments[0].label).toBe('עריכה תקינה');
    });

    it('explicitly reopening the due WAM re-allows source edit/reassign/delete while it stays non-historical, but an archived due WAM remains permanently locked even after an attempted reopen', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש לפני הקפאה', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);

      // Complete the due WAM — source edit must now be blocked.
      await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});
      const blockedWhileComplete = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'נחסם' });
      expect(blockedWhileComplete.status).toBe(400);

      // Explicitly reopen the due WAM — this is the same product-consistent unfreeze already
      // used for the due WAM's own shared content/commitments — and source mutation must work
      // again: edit, reassign, and (on a fresh item) delete all succeed while it's reopened.
      const reopened = await request(app).post(`/api/wams/${wam2}/reopen`).set('Cookie', a.cookie);
      expect(reopened.status).toBe(200);

      const editAfterReopen = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'עריכה אחרי פתיחה מחדש' });
      expect(editAfterReopen.status).toBe(200);
      expect(editAfterReopen.body.punishments[0].label).toBe('עריכה אחרי פתיחה מחדש');

      const reassignAfterReopen = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ assignedUserId: a.userId });
      expect(reassignAfterReopen.status).toBe(200);
      expect(reassignAfterReopen.body.punishments[0].assignedUserId).toBe(a.userId);

      const deleteAfterReopen = await request(app)
        .delete(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie);
      expect(deleteAfterReopen.status).toBe(200);
      expect(deleteAfterReopen.body.punishments).toHaveLength(0);

      // Now archive A's cycle so the due WAM becomes permanently historical, and prove a
      // NEW punishment on the same source stays locked no matter what (there is no reopen
      // path for historical WAMs at all).
      const created2 = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש לפני ארכוב', assignedUserId: b.userId });
      const punishmentId2 = created2.body.punishmentId as number;
      await request(app).post(`/api/wams/${wam2}/complete`).set('Cookie', a.cookie).send({});
      await request(app).post('/api/cycle/reset').set('Cookie', a.cookie).send({ name: 'Cycle A2', confirm: true });

      const blockedAfterArchive = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId2}`)
        .set('Cookie', a.cookie)
        .send({ label: 'לא אמור לעבוד' });
      expect(blockedAfterArchive.status).toBe(400);
    });
  });

  describe('reassignment resets completion attribution atomically', () => {
    it('reassigning to a different user clears done/completedAt', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);
      await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });

      const reassign = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ assignedUserId: a.userId });
      expect(reassign.status).toBe(200);
      const reassigned = reassign.body.punishments.find((p: { id: number }) => p.id === punishmentId);
      expect(reassigned.assignedUserId).toBe(a.userId);
      expect(reassigned.done).toBe(false);
      expect(reassigned.completedAt).toBeNull();
    });

    it('a same-assignee update (or a label-only update) preserves done/completedAt', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);
      await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      const beforeCompletedAt = (
        getDb().prepare('SELECT completed_at FROM wam_punishments WHERE id = ?').get(punishmentId) as {
          completed_at: string;
        }
      ).completed_at;

      // Same-assignee "reassignment" — must not reset completion.
      const sameAssignee = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ assignedUserId: b.userId });
      expect(sameAssignee.status).toBe(200);
      let row = sameAssignee.body.punishments.find((p: { id: number }) => p.id === punishmentId);
      expect(row.done).toBe(true);
      expect(row.completedAt).toBe(beforeCompletedAt);

      // Label-only update — must not touch assignee or completion.
      const labelOnly = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש מחודש' });
      expect(labelOnly.status).toBe(200);
      row = labelOnly.body.punishments.find((p: { id: number }) => p.id === punishmentId);
      expect(row.assignedUserId).toBe(b.userId);
      expect(row.done).toBe(true);
      expect(row.completedAt).toBe(beforeCompletedAt);
    });
  });

  describe('toggle idempotency', () => {
    it('repeated {done:true} preserves the original completed_at; false clears it, and a later true records a genuinely new timestamp', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);

      const first = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      const firstCompletedAt = first.body.duePunishments[0].completedAt as string;
      expect(firstCompletedAt).toBeTruthy();

      // Small delay so a bug that stamps a fresh timestamp would be detectable.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const repeated = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      expect(repeated.body.duePunishments[0].completedAt).toBe(firstCompletedAt);

      const cleared = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: false });
      expect(cleared.body.duePunishments[0].completedAt).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 20));

      const again = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true });
      const newCompletedAt = again.body.duePunishments[0].completedAt as string;
      expect(newCompletedAt).toBeTruthy();
      expect(newCompletedAt).not.toBe(firstCompletedAt);
    });
  });

  describe('strict schema validation', () => {
    it('rejects an empty {} update body (must provide at least one of label/assignedUserId)', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;

      const res = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects unknown/spoofed fields on create, update, and toggle bodies', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);

      const createWithSpoof = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId, authorUserId: b.userId, done: true });
      expect(createWithSpoof.status).toBe(400);

      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש תקין', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;

      const updateWithSpoof = await request(app)
        .patch(`/api/wams/${wam1}/punishments/${punishmentId}`)
        .set('Cookie', a.cookie)
        .send({ label: 'עדכון', done: true });
      expect(updateWithSpoof.status).toBe(400);

      const wam2 = await createWam(app, a.cookie, 2);
      const toggleWithSpoof = await request(app)
        .patch(`/api/wams/${wam2}/due-punishments/${punishmentId}`)
        .set('Cookie', b.cookie)
        .send({ done: true, completedAt: '2020-01-01T00:00:00.000Z' });
      expect(toggleWithSpoof.status).toBe(400);
    });
  });

  describe('search finds punishments in both source and due WAM contexts (deduped)', () => {
    it('finds the source WAM by punishment label', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'מילת_חיפוש_מקור', assignedUserId: b.userId });

      const res = await request(app).get('/api/wams/search?q=מילת_חיפוש_מקור').set('Cookie', a.cookie);
      expect(res.body.results.map((r: { id: number }) => r.id)).toEqual([wam1]);
    });

    it('also finds the due WAM by the same punishment label, without duplicating the source WAM result', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'מילת_חיפוש_יעד', assignedUserId: b.userId });
      const wam2 = await createWam(app, a.cookie, 2);

      const res = await request(app).get('/api/wams/search?q=מילת_חיפוש_יעד').set('Cookie', a.cookie);
      const ids = res.body.results.map((r: { id: number }) => r.id).sort((x: number, y: number) => x - y);
      expect(ids).toEqual([wam1, wam2].sort((x, y) => x - y));
      // No duplicate entries for the same WAM id.
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('schema-level DB integrity (direct DB tests)', () => {
    it('CHECK constraint rejects due_wam_id <= source_wam_id', () => {
      const db = getDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO wam_punishments (source_wam_id, due_wam_id, author_user_id, assigned_user_id, label)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(5, 5, 1, 1, 'לא חוקי')
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO wam_punishments (source_wam_id, due_wam_id, author_user_id, assigned_user_id, label)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(5, 3, 1, 1, 'לא חוקי')
      ).toThrow();
    });

    it('trigger rejects a direct UPDATE that changes source_wam_id', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      // A separate, unrelated WAM (different partnership) so this punishment's own
      // due_wam_id stays NULL — isolating the assertion to the immutable-source trigger
      // alone, rather than incidentally also tripping the due_wam_id > source_wam_id CHECK.
      const stranger1 = await registerAndLogin(app, 'stranger1@a.com');
      const stranger2 = await registerAndLogin(app, 'stranger2@a.com');
      await pairUsers(app, stranger1, stranger2);
      const unrelatedWam = await createWam(app, stranger1.cookie, 1);

      const db = getDb();
      expect(
        db.prepare('SELECT due_wam_id FROM wam_punishments WHERE id = ?').get(punishmentId)
      ).toEqual({ due_wam_id: null });
      expect(() =>
        db.prepare('UPDATE wam_punishments SET source_wam_id = ? WHERE id = ?').run(unrelatedWam, punishmentId)
      ).toThrow();
    });

    it('trigger rejects a direct UPDATE that re-points an already-bound due_wam_id to a different non-null WAM', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      const wam2 = await createWam(app, a.cookie, 2);
      const wam3 = await createWam(app, a.cookie, 3);

      const db = getDb();
      const bound = db.prepare('SELECT due_wam_id FROM wam_punishments WHERE id = ?').get(punishmentId) as {
        due_wam_id: number;
      };
      expect(bound.due_wam_id).toBe(wam2);

      expect(() =>
        db.prepare('UPDATE wam_punishments SET due_wam_id = ? WHERE id = ?').run(wam3, punishmentId)
      ).toThrow();
    });

    it('the ON DELETE SET NULL foreign key action (non-null -> NULL) is preserved and not blocked by the trigger', async () => {
      const a = await registerAndLogin(app, 'a@a.com');
      const b = await registerAndLogin(app, 'b@a.com');
      const partnershipId = await pairUsers(app, a, b);
      const wam1 = await createWam(app, a.cookie, 1);
      const created = await request(app)
        .post(`/api/wams/${wam1}/punishments`)
        .set('Cookie', a.cookie)
        .send({ label: 'עונש', assignedUserId: b.userId });
      const punishmentId = created.body.punishmentId as number;
      await createWam(app, a.cookie, 2);

      const db = getDb();
      const before = db.prepare('SELECT due_wam_id FROM wam_punishments WHERE id = ?').get(punishmentId) as {
        due_wam_id: number | null;
      };
      expect(before.due_wam_id).not.toBeNull();

      // Removing only the due WAM directly (not the whole partnership) exercises the FK
      // ON DELETE SET NULL action specifically.
      const dueWamId = before.due_wam_id;
      db.prepare('DELETE FROM wams WHERE id = ?').run(dueWamId);

      const after = db.prepare('SELECT due_wam_id FROM wam_punishments WHERE id = ?').get(punishmentId) as {
        due_wam_id: number | null;
      };
      expect(after.due_wam_id).toBeNull();
      void partnershipId;
    });
  });
});

