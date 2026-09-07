import { useMemo } from 'react';
import { useTranslation } from '../i18n';
import type { Translator } from '../i18n/translate';

/**
 * Timestamps stay anchored to Israel time regardless of interface language: both users of a
 * board share one week boundary, and "which day did this land on" has to mean the same thing
 * for both of them no matter which language they read.
 */
const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

export type DateFormatters = {
  /** Full timestamp — shown on hover and to assistive tech, so the exact moment is never lost. */
  formatAbsolute: (iso: string) => string;
  formatRelative: (iso: string, now?: Date) => string;
  formatUpcoming: (iso: string, now?: Date) => string;
};

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ISRAEL_TIME_ZONE });

function israelDayNumber(date: Date): number {
  const [year, month, day] = dayFormatter.format(date).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Builds date formatters bound to a language.
 *
 * The thresholds assume this app is opened roughly twice a week, not daily: "3 minutes ago"
 * is only ever true while you are still looking at the thing you just did, whereas the useful
 * question a few days later is which *day* it happened on. So minutes decay into "today at
 * HH:mm", then "yesterday", then a day count for the rest of the week, and after that an
 * ordinary date — because "11 days ago" is harder to place than "26 Aug".
 */
export function createDateFormatters(tag: string, t: Translator): DateFormatters {
  const absoluteFormatter = new Intl.DateTimeFormat(tag, {
    timeZone: ISRAEL_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat(tag, {
    timeZone: ISRAEL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  const dayMonthFormatter = new Intl.DateTimeFormat(tag, {
    timeZone: ISRAEL_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  });

  const formatAbsolute = (iso: string) => absoluteFormatter.format(new Date(iso));

  function formatUpcoming(iso: string, now: Date = new Date()): string {
    const then = new Date(iso);
    const diffMs = then.getTime() - now.getTime();
    if (!Number.isFinite(diffMs)) return '';
    if (diffMs <= 0) return formatRelative(iso, now);

    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return t('common.time.anyMoment');
    if (minutes < 60) return t('common.time.inMinutes', { count: minutes });

    const dayDelta = israelDayNumber(then) - israelDayNumber(now);
    if (dayDelta === 0) return t('common.time.today', { time: timeFormatter.format(then) });
    if (dayDelta === 1) return t('common.time.tomorrow', { time: timeFormatter.format(then) });
    if (dayDelta < 7)
      return t('common.time.inDays', { count: dayDelta, time: timeFormatter.format(then) });
    return absoluteFormatter.format(then);
  }

  function formatRelative(iso: string, now: Date = new Date()): string {
    const then = new Date(iso);
    const timestamp = then.getTime();
    if (!Number.isFinite(timestamp)) return '';

    const diffMs = now.getTime() - timestamp;
    if (diffMs < 0) return formatUpcoming(iso, now);

    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return t('common.time.justNow');
    if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });

    const dayDelta = israelDayNumber(now) - israelDayNumber(then);
    if (dayDelta === 0) return t('common.time.today', { time: timeFormatter.format(then) });
    if (dayDelta === 1) return t('common.time.yesterday', { time: timeFormatter.format(then) });
    if (dayDelta < 7) return t('common.time.daysAgo', { count: dayDelta });
    if (now.getFullYear() === then.getFullYear()) return dayMonthFormatter.format(then);
    return absoluteFormatter.format(then);
  }

  return { formatAbsolute, formatRelative, formatUpcoming };
}

export function useDateFormat(): DateFormatters {
  const { t, tag } = useTranslation();
  return useMemo(() => createDateFormatters(tag, t), [tag, t]);
}
