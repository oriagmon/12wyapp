import type Database from 'better-sqlite3';
import { formatIsraelWallTime } from './israelTime.js';
import {
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
  type CycleRow,
} from './repo.js';
import { isScheduled, TARGET_SCORE, TOTAL_WEEKS, type TacticWithCompletions } from './scoring.js';

export type HeatmapDayState = 'unscheduled' | 'future' | 'pending' | 'failed' | 'partial' | 'success' | 'not-reached';
export type HeatmapDayPhase = 'past' | 'today' | 'future' | 'outside-cycle';

export interface HeatmapDay {
  week: number;
  weekday: number;
  date: string;
  phase: HeatmapDayPhase;
  state: HeatmapDayState;
  scheduled: number;
  completed: number;
  /** Whole percent, rounded DOWN so a sub-85% day never displays a misleading 85%. */
  score: number | null;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapSummary {
  currentStreak: number;
  bestStreak: number;
  successfulDays: number;
  completedOccurrences: number;
  scheduledOccurrences: number;
  strongestWeekday: { weekday: number; completed: number; scheduled: number; score: number; days: number } | null;
}

export interface ExecutionHeatmapData {
  cycle: { id: number; name: string; currentWeek: number; isActive: boolean };
  today: string;
  startDate: string;
  endDate: string;
  dateBasis: 'current-week-anchor' | 'archive-week-anchor';
  targetScore: number;
  days: HeatmapDay[];
  summary: HeatmapSummary;
}

type HeatmapCycle = Pick<CycleRow, 'id' | 'name' | 'current_week' | 'is_active' | 'updated_at'>;
const DAY_MS = 86_400_000;

export function emptyHeatmapSummary(): HeatmapSummary {
  return {
    currentStreak: 0,
    bestStreak: 0,
    successfulDays: 0,
    completedOccurrences: 0,
    scheduledOccurrences: 0,
    strongestWeekday: null,
  };
}

/**
 * Cycles have a manually selected current_week, NOT a stored calendar start date.
 * Match recovery's Israel-weekday/currentWeek semantics: put currentWeek in the current
 * Israel calendar week (or the archive's final updated_at week), and label these dates as
 * estimates in the UI. Never mistake creation/completion timestamps for occurrence dates.
 * UTC arithmetic below is on calendar labels only, so DST cannot skip or repeat a cell.
 */
export function computeExecutionHeatmap(
  cycle: HeatmapCycle,
  tactics: TacticWithCompletions[],
  now: Date = new Date()
): ExecutionHeatmapData {
  const active = cycle.is_active === 1;
  const today = formatIsraelWallTime(now).slice(0, 10);
  const anchor = active ? today : formatIsraelWallTime(new Date(cycle.updated_at)).slice(0, 10);
  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const anchorWeekday = anchorDate.getUTCDay();
  const startMs = anchorDate.getTime() - (anchorWeekday + (cycle.current_week - 1) * 7) * DAY_MS;
  const completions = new Map(tactics.map((tactic) => [
    tactic.id,
    new Set(tactic.completions.filter((c) => c.done).map((c) => `${c.week}:${c.weekday}`)),
  ]));
  const days: HeatmapDay[] = [];

  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = new Date(startMs + ((week - 1) * 7 + weekday) * DAY_MS).toISOString().slice(0, 10);
      const phase: HeatmapDayPhase = !active
        ? (week <= cycle.current_week ? 'past' : 'outside-cycle')
        : (date < today ? 'past' : date === today ? 'today' : 'future');
      let scheduled = 0;
      let completed = 0;
      for (const tactic of tactics) {
        if (!isScheduled(tactic, week, weekday)) continue;
        scheduled++;
        if (completions.get(tactic.id)!.has(`${week}:${weekday}`)) completed++;
      }
      const success = scheduled > 0 && completed * 100 >= TARGET_SCORE * scheduled;
      const state: HeatmapDayState = phase === 'outside-cycle' ? 'not-reached'
        : scheduled === 0 ? 'unscheduled'
          : phase === 'future' ? 'future'
            : success ? 'success'
              : completed > 0 ? 'partial'
                : phase === 'today' ? 'pending' : 'failed';
      const intensity: HeatmapDay['intensity'] = phase === 'future' || phase === 'outside-cycle' || completed === 0
        ? 0 : success ? 4 : completed * 100 < 25 * scheduled ? 1 : completed * 100 < 50 * scheduled ? 2 : 3;
      days.push({
        week, weekday, date, phase, state, scheduled, completed,
        score: scheduled === 0 ? null : Math.floor(completed * 100 / scheduled),
        intensity,
      });
    }
  }

  const summary = emptyHeatmapSummary();
  const weekdayTotals = Array.from({ length: 7 }, (_, weekday) => ({ weekday, completed: 0, scheduled: 0, days: 0 }));
  for (const day of days) {
    if (day.phase === 'future' || day.phase === 'outside-cycle') continue;
    summary.completedOccurrences += day.completed;
    summary.scheduledOccurrences += day.scheduled;
    if (day.scheduled === 0) continue;
    if (day.state === 'success') {
      summary.currentStreak++;
      summary.successfulDays++;
      summary.bestStreak = Math.max(summary.bestStreak, summary.currentStreak);
    } else if (day.phase === 'past') {
      summary.currentStreak = 0;
    }
    // Rest days are neutral; an unfinished today gets until Israel midnight before it
    // can break yesterday's streak. Only finalized days participate in the weekday insight.
    if (day.phase === 'past') {
      const total = weekdayTotals[day.weekday];
      total.completed += day.completed;
      total.scheduled += day.scheduled;
      total.days++;
    }
  }
  const strongest = weekdayTotals.filter((day) => day.completed > 0).sort((a, b) =>
    b.completed * a.scheduled - a.completed * b.scheduled
      || b.completed - a.completed
      || a.weekday - b.weekday
  )[0];
  if (strongest) {
    summary.strongestWeekday = { ...strongest, score: Math.floor(strongest.completed * 100 / strongest.scheduled) };
  }

  return {
    cycle: { id: cycle.id, name: cycle.name, currentWeek: cycle.current_week, isActive: active },
    today,
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    dateBasis: active ? 'current-week-anchor' : 'archive-week-anchor',
    targetScore: TARGET_SCORE,
    days,
    summary,
  };
}

/** Derived, compact read model; no titles, evidence, or raw completion records leave this API. */
export function buildExecutionHeatmap(db: Database.Database, cycle: CycleRow, now: Date = new Date()): ExecutionHeatmapData {
  const goals = getGoalsForCycle(db, cycle.id);
  const rows = getTacticsForGoals(db, goals.map((goal) => goal.id));
  const ids = rows.map((tactic) => tactic.id);
  const overrides = getTacticOverrides(db, ids);
  const completions = getCompletionsForTactics(db, ids);
  const tactics: TacticWithCompletions[] = rows.map((tactic) => ({
    id: tactic.id,
    weekdays: JSON.parse(tactic.weekdays) as number[],
    startWeek: tactic.start_week,
    endWeek: tactic.end_week,
    overrides: overrides.filter((o) => o.tactic_id === tactic.id).map((o) => ({
      week: o.week, weekdays: JSON.parse(o.weekdays) as number[],
    })),
    completions: completions.filter((c) => c.tactic_id === tactic.id).map((c) => ({
      week: c.week, weekday: c.weekday, done: c.done === 1,
    })),
  }));
  return computeExecutionHeatmap(cycle, tactics, now);
}
