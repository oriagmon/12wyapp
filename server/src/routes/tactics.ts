import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { tacticAdaptationSchema, tacticCreateSchema, tacticUpdateSchema } from '../lib/validation.js';
import { goalBelongsToUser, tacticBelongsToUser } from '../lib/repo.js';
import { collectEvidenceStoredFilenames, scheduleEvidenceFileCleanup } from '../lib/tacticEvidence.js';

export const tacticsRouter = Router();
tacticsRouter.use(requireAuth);

tacticsRouter.post('/', (req, res) => {
  const parsed = tacticCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' });
    return;
  }
  const db = getDb();
  const { goalId, title, weekdays, startWeek, endWeek } = parsed.data;
  const goal = goalBelongsToUser(db, goalId, req.user!.id);
  if (!goal) {
    res.status(404).json({ error: 'המטרה לא נמצאה' });
    return;
  }
  if (goal.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן להוסיף טקטיקות בהיסטוריה' });
    return;
  }
  const info = db
    .prepare(
      'INSERT INTO tactics (goal_id, title, weekdays, start_week, end_week) VALUES (?, ?, ?, ?, ?)'
    )
    .run(goalId, title, JSON.stringify([...new Set(weekdays)].sort()), startWeek, endWeek);
  const tactic = db.prepare('SELECT * FROM tactics WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(tactic);
});

tacticsRouter.patch('/:id', (req, res) => {
  const parsed = tacticUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' });
    return;
  }
  const db = getDb();
  const tacticId = Number(req.params.id);
  const tactic = tacticBelongsToUser(db, tacticId, req.user!.id);
  if (!tactic) {
    res.status(404).json({ error: 'הטקטיקה לא נמצאה' });
    return;
  }
  if (tactic.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן לערוך טקטיקות בהיסטוריה' });
    return;
  }
  const title = parsed.data.title ?? tactic.title;
  const weekdays = parsed.data.weekdays
    ? JSON.stringify([...new Set(parsed.data.weekdays)].sort())
    : tactic.weekdays;
  const startWeek = parsed.data.startWeek ?? tactic.start_week;
  const endWeek = parsed.data.endWeek ?? tactic.end_week;
  if (endWeek < startWeek) {
    res.status(400).json({ error: 'שבוע הסיום חייב להיות אחרי שבוע ההתחלה או שווה לו' });
    return;
  }
  db.prepare(
    `UPDATE tactics SET title = ?, weekdays = ?, start_week = ?, end_week = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(title, weekdays, startWeek, endWeek, tacticId);
  res.json(db.prepare('SELECT * FROM tactics WHERE id = ?').get(tacticId));
});

tacticsRouter.put('/:id/adaptation', (req, res) => {
  const parsed = tacticAdaptationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' });
    return;
  }
  const db = getDb();
  const tacticId = Number(req.params.id);
  const tactic = tacticBelongsToUser(db, tacticId, req.user!.id);
  if (!tactic) {
    res.status(404).json({ error: 'הטקטיקה לא נמצאה' });
    return;
  }
  if (tactic.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן לערוך טקטיקות בהיסטוריה' });
    return;
  }

  const nextWeek = tactic.cycle_current_week + 1;
  if (nextWeek > 12 || nextWeek > tactic.end_week) {
    res.status(400).json({ error: 'אין לטקטיקה שבוע עתידי במחזור הנוכחי' });
    return;
  }

  const lastWeek = parsed.data.scope === 'nextWeek' ? nextWeek : tactic.end_week;
  const weekdays = JSON.stringify([...new Set(parsed.data.weekdays)].sort());
  const upsert = db.prepare(
    `INSERT INTO tactic_week_overrides (tactic_id, week, title, weekdays)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tactic_id, week)
     DO UPDATE SET
       title = excluded.title,
       weekdays = excluded.weekdays,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  );
  db.transaction(() => {
    for (let week = nextWeek; week <= lastWeek; week++) {
      upsert.run(tacticId, week, parsed.data.title, weekdays);
    }
  })();

  const overrides = db
    .prepare(
      `SELECT week, title, weekdays FROM tactic_week_overrides
       WHERE tactic_id = ? ORDER BY week ASC`
    )
    .all(tacticId) as { week: number; title: string; weekdays: string }[];
  res.json({
    tacticId,
    scope: parsed.data.scope,
    fromWeek: nextWeek,
    throughWeek: lastWeek,
    overrides: overrides.map((override) => ({
      week: override.week,
      title: override.title,
      weekdays: JSON.parse(override.weekdays) as number[],
    })),
  });
});

/** Undo of the one-week adaptation above: drops the override for the upcoming week so the
 *  tactic falls back to its own baseline. Scoped to that single week on purpose — a weekly
 *  tweak is the only thing the planning ritual can create, so it is the only thing it may
 *  take back. Past weeks keep their overrides, because they already scored against them. */
tacticsRouter.delete('/:id/adaptation', (req, res) => {
  const db = getDb();
  const tacticId = Number(req.params.id);
  const tactic = tacticBelongsToUser(db, tacticId, req.user!.id);
  if (!tactic) {
    res.status(404).json({ error: 'הטקטיקה לא נמצאה' });
    return;
  }
  if (tactic.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן לערוך טקטיקות בהיסטוריה' });
    return;
  }

  const nextWeek = tactic.cycle_current_week + 1;
  if (nextWeek > 12 || nextWeek > tactic.end_week) {
    res.status(400).json({ error: 'אין לטקטיקה שבוע עתידי במחזור הנוכחי' });
    return;
  }

  const removed = db
    .prepare('DELETE FROM tactic_week_overrides WHERE tactic_id = ? AND week = ?')
    .run(tacticId, nextWeek);
  res.json({ tacticId, week: nextWeek, removed: removed.changes > 0 });
});

tacticsRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const tacticId = Number(req.params.id);
  const tactic = tacticBelongsToUser(db, tacticId, req.user!.id);
  if (!tactic) {
    res.status(404).json({ error: 'הטקטיקה לא נמצאה' });
    return;
  }
  if (tactic.cycle_is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן למחוק טקטיקות בהיסטוריה' });
    return;
  }
  // Collected *before* the cascading delete below removes the tactic_evidence rows
  // referencing this tactic — SQL's own ON DELETE CASCADE has no way to also remove the
  // corresponding files from disk, so that cleanup is scheduled explicitly afterward.
  const evidenceFileNames = collectEvidenceStoredFilenames(db, [tacticId]);
  db.prepare('DELETE FROM tactics WHERE id = ?').run(tacticId);
  scheduleEvidenceFileCleanup(evidenceFileNames);
  res.status(204).end();
});
