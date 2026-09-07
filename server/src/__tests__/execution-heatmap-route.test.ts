import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, setDb } from '../db.js';
import { runMigrations } from '../migrate.js';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { createSession } from '../lib/sessions.js';

let db: Database.Database;
let app: ReturnType<typeof createApp>;
let cookie: string;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  runMigrations(db);
  log.mockRestore();
  setDb(db);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(1, 'owner@example.test', 'unused-test-hash');
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(2, 'partner@example.test', 'unused-test-hash');
  cookie = `${config.sessionCookieName}=${createSession(db, 1).token}`;
  app = createApp();
});
afterEach(() => { closeDb(); vi.restoreAllMocks(); });

function cycle(userId = 1, active = 1) {
  const row = db.prepare(`INSERT INTO cycles (user_id, name, current_week, is_active, updated_at)
    VALUES (?, 'מחזור בדיקה', 3, ?, '2026-09-02T12:00:00Z')`).run(userId, active);
  return Number(row.lastInsertRowid);
}
function seedTactic(cycleId: number) {
  const goal = db.prepare("INSERT INTO goals (cycle_id, title, color) VALUES (?, 'לא נשלח ללקוח', 'emerald')").run(cycleId);
  const result = db.prepare(`INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week)
    VALUES (?, 'טקטיקה פרטית', '[0]', 1, 12)`).run(goal.lastInsertRowid);
  return Number(result.lastInsertRowid);
}
function get(path = '/1', auth = cookie) { return request(app).get(`/api/execution-heatmap${path}`).set('Cookie', auth); }

describe('execution heatmap read-only route', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/execution-heatmap/1')).status).toBe(401);
  });

  it('returns an honest no-cycle state without creating any data', async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ access: 'owner', cycle: null, days: [], startDate: null, dateBasis: null });
    expect(result.body.summary.currentStreak).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM cycles').get()).toEqual({ count: 0 });
  });

  it('aggregates only scheduled effective occurrences, respects overrides, and emits no raw records', async () => {
    const id = cycle();
    const tacticId = seedTactic(id);
    db.prepare("INSERT INTO tactic_week_overrides (tactic_id, week, title, weekdays) VALUES (?, 1, 'התאמה', '[2]')").run(tacticId);
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 0, 1)').run(tacticId);
    db.prepare('INSERT INTO completions (tactic_id, week, weekday, done) VALUES (?, 1, 2, 1)').run(tacticId);
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.body.days).toHaveLength(84);
    expect(result.body.days[0]).toMatchObject({ scheduled: 0, completed: 0 });
    expect(result.body.days[2]).toMatchObject({ scheduled: 1, completed: 1, state: 'success' });
    expect(result.body).not.toHaveProperty('goals');
    expect(result.body).not.toHaveProperty('tactics');
    expect(JSON.stringify(result.body)).not.toContain('טקטיקה פרטית');
  });

  it('allows the current partner, then denies them immediately after unlinking', async () => {
    cycle();
    db.prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (1, 2)').run();
    const partnerCookie = `${config.sessionCookieName}=${createSession(db, 2).token}`;
    expect((await get('/1', partnerCookie)).body.access).toBe('partner');
    db.prepare('DELETE FROM partnerships').run();
    expect((await get('/1', partnerCookie)).status).toBe(403);
  });

  it('denies a stranger before cycle lookup', async () => {
    const otherCycle = cycle(2);
    expect((await get(`/2?cycleId=${otherCycle}`)).status).toBe(403);
    expect((await get('/2?cycleId=999')).status).toBe(403);
  });

  it.each(['/0', '/-1', '/1.5', '/1e0', '/9007199254740993', '/1?cycleId=0', '/1?cycleId=abc', '/1?cycleId=1&cycleId=2', '/1?cycleId[x]=1'])(
    'rejects invalid or ambiguous identifiers %s', async (path) => {
      expect((await get(path)).status).toBe(400);
    }
  );

  it('never returns another user’s cycle even when the viewer is their accepted partner', async () => {
    const otherCycle = cycle(2);
    db.prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (2, 1)').run();
    expect((await get(`/1?cycleId=${otherCycle}`)).status).toBe(404);
    expect((await get('/1?cycleId=9999')).status).toBe(404);
    expect((await get(`/2?cycleId=${otherCycle}`)).status).toBe(200);
  });

  it('supports owned and partner archive history with frozen dates and no active-cycle mixing', async () => {
    const archived = cycle(1, 0);
    seedTactic(archived);
    const current = cycle();
    expect((await get()).body.cycle.id).toBe(current);
    const own = await get(`/1?cycleId=${archived}`);
    expect(own.body.cycle).toMatchObject({ id: archived, isActive: false });
    expect(own.body.dateBasis).toBe('archive-week-anchor');
    expect(own.body.days[21].state).toBe('not-reached');
    db.prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (1, 2)').run();
    const partnerCookie = `${config.sessionCookieName}=${createSession(db, 2).token}`;
    const partner = await get(`/1?cycleId=${archived}`, partnerCookie);
    expect(partner.body.access).toBe('partner');
    expect(partner.body.days).toEqual(own.body.days);
  });

  it('offers no mutation endpoint for owner or partner', async () => {
    cycle();
    const before = db.prepare('SELECT count(*) AS count FROM cycles').get();
    expect((await request(app).post('/api/execution-heatmap/1').set('Cookie', cookie).send({ currentWeek: 12 })).status).toBe(404);
    expect((await request(app).put('/api/execution-heatmap/1').set('Cookie', cookie).send({ done: true })).status).toBe(404);
    expect(db.prepare('SELECT count(*) AS count FROM cycles').get()).toEqual(before);
  });
});
