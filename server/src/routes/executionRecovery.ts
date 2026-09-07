import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess, type AccessLevel } from '../lib/access.js';
import {
  getActiveCycle,
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
  type CycleRow,
} from '../lib/repo.js';
import { assessExecutionRisk, type ExecutionRiskAssessment } from '../lib/executionRisk.js';
import type { TacticWithCompletions } from '../lib/scoring.js';
import { tReq } from '../lib/i18n/index.js';

export const executionRecoveryRouter = Router();
executionRecoveryRouter.use(requireAuth);

interface PlanRow {
  id: number;
  cycle_id: number;
  week: number;
  strategy: 'reduce_next_week' | 'maneuver';
  note: string;
  status: 'active' | 'resolved';
  adjustment_json: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function serializePlan(row: PlanRow) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    week: row.week,
    strategy: row.strategy,
    note: row.note,
    status: row.status,
    adjustment: row.adjustment_json ? (JSON.parse(row.adjustment_json) as unknown) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function findPlan(db: Database.Database, cycleId: number, week: number): PlanRow | undefined {
  return db
    .prepare('SELECT * FROM execution_recovery_plans WHERE cycle_id = ? AND week = ?')
    .get(cycleId, week) as PlanRow | undefined;
}

/** Builds the same `TacticWithCompletions[]` shape scoring.ts/executionRisk.ts consume,
 *  reflecting every per-week override — mirrors computeCycleWeekScore in lib/wam.ts exactly,
 *  duplicated locally since that helper is keyed by an arbitrary historical cycle id/week
 *  rather than "this user's active cycle", and pulling it in would couple this route to WAM
 *  concerns unnecessarily. */
function buildTacticsWithCompletions(db: Database.Database, cycleId: number): TacticWithCompletions[] {
  const goals = getGoalsForCycle(db, cycleId);
  const tactics = getTacticsForGoals(db, goals.map((g) => g.id));
  const tacticIds = tactics.map((t) => t.id);
  const completions = getCompletionsForTactics(db, tacticIds);
  const overrides = getTacticOverrides(db, tacticIds);
  return tactics.map((t) => ({
    id: t.id,
    weekdays: JSON.parse(t.weekdays) as number[],
    startWeek: t.start_week,
    endWeek: t.end_week,
    overrides: overrides
      .filter((o) => o.tactic_id === t.id)
      .map((o) => ({ week: o.week, weekdays: JSON.parse(o.weekdays) as number[] })),
    completions: completions
      .filter((c) => c.tactic_id === t.id)
      .map((c) => ({ week: c.week, weekday: c.weekday, done: c.done === 1 })),
  }));
}

interface RecoveryContext {
  targetUserId: number;
  cycle: CycleRow;
  access: AccessLevel;
}

/** Resolves and authorizes a `/:userId` request against the target user's currently *active*
 *  cycle (mirrors dashboard.ts's own `/:userId` pattern) — an archived cycle is therefore
 *  never reachable through this router at all, which is what makes every plan tied to it
 *  permanently immutable once the cycle is archived: there is simply no code path left that
 *  can look it up for mutation afterwards. */
function loadContext(
  req: Request,
  res: Response,
  db: Database.Database,
  options: { requireOwner?: boolean } = {}
): RecoveryContext | null {
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'מזהה משתמש לא תקין' });
    return null;
  }
  const access = resolveAccess(db, req.user!.id, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: 'אין הרשאה לצפות בתוכנית החילוץ' });
    return null;
  }
  if (options.requireOwner && access !== 'owner') {
    res.status(403).json({ error: 'רק בעל/ת הלוח יכול/ה לערוך את תוכנית החילוץ' });
    return null;
  }
  const cycle = getActiveCycle(db, targetUserId);
  if (!cycle) {
    res.status(400).json({ error: 'אין מחזור פעיל' });
    return null;
  }
  return { targetUserId, cycle, access };
}

const maneuverSchema = z.object({
  note: z.string().trim().min(1, 'יש להזין תיאור קונקרטי של מהלך החילוץ').max(2000),
});

/** A user realistically has a small handful of tactics; this is a generous upper bound that
 *  still keeps the request/validation/DB-write cost bounded against an abusive payload. */
const MAX_REDUCE_TACTICS = 100;

const reduceNextWeekSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  tactics: z
    .array(
      z.object({
        tacticId: z.number().int().positive(),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      })
    )
    .min(1, 'יש לכלול לפחות טקטיקה אחת')
    .max(MAX_REDUCE_TACTICS, `ניתן לכלול עד ${MAX_REDUCE_TACTICS} טקטיקות בבקשה אחת`)
    // Rejected here, before any before/after math ever runs: a duplicate tacticId would
    // otherwise let an attacker double-count that tactic's "before" baseline (inflating
    // totalBefore) while a later duplicate entry silently overwrites which "after" selection
    // actually gets persisted — letting a submission that looks like a reduction on paper
    // (totalAfter < inflated totalBefore) actually *increase* that tactic's real schedule.
    .refine((tactics) => new Set(tactics.map((t) => t.tacticId)).size === tactics.length, {
      message: 'כל טקטיקה יכולה להופיע פעם אחת בלבד בבקשה אחת',
    }),
});

/** GET /:userId — risk assessment + any existing plan for the target user's active-cycle
 *  current week. Read access for both owner and (read-only) accepted partner; a missing
 *  active cycle degrades gracefully to nulls (mirrors dashboard.ts), never a 404/500 — the
 *  Home card simply has nothing to show. */
executionRecoveryRouter.get('/:userId', (req, res) => {
  const db = getDb();
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'מזהה משתמש לא תקין' });
    return;
  }
  const access = resolveAccess(db, req.user!.id, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: 'אין הרשאה לצפות בתוכנית החילוץ' });
    return;
  }
  const cycle = getActiveCycle(db, targetUserId);
  if (!cycle) {
    res.json({ access, cycle: null, risk: null, plan: null });
    return;
  }
  const tactics = buildTacticsWithCompletions(db, cycle.id);
  const risk: ExecutionRiskAssessment = assessExecutionRisk(tactics, cycle.current_week, new Date());
  const planRow = findPlan(db, cycle.id, cycle.current_week);
  res.json({
    access,
    cycle: { id: cycle.id, week: cycle.current_week },
    risk,
    plan: planRow ? serializePlan(planRow) : null,
  });
});

/** PUT /:userId — owner-only create/update of a 'maneuver' plan for the current week. A
 *  'reduce_next_week' plan is never created/edited here — see POST /reduce-next-week, which
 *  is the only path that can also touch tactic_week_overrides. If a 'reduce_next_week' plan
 *  already exists for this week (any status), this is rejected outright — it must never be
 *  silently converted into, or overwritten by, a maneuver. Editing an already-*resolved*
 *  maneuver requires reopening it first, matching the weekly-planning-ritual completion-lock
 *  pattern used elsewhere in this app. */
executionRecoveryRouter.put('/:userId', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true });
  if (!ctx) return;

  const parsed = maneuverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }

  const existing = findPlan(db, ctx.cycle.id, ctx.cycle.current_week);
  if (existing && existing.strategy === 'reduce_next_week') {
    res.status(400).json({
      error: 'לשבוע זה כבר קיימת תוכנית צמצום השבוע הבא — לא ניתן להמיר אותה או לדרוס אותה במהלך חילוץ',
    });
    return;
  }
  if (existing && existing.status === 'resolved') {
    res.status(400).json({ error: 'יש לפתוח מחדש את התוכנית לפני עריכתה' });
    return;
  }

  // adjustment_json/resolved_at are explicitly forced back to NULL on every write here (not
  // just left at their INSERT defaults) — a maneuver plan must never carry a stale
  // reduce-next-week adjustment snapshot or a leftover resolved timestamp, even defensively.
  db.prepare(
    `INSERT INTO execution_recovery_plans (cycle_id, week, strategy, note, status, adjustment_json, resolved_at)
     VALUES (?, ?, 'maneuver', ?, 'active', NULL, NULL)
     ON CONFLICT(cycle_id, week) DO UPDATE SET
       strategy = 'maneuver',
       note = excluded.note,
       adjustment_json = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(ctx.cycle.id, ctx.cycle.current_week, parsed.data.note.trim());

  const row = findPlan(db, ctx.cycle.id, ctx.cycle.current_week)!;
  res.json({ access: 'owner', plan: serializePlan(row) });
});

/**
 * POST /:userId/reduce-next-week — owner-only. The only real, explicit workload-adjustment
 * path: the client must submit every tactic effectively scheduled next week (target =
 * current_week + 1) together with its chosen weekday set for that one week (an empty array
 * removes the tactic entirely for that week). Requires the total scheduled-occurrence count
 * to strictly decrease and at least one to remain overall. Rejects outright if *any* plan
 * already exists for this cycle/week (any strategy/status) — this is a one-shot action, never
 * a silent overwrite/rebaseline of an existing plan (maneuver or a prior reduction). On
 * success, upserts tactic_week_overrides for next week only (never the base tactic, never the
 * current week, never any other week) and records the plan — already 'resolved', since
 * applying the reduction *is* the complete action — with a JSON before/after snapshot, all in
 * one transaction.
 */
executionRecoveryRouter.post('/:userId/reduce-next-week', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true });
  if (!ctx) return;

  if (ctx.cycle.current_week >= 12) {
    res.status(400).json({
      error: 'המחזור בשבוע 12, השבוע האחרון — אין שבוע הבא לצמצם. ניתן ליצור מהלך חילוץ לשבוע הנוכחי בלבד',
    });
    return;
  }
  const targetWeek = ctx.cycle.current_week + 1;

  const existingPlan = findPlan(db, ctx.cycle.id, ctx.cycle.current_week);
  if (existingPlan) {
    res.status(409).json({
      error: 'לשבוע זה כבר קיימת תוכנית חילוץ — לא ניתן ליצור צמצום שבוע הבא נוסף או לדרוס תוכנית קיימת בשקט',
    });
    return;
  }

  const parsed = reduceNextWeekSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }

  const goals = getGoalsForCycle(db, ctx.cycle.id);
  const tactics = getTacticsForGoals(db, goals.map((g) => g.id));
  const effectiveNextWeekTactics = tactics.filter((t) => targetWeek >= t.start_week && targetWeek <= t.end_week);
  const overrides = getTacticOverrides(db, effectiveNextWeekTactics.map((t) => t.id));

  const effectiveFor = (tacticId: number): { title: string; weekdays: number[] } => {
    const tactic = effectiveNextWeekTactics.find((t) => t.id === tacticId)!;
    const override = overrides.find((o) => o.tactic_id === tacticId && o.week === targetWeek);
    return override
      ? { title: override.title, weekdays: JSON.parse(override.weekdays) as number[] }
      : { title: tactic.title, weekdays: JSON.parse(tactic.weekdays) as number[] };
  };

  // Built as a Map keyed by tacticId — the schema above already rejects duplicate tacticId
  // entries outright, but computing from a de-duplicated map (rather than a raw array loop)
  // is a second, structural line of defense: it is simply impossible for the same tactic to
  // be counted twice in totalBefore/totalAfter, however this map is populated.
  const submittedByTacticId = new Map(parsed.data.tactics.map((t) => [t.tacticId, t.weekdays] as const));

  const expectedIds = new Set(effectiveNextWeekTactics.map((t) => t.id));
  const missingOrExtra =
    submittedByTacticId.size !== expectedIds.size || [...expectedIds].some((id) => !submittedByTacticId.has(id));
  if (missingOrExtra) {
    res.status(400).json({ error: 'יש לכלול בבחירה את כל הטקטיקות המתוכננות לשבוע הבא, ורק אותן' });
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  const beforeSnapshot: { tacticId: number; weekdays: number[] }[] = [];
  const afterSnapshot: { tacticId: number; weekdays: number[] }[] = [];
  const normalizedByTacticId = new Map<number, number[]>();
  for (const [tacticId, weekdays] of submittedByTacticId) {
    const before = effectiveFor(tacticId).weekdays;
    const after = [...new Set(weekdays)].sort((a, b) => a - b);
    normalizedByTacticId.set(tacticId, after);
    totalBefore += before.length;
    totalAfter += after.length;
    beforeSnapshot.push({ tacticId, weekdays: before });
    afterSnapshot.push({ tacticId, weekdays: after });
  }

  if (totalAfter >= totalBefore) {
    res.status(400).json({
      error: 'סך הפעולות המתוכננות לשבוע הבא חייב לרדת לעומת המצב הנוכחי כדי שהצמצום יהיה משמעותי',
    });
    return;
  }
  if (totalAfter < 1) {
    res.status(400).json({ error: 'חייבת להישאר לפחות פעולה מתוכננת אחת לשבוע הבא' });
    return;
  }

  const note = parsed.data.note?.trim() ?? '';
  const nowIso = new Date().toISOString();
  const adjustment = { targetWeek, before: beforeSnapshot, after: afterSnapshot };

  const upsertOverride = db.prepare(
    `INSERT INTO tactic_week_overrides (tactic_id, week, title, weekdays)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tactic_id, week) DO UPDATE SET
       weekdays = excluded.weekdays,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  );
  db.transaction(() => {
    for (const [tacticId, after] of normalizedByTacticId) {
      const title = effectiveFor(tacticId).title;
      upsertOverride.run(tacticId, targetWeek, title, JSON.stringify(after));
    }
    // A plain INSERT (never ON CONFLICT DO UPDATE) — the existing-plan check above already
    // guarantees no row exists yet for this cycle/week, so this can never silently overwrite
    // anything; if it somehow did collide, failing loudly (constraint violation, caught by
    // the route's centralized error handler) is correct instead of masking a real bug.
    db.prepare(
      `INSERT INTO execution_recovery_plans (cycle_id, week, strategy, note, status, adjustment_json, resolved_at)
       VALUES (?, ?, 'reduce_next_week', ?, 'resolved', ?, ?)`
    ).run(ctx.cycle.id, ctx.cycle.current_week, note, JSON.stringify(adjustment), nowIso);
  })();

  const row = findPlan(db, ctx.cycle.id, ctx.cycle.current_week)!;
  res.json({ access: 'owner', plan: serializePlan(row) });
});

/** POST /:userId/resolve — owner-only. Marks the current week's plan resolved. Never
 *  triggered automatically just because live metrics later improve — always an explicit
 *  owner action. */
executionRecoveryRouter.post('/:userId/resolve', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true });
  if (!ctx) return;

  const existing = findPlan(db, ctx.cycle.id, ctx.cycle.current_week);
  if (!existing) {
    res.status(404).json({ error: 'לא נמצאה תוכנית חילוץ לשבוע הנוכחי' });
    return;
  }
  if (existing.status === 'resolved') {
    res.status(409).json({ error: 'התוכנית כבר סומנה כפתורה' });
    return;
  }
  db.prepare(
    `UPDATE execution_recovery_plans
     SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(existing.id);
  const row = findPlan(db, ctx.cycle.id, ctx.cycle.current_week)!;
  res.json({ access: 'owner', plan: serializePlan(row) });
});

/** POST /:userId/reopen — owner-only, maneuver only. A 'reduce_next_week' plan is a completed,
 *  one-way action: its tactic_week_overrides are never undone on reopen, so reopening it would
 *  be meaningless (or misleading — implying the schedule change could be walked back when it
 *  can't). Puts a resolved *maneuver* back into 'active' status; every previously saved field
 *  (note) is preserved as-is. */
executionRecoveryRouter.post('/:userId/reopen', (req, res) => {
  const db = getDb();
  const ctx = loadContext(req, res, db, { requireOwner: true });
  if (!ctx) return;

  const existing = findPlan(db, ctx.cycle.id, ctx.cycle.current_week);
  if (!existing) {
    res.status(404).json({ error: 'לא נמצאה תוכנית חילוץ לשבוע הנוכחי' });
    return;
  }
  if (existing.strategy === 'reduce_next_week') {
    res.status(400).json({
      error: 'לא ניתן לפתוח מחדש תוכנית צמצום השבוע הבא — הצמצום כבר בוצע בפועל ואינו הפיך',
    });
    return;
  }
  if (existing.status === 'active') {
    res.status(409).json({ error: 'התוכנית כבר פעילה' });
    return;
  }
  db.prepare(
    `UPDATE execution_recovery_plans
     SET status = 'active', resolved_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(existing.id);
  const row = findPlan(db, ctx.cycle.id, ctx.cycle.current_week)!;
  res.json({ access: 'owner', plan: serializePlan(row) });
});
