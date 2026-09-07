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
  score: number | null;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface ExecutionHeatmapResponse {
  access: 'owner' | 'partner';
  cycle: { id: number; name: string; currentWeek: number; isActive: boolean } | null;
  today: string;
  startDate: string | null;
  endDate: string | null;
  dateBasis: 'current-week-anchor' | 'archive-week-anchor' | null;
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
