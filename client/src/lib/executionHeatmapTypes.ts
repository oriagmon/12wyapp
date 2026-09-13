export type HeatmapDayState = 'unscheduled' | 'future' | 'pending' | 'failed' | 'partial' | 'success' | 'not-reached';
export type HeatmapDayPhase = 'past' | 'today' | 'future' | 'outside-cycle';
/** `cycle-start-anchor` dates are exact (read from the cycle's stored start date); the other
 *  two are estimates reconstructed from the week number, for cycles with no stored start. */
export type HeatmapDateBasis = 'cycle-start-anchor' | 'current-week-anchor' | 'archive-week-anchor';

export interface HeatmapDay {
  week: number;
  weekday: number;
  date: string;
  phase: HeatmapDayPhase;
  state: HeatmapDayState;
  scheduled: number;
  completed: number;
  score: number | null;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface ExecutionHeatmapResponse {
  access: 'owner' | 'partner';
  cycle: { id: number; name: string; currentWeek: number; isActive: boolean } | null;
  today: string;
  startDate: string | null;
  endDate: string | null;
  dateBasis: HeatmapDateBasis | null;
  targetScore: number;
  days: HeatmapDay[];
  summary: {
    currentStreak: number;
    bestStreak: number;
    successfulDays: number;
    completedOccurrences: number;
    scheduledOccurrences: number;
    strongestWeekday: { weekday: number; completed: number; scheduled: number; score: number; days: number } | null;
  };
}
