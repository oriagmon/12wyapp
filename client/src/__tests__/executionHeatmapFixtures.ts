import type { ExecutionHeatmapResponse } from '../lib/executionHeatmapTypes';

export function heatmapFixture(): ExecutionHeatmapResponse {
  return {
    access: 'owner',
    cycle: { id: 7, name: 'מחזור בדיקה', currentWeek: 1, isActive: true },
    today: '2026-09-02',
    startDate: '2026-08-30',
    endDate: '2026-11-21',
    dateBasis: 'current-week-anchor',
    targetScore: 85,
    days: Array.from({ length: 84 }, (_, index) => ({
      week: Math.floor(index / 7) + 1,
      weekday: index % 7,
      date: new Date(Date.UTC(2026, 7, 30 + index)).toISOString().slice(0, 10),
      phase: index < 3 ? 'past' : index === 3 ? 'today' : 'future',
      state: index === 0 || index === 2 ? 'success' : index === 1 ? 'unscheduled' : index === 3 ? 'pending' : 'future',
      scheduled: index === 1 ? 0 : 1,
      completed: index === 0 || index === 2 ? 1 : 0,
      score: index === 1 ? null : index === 0 || index === 2 ? 100 : 0,
      intensity: index === 0 || index === 2 ? 4 : 0,
    })),
    summary: {
      currentStreak: 2, bestStreak: 2, successfulDays: 2,
      completedOccurrences: 2, scheduledOccurrences: 3,
      strongestWeekday: { weekday: 0, completed: 1, scheduled: 1, score: 100, days: 1 },
    },
  };
}
