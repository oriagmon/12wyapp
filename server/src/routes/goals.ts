import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { goalCreateSchema, goalUpdateSchema } from '../lib/validation.js';
import { getActiveCycle, getGoalsForCycle, goalBelongsToUser, nextGoalColor } from '../lib/repo.js';
import { collectEvidenceStoredFilenames, scheduleEvidenceFileCleanup } from '../lib/tacticEvidence.js';
import { tReq } from '../lib/i18n/index.js';

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

const MAX_GOALS = 3;

goalsRouter.post('/', (req, res) => {
  const parsed = goalCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const userId = req.user!.id;
  const cycle = getActiveCycle(db, userId);
  if (!cycle) {
    res.status(404).json({ error: 'יש ליצור מחזור לפני הוספת מטרות' });
    return;
  }
  const existingGoals = getGoalsForCycle(db, cycle.id);
  if (existingGoals.length >= MAX_GOALS) {
    res.status(409).json({ error: `ניתן להוסיף עד ${MAX_GOALS} מטרות למחזור` });
    return;
  }
  const color = parsed.data.color ?? nextGoalColor(db, cycle.id);
  const info = db
    .prepare('INSERT INTO goals (cycle_id, title, color, sort_order) VALUES (?, ?, ?, ?)')
    .run(cycle.id, parsed.data.title, color, existingGoals.length);
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(goal);
});

goalsRouter.patch('/:id', (req, res) => {
  const parsed = goalUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const goalId = Number(req.params.id);
  const goal = goalBelongsToUser(db, goalId, req.user!.id);
  if (!goal) {
    res.status(404).json({ error: 'המטרה לא נמצאה' });
    return;
  }
  if (goal.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן לערוך מטרות בהיסטוריה' });
    return;
  }
  const title = parsed.data.title ?? goal.title;
  db.prepare(`UPDATE goals SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
    title,
    goalId
  );
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId));
});

/** Requires { confirm: true } in the body since this cascades to all tactics and completions. */
goalsRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const goalId = Number(req.params.id);
  const goal = goalBelongsToUser(db, goalId, req.user!.id);
  if (!goal) {
    res.status(404).json({ error: 'המטרה לא נמצאה' });
    return;
  }
  if (goal.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן למחוק מטרות בהיסטוריה' });
    return;
  }
  const body = req.body as { confirm?: unknown };
  if (body?.confirm !== true) {
    res.status(400).json({ error: 'יש לאשר את המחיקה (confirm: true)' });
    return;
  }
  // Collected *before* the cascading delete below (goal → tactics → tactic_evidence) removes
  // every evidence row under this goal's tactics — see the identical comment in
  // routes/tactics.ts's own DELETE handler for why this can't be handled by SQL's CASCADE
  // alone.
  const tacticIds = (db.prepare('SELECT id FROM tactics WHERE goal_id = ?').all(goalId) as { id: number }[]).map(
    (t) => t.id
  );
  const evidenceFileNames = collectEvidenceStoredFilenames(db, tacticIds);
  db.prepare('DELETE FROM goals WHERE id = ?').run(goalId);
  scheduleEvidenceFileCleanup(evidenceFileNames);
  res.status(204).end();
});
