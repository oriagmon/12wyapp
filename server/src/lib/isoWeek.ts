const TIMEZONE = 'Asia/Jerusalem';

/**
 * Returns the ISO-8601 week identifier (e.g. "2026-W36") that `instant` falls in as observed
 * in Asia/Jerusalem, regardless of the host server's own local timezone.
 *
 * Used both for "which week is it now" (the weekly WAM reminder's idempotency key) and for
 * "which week is this scheduled meeting in", so that a stored UTC timestamp and the current
 * week are always bucketed by the same calendar.
 *
 * Returns `null` for an invalid date rather than a bogus week, so callers can treat unusable
 * stored timestamps as "no information" instead of silently matching the wrong week.
 */
export function isoWeekOf(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  const day = Number(parts.find((p) => p.type === 'day')!.value);

  // Standard ISO-8601 week algorithm, anchored to a UTC-midnight date built from the
  // Jerusalem calendar date above (time-of-day and host timezone no longer matter past
  // this point — only the calendar date does).
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday determines the ISO year
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The ISO-8601 week identifier for "today" in Asia/Jerusalem. This is the weekly WAM
 * reminder CLI's idempotency key, so it must be stable no matter what timezone the systemd
 * timer's host machine is configured with.
 */
export function currentIsoWeek(now: Date = new Date()): string {
  // `now` is a real instant here, so the week is never null.
  return isoWeekOf(now)!;
}
