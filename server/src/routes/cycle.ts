import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { cycleCreateSchema, cycleUpdateSchema } from '../lib/validation.js';
import { getActiveCycle } from '../lib/repo.js';
import { tReq } from '../lib/i18n/index.js';
import { israelWeekStart } from '../lib/israelTime.js';
import { finalizeClosedWeekScoresQuietly } from '../lib/weekScoreFinalization.js';

export const cycleRouter = Router();
cycleRouter.use(requireAuth);

cycleRouter.post('/', (req, res) => {
  const parsed = cycleCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const userId = req.user!.id;
  const existing = getActiveCycle(db, userId);
  if (existing) {
    res.status(409).json({ error: tReq(req, 'api.cycle.alreadyActive') });
    return;
  }
  const info = db
    .prepare('INSERT INTO cycles (user_id, name, current_week, is_active, started_on) VALUES (?, ?, 1, 1, ?)')
    .run(userId, parsed.data.name, israelWeekStart());
  const cycle = db.prepare('SELECT * FROM cycles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(cycle);
});

cycleRouter.patch('/', (req, res) => {
  const parsed = cycleUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const userId = req.user!.id;
  const cycle = getActiveCycle(db, userId);
  if (!cycle) {
    res.status(404).json({ error: tReq(req, 'api.cycle.noActiveCycle') });
    return;
  }
  const name = parsed.data.name ?? cycle.name;
  const currentWeek = parsed.data.currentWeek ?? cycle.current_week;
  db.prepare(
    `UPDATE cycles SET
       name = ?, current_week = ?, vision = ?, success_definition = ?,
       why_it_matters = ?, blockers = ?, risks = ?, lag_measures = ?,
       lead_measures = ?, notes = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(
    name,
    currentWeek,
    parsed.data.vision ?? cycle.vision,
    parsed.data.successDefinition ?? cycle.success_definition,
    parsed.data.whyItMatters ?? cycle.why_it_matters,
    parsed.data.blockers ?? cycle.blockers,
    parsed.data.risks ?? cycle.risks,
    parsed.data.lagMeasures ?? cycle.lag_measures,
    parsed.data.leadMeasures ?? cycle.lead_measures,
    parsed.data.notes ?? cycle.notes,
    cycle.id
  );
  const updated = db.prepare('SELECT * FROM cycles WHERE id = ?').get(cycle.id);
  // Moving past a week is the only signal this schema has that the week is actually over
  // (cycles carry no dates), so it is also the moment any meeting that reviewed an earlier
  // week can stop carrying the mid-week score it froze at completion time. Deliberately
  // after the UPDATE above, so the comparison sees the new current_week.
  finalizeClosedWeekScoresQuietly(db, userId);
  res.json(updated);
});

/**
 * Transactional "finish & start new" cycle: archives the current active cycle (its
 * goals/tactics/completions become permanent, immutable read-only history — see
 * routes/cycles.ts) and starts a fresh 12-week active cycle. Never deletes anything.
 */
cycleRouter.post('/reset', (req, res) => {
  const body = req.body as { name?: unknown; confirm?: unknown };
  if (body.confirm !== true) {
    res.status(400).json({ error: tReq(req, 'api.cycle.confirmRequired') });
    return;
  }
  const parsed = cycleCreateSchema.safeParse({ name: body.name });
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const userId = req.user!.id;
  const existing = getActiveCycle(db, userId);

  const run = db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE cycles SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).run(existing.id);
    }
    const info = db
      .prepare('INSERT INTO cycles (user_id, name, current_week, is_active, started_on) VALUES (?, ?, 1, 1, ?)')
      .run(userId, parsed.data.name, israelWeekStart());
    return info.lastInsertRowid;
  });
  const newId = run();
  const cycle = db.prepare('SELECT * FROM cycles WHERE id = ?').get(newId);
  res.status(201).json(cycle);
});
