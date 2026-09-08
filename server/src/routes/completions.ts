import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { completionToggleSchema } from '../lib/validation.js';
import { tacticBelongsToUser } from '../lib/repo.js';
import { isScheduled } from '../lib/scoring.js';
import { tReq } from '../lib/i18n/index.js';

export const completionsRouter = Router();
completionsRouter.use(requireAuth);

completionsRouter.post('/toggle', (req, res) => {
  const parsed = completionToggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday, done } = parsed.data;
  const tactic = tacticBelongsToUser(db, tacticId, req.user!.id);
  if (!tactic) {
    res.status(404).json({ error: tReq(req, 'api.tactics.notFound') });
    return;
  }
  if (tactic.cycle_is_active !== 1) {
    res.status(400).json({ error: tReq(req, 'api.completions.cycleEnded') });
    return;
  }
  const override = db
    .prepare('SELECT weekdays FROM tactic_week_overrides WHERE tactic_id = ? AND week = ?')
    .get(tacticId, week) as { weekdays: string } | undefined;
  const scheduled = isScheduled(
    {
      weekdays: override ? JSON.parse(override.weekdays) : JSON.parse(tactic.weekdays),
      startWeek: tactic.start_week,
      endWeek: tactic.end_week,
    },
    week,
    weekday
  );
  if (!scheduled) {
    res.status(400).json({ error: tReq(req, 'api.completions.dayNotScheduled') });
    return;
  }

  db.prepare(
    `INSERT INTO completions (tactic_id, week, weekday, done)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tactic_id, week, weekday)
     DO UPDATE SET done = excluded.done, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(tacticId, week, weekday, done ? 1 : 0);

  res.json({ tacticId, week, weekday, done });
});
