import type { Tactic } from './types';

export const TARGET_SCORE = 85;
export const TOTAL_WEEKS = 12;

export function remainingToTarget(score: number | null): number {
  if (score === null) return TARGET_SCORE;
  return Math.max(0, TARGET_SCORE - score);
}

export function isGoldWeek(score: number | null): boolean {
  return score !== null && score >= TARGET_SCORE;
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${score}%`;
}

export const WEEKDAY_LABELS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WEEKDAY_LABELS_FULL_HE = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
];

/** JS Date#getDay() already returns 0=Sunday..6=Saturday, matching our schema's weekday convention. */
export function todayWeekday(): number {
  return new Date().getDay();
}

export function effectiveTacticForWeek(
  tactic: Pick<Tactic, 'title' | 'weekdays' | 'overrides'>,
  week: number
): { title: string; weekdays: number[] } {
  const override = tactic.overrides?.find((item) => item.week === week);
  return override
    ? { title: override.title, weekdays: override.weekdays }
    : { title: tactic.title, weekdays: tactic.weekdays };
}
