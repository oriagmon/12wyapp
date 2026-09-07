import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess, type AccessLevel } from '../lib/access.js';
import { getCycleById, type CycleRow } from '../lib/repo.js';

export const weeklyPlanningRouter = Router();
weeklyPlanningRouter.use(requireAuth);

interface WeeklyPlanningRitualRow {
  id: number;
  cycle_id: number;
  target_week: number;
  worked_well: string;
  improve_next: string;
  tactics_reviewed: number;
  weekly_focus: string;
  commitment: string;
  status: 'draft' | 'complete';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Only fields the guided ritual UI ever writes; every field is optional so each step of
 *  the wizard can save just its own slice without clobbering fields owned by other steps. */
const weeklyPlanningDraftSchema = z.object({
  workedWell: z.string().max(4000).optional(),
  improveNext: z.string().max(4000).optional(),
  tacticsReviewed: z.boolean().optional(),
  weeklyFocus: z.string().max(2000).optional(),
  commitment: z.string().max(2000).optional(),
});

function serialize(row: WeeklyPlanningRitualRow) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    targetWeek: row.target_week,
    workedWell: row.worked_well,
    improveNext: row.improve_next,
    tacticsReviewed: row.tactics_reviewed === 1,
    weeklyFocus: row.weekly_focus,
    commitment: row.commitment,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findRitual(
  db: Database.Database,
  cycleId: number,
  targetWeek: number
): WeeklyPlanningRitualRow | undefined {
  return db
    .prepare('SELECT * FROM weekly_planning_rituals WHERE cycle_id = ? AND target_week = ?')
    .get(cycleId, targetWeek) as WeeklyPlanningRitualRow | undefined;
}

interface RitualContext {
  cycleId: number;
  targetWeek: number;
  cycle: CycleRow;
  access: AccessLevel;
}

/**
 * Resolves and authorizes a `/:cycleId/:targetWeek` request, sending the appropriate error
 * response and returning null if anything is invalid or unauthorized. `requireOwner` and
 * `requireActive` gate mutation-only endpoints; `requireNextWeek` enforces the core product
 * rule that the ritual only ever targets the *next* cycle week (current_week + 1) — never a
 * skipped-ahead week, and never once the cycle has reached its final week 12.
 */
function loadContext(
  req: Request,
  res: Response,
  db: Database.Database,
  options: { requireOwner?: boolean; requireActive?: boolean; requireNextWeek?: boolean } = {}
): RitualContext | null {
  const cycleId = Number(req.params.cycleId);
  const targetWeek = Number(req.params.targetWeek);
  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    res.status(400).json({ error: 'מזהה מחזור לא תקין' });
    return null;
  }
  if (!Number.isInteger(targetWeek) || targetWeek < 2 || targetWeek > 12) {
    res.status(400).json({ error: 'שבוע יעד לא תקין — יש לבחור שבוע בין 2 ל-12' });
    return null;
  }
  const cycle = getCycleById(db, cycleId);
  if (!cycle) {
    res.status(404).json({ error: 'המחזור לא נמצא' });
    return null;
  }
  const access = resolveAccess(db, req.user!.id, cycle.user_id);
  if (access === 'none') {
    res.status(403).json({ error: 'אין הרשאה לצפות בטקס התכנון השבועי' });
    return null;
  }
  if (options.requireOwner && access !== 'owner') {
    res.status(403).json({ error: 'רק בעל/ת הלוח יכול/ה לערוך את טקס התכנון השבועי' });
    return null;
  }
  if (options.requireActive && cycle.is_active !== 1) {
    res.status(400).json({ error: 'המחזור הסתיים — לא ניתן לערוך את טקס התכנון השבועי בהיסטוריה' });
    return null;
  }
  if (options.requireNextWeek) {
    if (cycle.current_week >= 12) {
      res
        .status(400)
        .json({ error: 'המחזור הגיע לשבוע 12, השבוע האחרון — יש לסיים ולסקור את המחזור לפני תכנון שבוע נוסף' });
      return null;
    }
    if (targetWeek !== cycle.current_week + 1) {
      res.status(400).json({ error: 'ניתן לתכנן רק את השבוע הבא ביחס לשבוע הנוכחי במחזור' });
      return null;
    }
  }
  return { cycleId, targetWeek, cycle, access };
}

/** GET /:cycleId/:targetWeek — returns the ritual (or null if none saved yet) for anyone
 *  with read access to the cycle's owner (owner or partner). Not gated on "next week" so
 *  completed rituals remain readable as the cycle progresses. */
weeklyPlanningRouter.get('/:cycleId/:targetWeek', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db);
  if (!ctx) return;
  const row = findRitual(db, ctx.cycleId, ctx.targetWeek);
  res.json({ access: ctx.access, ritual: row ? serialize(row) : null });
});

/** PUT /:cycleId/:targetWeek — owner-only upsert of draft fields. Any field omitted from the
 *  body keeps its previously-saved value (or the empty default for a brand-new row), so each
 *  wizard step can save independently. Editing a *completed* ritual requires reopening it
 *  first, matching the WAM completion lock pattern. */
weeklyPlanningRouter.put('/:cycleId/:targetWeek', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true, requireActive: true, requireNextWeek: true });
  if (!ctx) return;

  const parsed = weeklyPlanningDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' });
    return;
  }

  const existing = findRitual(db, ctx.cycleId, ctx.targetWeek);
  if (existing && existing.status === 'complete') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הטקס לפני עריכת התוכן' });
    return;
  }

  const merged = {
    workedWell: parsed.data.workedWell ?? existing?.worked_well ?? '',
    improveNext: parsed.data.improveNext ?? existing?.improve_next ?? '',
    tacticsReviewed: parsed.data.tacticsReviewed ?? (existing ? existing.tactics_reviewed === 1 : false),
    weeklyFocus: parsed.data.weeklyFocus ?? existing?.weekly_focus ?? '',
    commitment: parsed.data.commitment ?? existing?.commitment ?? '',
  };

  db.prepare(
    `INSERT INTO weekly_planning_rituals
       (cycle_id, target_week, worked_well, improve_next, tactics_reviewed, weekly_focus, commitment)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cycle_id, target_week) DO UPDATE SET
       worked_well = excluded.worked_well,
       improve_next = excluded.improve_next,
       tactics_reviewed = excluded.tactics_reviewed,
       weekly_focus = excluded.weekly_focus,
       commitment = excluded.commitment,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(
    ctx.cycleId,
    ctx.targetWeek,
    merged.workedWell,
    merged.improveNext,
    merged.tacticsReviewed ? 1 : 0,
    merged.weeklyFocus,
    merged.commitment
  );

  const row = findRitual(db, ctx.cycleId, ctx.targetWeek)!;
  res.json({ access: 'owner', ritual: serialize(row) });
});

/** POST /:cycleId/:targetWeek/complete — owner-only. Requires a draft to already exist and
 *  requires tactics-reviewed + a non-empty weekly focus + a non-empty commitment, matching the
 *  product rule that completion (not just saving a draft) enforces the full ritual. */
weeklyPlanningRouter.post('/:cycleId/:targetWeek/complete', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true, requireActive: true, requireNextWeek: true });
  if (!ctx) return;

  const existing = findRitual(db, ctx.cycleId, ctx.targetWeek);
  if (!existing) {
    res.status(400).json({ error: 'יש לשמור טיוטה של הטקס לפני השלמתו' });
    return;
  }
  if (existing.status === 'complete') {
    res.status(409).json({ error: 'הטקס כבר הושלם. יש לפתוח מחדש כדי לעדכן ולהשלים שוב' });
    return;
  }
  if (existing.tactics_reviewed !== 1) {
    res.status(400).json({ error: 'יש לאשר שבדקתם והתאמתם את הטקטיקות לשבוע הבא' });
    return;
  }
  if (existing.weekly_focus.trim().length === 0) {
    res.status(400).json({ error: 'יש להגדיר את המיקוד המרכזי לשבוע הבא' });
    return;
  }
  if (existing.commitment.trim().length === 0) {
    res.status(400).json({ error: 'יש להזין את ההתחייבות לשבוע הבא' });
    return;
  }

  db.prepare(
    `UPDATE weekly_planning_rituals
     SET status = 'complete', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(existing.id);

  const row = findRitual(db, ctx.cycleId, ctx.targetWeek)!;
  res.json({ access: 'owner', ritual: serialize(row) });
});

/** POST /:cycleId/:targetWeek/reopen — owner-only. Puts a completed ritual back into draft
 *  status for editing; the ritual keeps all its previously saved field values. */
weeklyPlanningRouter.post('/:cycleId/:targetWeek/reopen', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true, requireActive: true });
  if (!ctx) return;

  const existing = findRitual(db, ctx.cycleId, ctx.targetWeek);
  if (!existing) {
    res.status(404).json({ error: 'הטקס לא נמצא' });
    return;
  }
  if (existing.status === 'draft') {
    res.status(409).json({ error: 'הטקס כבר במצב טיוטה' });
    return;
  }

  db.prepare(
    `UPDATE weekly_planning_rituals
     SET status = 'draft', completed_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(existing.id);

  const row = findRitual(db, ctx.cycleId, ctx.targetWeek)!;
  res.json({ access: 'owner', ritual: serialize(row) });
});
