const TIMEZONE = 'Asia/Jerusalem';

/**
 * Returns the ISO-8601 week identifier (e.g. "2026-W36") for "today" as observed in
 * Asia/Jerusalem, regardless of the host server's own local timezone. This is what the
 * weekly WAM reminder CLI uses as its idempotency key, so it must be stable no matter what
 * timezone the systemd timer's host machine is configured with.
 */
export function currentIsoWeek(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
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
