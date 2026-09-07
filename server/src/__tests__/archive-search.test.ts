import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { freshApp } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { config } from '../config.js';
import { createSession } from '../lib/sessions.js';
import type { ArchiveSearchCategory, ArchiveSearchItem } from '../lib/archiveSearch.js';

interface Group {
  category: ArchiveSearchCategory;
  count: number;
  hasMore: boolean;
  items: ArchiveSearchItem[];
}

describe('permission-scoped archive search', () => {
  let app: ReturnType<typeof freshApp>;
  let cookie: string;
  let viewer: number;
  let partner: number;
  let stranger: number;
  let ex: number;
  let pending: number;
  let partnership: number;
  let active: number;
  let archived: number;
  let partnerActive: number;
  let partnerArchived: number;
  let wam: number;
  let oldWam: number;
  let reminder: number;
  let goal: number;
  let tactic: number;
  let commitment: number;
  let punishment: number;

  const id = (value: { lastInsertRowid: number | bigint }) => Number(value.lastInsertRowid);
  function user(email: string) {
    return id(getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, 'hidden-password-sentinel'));
  }
  function session(userId: number) {
    return `${config.sessionCookieName}=${createSession(getDb(), userId).token}`;
  }
  function cycle(userId: number, isActive: number, name = 'מחט במחזור') {
    return id(getDb().prepare('INSERT INTO cycles (user_id, name, is_active, current_week) VALUES (?, ?, ?, 6)').run(userId, name, isActive));
  }
  function meeting(pairId: number, ca: number | null, cb: number | null, week = 3, notes = 'מחט בפגישה') {
    return id(getDb().prepare(`INSERT INTO wams (partnership_id, initiator_cycle_id, invitee_cycle_id, week, notes)
      VALUES (?, ?, ?, ?, ?)`).run(pairId, ca, cb, week, notes));
  }
  function addReminder(creator: number, recipient: number, title = 'מחט בתזכורת', body = 'תוכן קצר') {
    return id(getDb().prepare(`INSERT INTO scheduled_email_reminders
      (creator_user_id, recipient_user_id, title, body, scheduled_for, last_error)
      VALUES (?, ?, ?, ?, '2027-01-01T10:00:00.000Z', 'hidden-delivery-sentinel')`).run(creator, recipient, title, body));
  }
  function search(q = 'מחט', extra: Record<string, unknown> = {}, auth = cookie) {
    return request(app).get('/api/archive-search').set('Cookie', auth).query({ q, ...extra });
  }
  function group(body: { groups: Group[] }, category: ArchiveSearchCategory) {
    return body.groups.find((value) => value.category === category)!;
  }

  beforeEach(() => {
    app = freshApp();
    viewer = user('viewer@example.test');
    partner = user('partner@example.test');
    stranger = user('stranger@example.test');
    ex = user('ex@example.test');
    pending = user('pending@example.test');
    cookie = session(viewer);
    partnership = id(getDb().prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (?, ?)').run(viewer, partner));
    active = cycle(viewer, 1);
    archived = cycle(viewer, 0);
    partnerActive = cycle(partner, 1);
    partnerArchived = cycle(partner, 0);
    const strangerCycle = cycle(stranger, 1);
    const exCycle = cycle(ex, 1);
    cycle(pending, 1);
    const otherPair = id(getDb().prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (?, ?)').run(stranger, ex));
    const foreignWam = meeting(otherPair, strangerCycle, exCycle);
    for (const cycleId of [active, archived, partnerActive, partnerArchived, strangerCycle, exCycle]) {
      const goalId = id(getDb().prepare('INSERT INTO goals (cycle_id, title, color) VALUES (?, ?, ?)').run(cycleId, 'מחט במטרה', '#000000'));
      const tacticId = id(getDb().prepare(`INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week)
        VALUES (?, 'מחט בטקטיקה', '[1]', 8, 10)`).run(goalId));
      if (cycleId === archived) { goal = goalId; tactic = tacticId; }
    }
    wam = meeting(partnership, active, partnerActive);
    oldWam = meeting(partnership, archived, partnerArchived);
    for (const wamId of [wam, oldWam, foreignWam]) {
      const commitmentId = id(getDb().prepare(`INSERT INTO wam_commitments (wam_id, scope, label)
        VALUES (?, 'b', 'מחט בהתחייבות')`).run(wamId));
      const punishmentId = id(getDb().prepare(`INSERT INTO wam_punishments (source_wam_id, author_user_id, assigned_user_id, label)
        VALUES (?, ?, ?, 'מחט בעונש')`).run(wamId, wamId === foreignWam ? stranger : viewer, wamId === foreignWam ? ex : partner));
      if (wamId === oldWam) { commitment = commitmentId; punishment = punishmentId; }
    }
    reminder = addReminder(viewer, partner);
    addReminder(partner, viewer);
    addReminder(stranger, viewer);
  });

  afterAll(closeDb);

  it('requires an authenticated session', async () => {
    expect((await request(app).get('/api/archive-search?q=x')).status).toBe(401);
  });

  it('groups exact counts and returns only owned/current-partner active and archived data', async () => {
    const response = await search();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.query).toBe('מחט');
    expect(response.body.limit).toBe(5);
    expect(response.body.groups.map((value: Group) => [value.category, value.count, value.hasMore])).toEqual([
      ['cycles', 4, false], ['goals', 4, false], ['tactics', 4, false], ['wams', 2, false],
      ['commitments', 2, false], ['punishments', 2, false], ['reminders', 1, false],
    ]);
    expect(response.body.totalCount).toBe(19);
    const cycles = group(response.body, 'cycles').items;
    expect(cycles.map((value) => value.target)).toEqual([
      { kind: 'cycle', cycleId: partnerActive, userId: partner, week: 6 },
      { kind: 'cycle', cycleId: active, userId: viewer, week: 6 },
      { kind: 'cycle', cycleId: partnerArchived, userId: partner, week: 6 },
      { kind: 'cycle', cycleId: archived, userId: viewer, week: 6 },
    ]);
    expect(cycles.map((value) => value.isArchived)).toEqual([false, false, true, true]);
    expect(cycles.map((value) => value.ownership)).toEqual(['partner', 'mine', 'partner', 'mine']);
  });

  it('navigates archived goals, scheduled tactic weeks, WAM generations, commitments, punishments and reminders by exact IDs', async () => {
    const { body } = await search();
    expect(group(body, 'goals').items.find((item) => item.id === goal)?.target)
      .toEqual({ kind: 'cycle', cycleId: archived, userId: viewer, week: 6, goalId: goal });
    expect(group(body, 'tactics').items.find((item) => item.id === tactic)?.target)
      .toEqual({ kind: 'cycle', cycleId: archived, userId: viewer, week: 8, goalId: goal, tacticId: tactic });
    expect(group(body, 'wams').items.map((item) => [item.target, item.isArchived])).toEqual([
      [{ kind: 'wam', wamId: wam, cycleId: active, userId: viewer, week: 3 }, false],
      [{ kind: 'wam', wamId: oldWam, cycleId: archived, userId: viewer, week: 3 }, true],
    ]);
    expect(group(body, 'commitments').items.find((item) => item.id === commitment)?.target)
      .toEqual({ kind: 'wam', wamId: oldWam, cycleId: archived, userId: viewer, week: 3, commitmentId: commitment });
    expect(group(body, 'punishments').items.find((item) => item.id === punishment)?.target)
      .toEqual({ kind: 'wam', wamId: oldWam, cycleId: archived, userId: viewer, week: 3, punishmentId: punishment });
    expect(group(body, 'reminders').items.map((item) => item.target)).toEqual([{ kind: 'reminder', reminderId: reminder }]);
  });

  it('resolves invitee-side cycle context and null-cycle WAMs without switching to a current cycle', async () => {
    const nullWam = meeting(partnership, null, null, 4);
    const { body } = await search('מחט', {}, session(partner));
    expect(group(body, 'wams').items.find((item) => item.id === wam)?.target)
      .toEqual({ kind: 'wam', wamId: wam, cycleId: partnerActive, userId: partner, week: 3 });
    expect(group(body, 'wams').items.find((item) => item.id === nullWam)?.target)
      .toEqual({ kind: 'wam', wamId: nullWam, cycleId: null, userId: partner, week: 4 });
  });

  it('marks a WAM historical when only the other participant cycle was archived', async () => {
    getDb().prepare('UPDATE cycles SET is_active = 0 WHERE id = ?').run(partnerActive);
    const { body } = await search();
    expect(group(body, 'wams').items.find((item) => item.id === wam)?.isArchived).toBe(true);
  });

  it('finds a due punishment once and opens its source WAM rather than guessing from its week', async () => {
    const dueWam = meeting(partnership, active, partnerActive, 1, 'nothing matching');
    getDb().prepare('UPDATE wam_punishments SET due_wam_id = ?, label = ? WHERE id = ?')
      .run(dueWam, 'due-only-needle', punishment);
    const { body } = await search('due-only-needle');
    expect(body.totalCount).toBe(1);
    expect(group(body, 'punishments').items[0].target).toEqual({
      kind: 'wam', userId: viewer, cycleId: archived, week: 3, wamId: oldWam, punishmentId: punishment,
    });
  });

  it('revokes ex-partner history and WAM content immediately on unpairing', async () => {
    getDb().prepare('DELETE FROM partnerships WHERE id = ?').run(partnership);
    const { body } = await search();
    expect(group(body, 'cycles').items.map((item) => item.target)).toEqual([
      { kind: 'cycle', cycleId: active, userId: viewer, week: 6 },
      { kind: 'cycle', cycleId: archived, userId: viewer, week: 6 },
    ]);
    for (const key of ['wams', 'commitments', 'punishments'] as const) expect(group(body, key).count).toBe(0);
    // A reminder remains creator-owned even when its recipient is now an ex-partner.
    expect(group(body, 'reminders').count).toBe(1);
  });

  it('does not grant stranger/pending-invitation access (004 removes pending relationships)', async () => {
    const columns = getDb().prepare('PRAGMA table_info(partnerships)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('status');
    // Matching a registered invitee/email without an existing direct pairing is not acceptance.
    const { body } = await search('מחט', {}, session(pending));
    expect(group(body, 'cycles').count).toBe(1);
    for (const key of ['goals', 'tactics', 'wams', 'commitments', 'punishments', 'reminders'] as const) {
      expect(group(body, key).count).toBe(0);
    }
    const strangerResults = await search('מחט', {}, session(stranger));
    expect(group(strangerResults.body, 'wams').items.every((item) => item.target.kind === 'wam' && ![wam, oldWam].includes(item.target.wamId))).toBe(true);
  });

  it.each(['%', '_', '\\', "' OR 1=1 --", 'a.b[0]', 'שלום עולם'])('treats %j as a literal substring, never a wildcard or SQL', async (query) => {
    getDb().prepare('UPDATE cycles SET notes = ? WHERE id = ?').run(`לפני ${query} אחרי`, archived);
    const { body, status } = await search(query);
    expect(status).toBe(200);
    expect(body.totalCount).toBe(1);
    expect(group(body, 'cycles').items[0]).toMatchObject({ id: archived, snippet: `לפני ${query} אחרי`, matchedField: 'הערות' });
  });

  it('matches ASCII case insensitively and trims boundary whitespace', async () => {
    getDb().prepare('UPDATE cycles SET notes = ? WHERE id = ?').run('One NEEDLE Two', archived);
    const { body } = await search('  needle  ');
    expect(body.query).toBe('needle');
    expect(group(body, 'cycles').items[0].snippet).toBe('One NEEDLE Two');
  });

  it('searches all authorized planning/WAM text, while returning only one bounded matching excerpt', async () => {
    const db = getDb();
    for (const field of ['vision', 'success_definition', 'why_it_matters', 'blockers', 'risks', 'lag_measures', 'lead_measures', 'notes']) {
      db.prepare(`UPDATE cycles SET ${field} = ? WHERE id = ?`).run(`unique-${field}`, active);
      expect(group((await search(`unique-${field}`)).body, 'cycles').count).toBe(1);
    }
    for (const field of ['wins', 'misses', 'blockers', 'lessons_learned', 'notes', 'adjustment_notes']) {
      db.prepare(`UPDATE wams SET ${field} = ? WHERE id = ?`).run(`unique-${field}`, wam);
      expect(group((await search(`unique-${field}`)).body, 'wams').count).toBe(1);
    }
    db.prepare('UPDATE wams SET wins = ?, notes = ? WHERE id = ?')
      .run(`${'prefix '.repeat(100)}<b>מחט</b>${' suffix'.repeat(100)}`, 'unmatched-private-section', wam);
    const result = group((await search()).body, 'wams').items.find((item) => item.id === wam)!;
    expect(result.snippet).toContain('<b>מחט</b>');
    expect(Array.from(result.snippet).length).toBeLessThanOrEqual(182);
    expect(JSON.stringify(result)).not.toContain('unmatched-private-section');
    expect(result).not.toHaveProperty('wins');
    expect(result).not.toHaveProperty('notes');
  });

  it('searches reminder bodies only for the creator and never searches email, credentials or delivery internals', async () => {
    const own = addReminder(viewer, partner, 'no match', 'body-only-match');
    addReminder(partner, viewer, 'no match', 'body-only-match');
    const { body } = await search('body-only-match');
    expect(body.totalCount).toBe(1);
    expect(group(body, 'reminders').items[0]).toMatchObject({ id: own, matchedField: 'תוכן התזכורת', snippet: 'body-only-match' });
    for (const q of ['viewer@example.test', 'partner@example.test', 'hidden-password-sentinel', 'hidden-delivery-sentinel']) {
      expect((await search(q)).body.totalCount).toBe(0);
    }
    const serialized = JSON.stringify((await search()).body);
    expect(serialized).not.toMatch(/password_hash|recipient|last_error|@example\.test|calendar_event|token/);
  });

  it('counts exact matches beyond the per-group cap, with stable tie-breaking and a hard upper bound', async () => {
    const db = getDb();
    for (let index = 0; index < 25; index++) {
      db.prepare(`INSERT INTO goals (cycle_id, title, color, sort_order, created_at)
        VALUES (?, 'מחט נוספת', '#000000', 0, '2026-01-01')`).run(active);
    }
    const first = await search('מחט', { limit: 2 });
    const second = await search('מחט', { limit: 2 });
    expect(first.body).toEqual(second.body);
    expect(group(first.body, 'goals')).toMatchObject({ count: 29, hasMore: true });
    expect(group(first.body, 'goals').items).toHaveLength(2);
    expect(first.body.groups.every((value: Group) => value.items.length <= 2)).toBe(true);
    expect(group((await search('מחט', { limit: 20 })).body, 'goals').items).toHaveLength(20);
    expect((await search('מחט', { limit: 21 })).status).toBe(400);
  });

  it.each([
    {}, { q: '' }, { q: '   ' }, { q: 'x'.repeat(121) }, { q: '\0x' }, { q: 'a\nb' },
    { q: ['x', 'y'] }, { q: { nested: 'x' } }, { q: 'x', limit: '0' },
    { q: 'x', limit: '1.5' }, { q: 'x', limit: 'no' }, { q: 'x', userId: '2' },
  ])('rejects invalid or unexpected query input %j', async (query) => {
    const response = await request(app).get('/api/archive-search').set('Cookie', cookie).query(query);
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it('accepts the maximum-length query and returns honest empty counts', async () => {
    const response = await search('x'.repeat(120));
    expect(response.status).toBe(200);
    expect(response.body.totalCount).toBe(0);
    expect(response.body.groups).toHaveLength(7);
    expect(response.body.groups.every((value: Group) => value.count === 0 && !value.hasMore && value.items.length === 0)).toBe(true);
  });

  it('bounds long titles/context and keeps a full maximum-length match in the excerpt', async () => {
    const query = 'ש'.repeat(120);
    getDb().prepare('UPDATE cycles SET name = ? WHERE id = ?')
      .run(`${'😀'.repeat(250)} ${query} ${'ס'.repeat(250)}`, archived);
    const { body } = await search(query);
    const item = group(body, 'cycles').items[0];
    expect(item.snippet).toContain(query);
    expect(Array.from(item.snippet).length).toBeLessThanOrEqual(182);
    expect(Array.from(item.title).length).toBeLessThanOrEqual(97);
    expect(Array.from(item.cycleName!).length).toBeLessThanOrEqual(97);
    expect(item.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
