import type Database from 'better-sqlite3';
import {
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
  type CycleRow,
} from './repo.js';
import { computeWeekScores, averageScore, type TacticWithCompletions } from './scoring.js';
import { getEvidenceKeysForTactics } from './tacticEvidence.js';

export interface CycleBundle {
  cycle: {
    id: number;
    name: string;
    currentWeek: number;
    isActive: boolean;
    vision: string;
    successDefinition: string;
    whyItMatters: string;
    blockers: string;
    risks: string;
    lagMeasures: string;
    leadMeasures: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
  };
  goals: {
    id: number;
    title: string;
    color: string;
    tactics: {
      id: number;
      title: string;
      weekdays: number[];
      startWeek: number;
      endWeek: number;
      completions: { week: number; weekday: number; done: boolean; hasEvidence?: boolean }[];
      evidenceWeeks: number[];
      overrides: { week: number; title: string; weekdays: number[] }[];
    }[];
  }[];
  weekScores: ReturnType<typeof computeWeekScores>;
  averageScore: number | null;
}

type BundledTactic = Omit<TacticWithCompletions, 'overrides'> & {
  goalId: number;
  title: string;
  overrides: { week: number; title: string; weekdays: number[] }[];
};

/** Builds the full read model (goals/tactics/completions + derived scores) for any single
 *  cycle — active or archived. Used by both the live dashboard and cycle-history browsing,
 *  so both surfaces render historical (immutable) cycles identically to the current one. */
export function buildCycleBundle(db: Database.Database, cycle: CycleRow): CycleBundle {
  const goalRows = getGoalsForCycle(db, cycle.id);
  const tacticRows = getTacticsForGoals(db, goalRows.map((g) => g.id));
  const tacticIds = tacticRows.map((t) => t.id);
  const completionRows = getCompletionsForTactics(db, tacticIds);
  const overrideRows = getTacticOverrides(db, tacticIds);
  const evidenceKeys = getEvidenceKeysForTactics(db, tacticIds);
  const evidenceWeeks = new Map<number, Set<number>>();
  for (const key of evidenceKeys) {
    const [tacticId, week] = key.split(':').map(Number);
    if (!evidenceWeeks.has(tacticId)) evidenceWeeks.set(tacticId, new Set());
    evidenceWeeks.get(tacticId)!.add(week);
  }

  const tacticsWithCompletions: BundledTactic[] = tacticRows.map(
    (t) => ({
      id: t.id,
      goalId: t.goal_id,
      title: t.title,
      weekdays: JSON.parse(t.weekdays) as number[],
      startWeek: t.start_week,
      endWeek: t.end_week,
      overrides: overrideRows
        .filter((override) => override.tactic_id === t.id)
        .map((override) => ({
          week: override.week,
          title: override.title,
          weekdays: JSON.parse(override.weekdays) as number[],
        })),
      completions: completionRows
        .filter((c) => c.tactic_id === t.id)
        .map((c) => ({
          week: c.week,
          weekday: c.weekday,
          done: c.done === 1,
          hasEvidence: evidenceKeys.has(`${t.id}:${c.week}:${c.weekday}`),
        })),
    })
  );

  const weekScores = computeWeekScores(tacticsWithCompletions);
  const avg = averageScore(weekScores);

  const goals = goalRows.map((g) => ({
    id: g.id,
    title: g.title,
    color: g.color,
    tactics: tacticsWithCompletions
      .filter((t) => t.goalId === g.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        weekdays: t.weekdays,
        startWeek: t.startWeek,
        endWeek: t.endWeek,
        overrides: t.overrides,
        completions: t.completions,
        evidenceWeeks: [...(evidenceWeeks.get(t.id) ?? [])].sort((a, b) => a - b),
      })),
  }));

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      currentWeek: cycle.current_week,
      isActive: cycle.is_active === 1,
      vision: cycle.vision,
      successDefinition: cycle.success_definition,
      whyItMatters: cycle.why_it_matters,
      blockers: cycle.blockers,
      risks: cycle.risks,
      lagMeasures: cycle.lag_measures,
      leadMeasures: cycle.lead_measures,
      notes: cycle.notes,
      createdAt: cycle.created_at,
      updatedAt: cycle.updated_at,
    },
    goals,
    weekScores,
    averageScore: avg,
  };
}
