import type Database from 'better-sqlite3';
import { GOAL_COLORS, type GoalColor } from './validation.js';

export interface CycleRow {
  id: number;
  user_id: number;
  name: string;
  current_week: number;
  is_active: number;
  vision: string;
  success_definition: string;
  why_it_matters: string;
  blockers: string;
  risks: string;
  lag_measures: string;
  lead_measures: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface GoalRow {
  id: number;
  cycle_id: number;
  title: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TacticRow {
  id: number;
  goal_id: number;
  title: string;
  weekdays: string; // JSON
  start_week: number;
  end_week: number;
  created_at: string;
  updated_at: string;
}

export interface TacticWeekOverrideRow {
  id: number;
  tactic_id: number;
  week: number;
  title: string;
  weekdays: string;
  created_at: string;
  updated_at: string;
}

export interface CompletionRow {
  id: number;
  tactic_id: number;
  week: number;
  weekday: number;
  done: number;
  updated_at: string;
}

export function getActiveCycle(db: Database.Database, userId: number): CycleRow | undefined {
  return db
    .prepare('SELECT * FROM cycles WHERE user_id = ? AND is_active = 1')
    .get(userId) as CycleRow | undefined;
}

export function getGoalsForCycle(db: Database.Database, cycleId: number): GoalRow[] {
  return db
    .prepare('SELECT * FROM goals WHERE cycle_id = ? ORDER BY sort_order ASC, id ASC')
    .all(cycleId) as GoalRow[];
}

export function getTacticsForGoals(db: Database.Database, goalIds: number[]): TacticRow[] {
  if (goalIds.length === 0) return [];
  const placeholders = goalIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM tactics WHERE goal_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...goalIds) as TacticRow[];
}

export function getTacticOverrides(
  db: Database.Database,
  tacticIds: number[]
): TacticWeekOverrideRow[] {
  if (tacticIds.length === 0) return [];
  const placeholders = tacticIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM tactic_week_overrides
       WHERE tactic_id IN (${placeholders})
       ORDER BY tactic_id ASC, week ASC`
    )
    .all(...tacticIds) as TacticWeekOverrideRow[];
}

export function getCompletionsForTactics(db: Database.Database, tacticIds: number[]): CompletionRow[] {
  if (tacticIds.length === 0) return [];
  const placeholders = tacticIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM completions WHERE tactic_id IN (${placeholders})`)
    .all(...tacticIds) as CompletionRow[];
}

/** Picks the next stable color for a new goal, preferring colors not already used in the cycle. */
export function nextGoalColor(db: Database.Database, cycleId: number): GoalColor {
  const used = new Set(
    (db.prepare('SELECT color FROM goals WHERE cycle_id = ?').all(cycleId) as { color: string }[]).map(
      (r) => r.color
    )
  );
  const free = GOAL_COLORS.find((c) => !used.has(c));
  return free ?? GOAL_COLORS[used.size % GOAL_COLORS.length];
}

export function goalBelongsToUser(
  db: Database.Database,
  goalId: number,
  userId: number
): (GoalRow & { cycle_is_active: number }) | undefined {
  return db
    .prepare(
      `SELECT g.*, c.is_active as cycle_is_active FROM goals g
       JOIN cycles c ON c.id = g.cycle_id WHERE g.id = ? AND c.user_id = ?`
    )
    .get(goalId, userId) as (GoalRow & { cycle_is_active: number }) | undefined;
}

export function tacticBelongsToUser(
  db: Database.Database,
  tacticId: number,
  userId: number
): (TacticRow & { cycle_is_active: number; cycle_current_week: number }) | undefined {
  return db
    .prepare(
      `SELECT t.*, c.is_active as cycle_is_active, c.current_week as cycle_current_week FROM tactics t
       JOIN goals g ON g.id = t.goal_id
       JOIN cycles c ON c.id = g.cycle_id
       WHERE t.id = ? AND c.user_id = ?`
    )
    .get(tacticId, userId) as
    | (TacticRow & { cycle_is_active: number; cycle_current_week: number })
    | undefined;
}

/** All cycles (active and archived) owned by a user, most recent first — for history browsing. */
export function getAllCyclesForUser(db: Database.Database, userId: number): CycleRow[] {
  return db
    .prepare('SELECT * FROM cycles WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(userId) as CycleRow[];
}

export function getCycleById(db: Database.Database, cycleId: number): CycleRow | undefined {
  return db.prepare('SELECT * FROM cycles WHERE id = ?').get(cycleId) as CycleRow | undefined;
}
