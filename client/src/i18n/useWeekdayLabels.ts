import { useMemo } from 'react';
import { useTranslation } from './LocaleProvider';

const INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

export type WeekdayLabels = {
  /** Compact labels for grid column headers. */
  short: string[];
  /** Full day names, for accessible names and prose. */
  full: string[];
};

/**
 * Weekday names live in the shared dictionary rather than in `lib/scoring`, because every
 * feature that renders a week (the grid, tactic forms, evidence, the meeting) needs the same
 * seven strings and none of them should own the list.
 *
 * Index 0 is Sunday, matching both `Date#getDay()` and the schema's weekday convention.
 */
export function useWeekdayLabels(): WeekdayLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      short: INDEXES.map((i) => t(`common.weekday.short.${i}`)),
      full: INDEXES.map((i) => t(`common.weekday.full.${i}`)),
    }),
    [t]
  );
}
