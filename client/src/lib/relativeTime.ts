const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

const absoluteFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const dayMonthFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: ISRAEL_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ISRAEL_TIME_ZONE });

/** Full Israel-time timestamp — still the value shown on hover and to assistive tech, so
 *  nothing below ever loses the exact moment, only the need to read it. */
export function formatAbsolute(iso: string): string {
  return absoluteFormatter.format(new Date(iso));
}

function israelDayNumber(date: Date): number {
  const [year, month, day] = dayFormatter.format(date).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * A relative label for something that happened in the past.
 *
 * The thresholds assume this app is opened roughly twice a week, not daily: "לפני 3 דקות" is
 * only ever true while you are still looking at the thing you just did, whereas the useful
 * question a few days later is which *day* it happened on. So minutes decay into "today at
 * HH:mm", then "yesterday", then a day count for the rest of the week, and after that an
 * ordinary date — because "לפני 11 ימים" is harder to place than "26 באוג׳".
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const timestamp = then.getTime();
  if (!Number.isFinite(timestamp)) return '';

  const diffMs = now.getTime() - timestamp;
  if (diffMs < 0) return formatUpcoming(iso, now);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'הרגע';
  if (minutes === 1) return 'לפני דקה';
  if (minutes < 60) return `לפני ${minutes} דקות`;

  const dayDelta = israelDayNumber(now) - israelDayNumber(then);
  if (dayDelta === 0) return `היום, ${timeFormatter.format(then)}`;
  if (dayDelta === 1) return `אתמול, ${timeFormatter.format(then)}`;
  if (dayDelta < 7) return `לפני ${dayDelta} ימים`;
  if (now.getFullYear() === then.getFullYear()) return dayMonthFormatter.format(then);
  return absoluteFormatter.format(then);
}

/** The mirror image, for scheduled things that have not happened yet. */
export function formatUpcoming(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = then.getTime() - now.getTime();
  if (!Number.isFinite(diffMs)) return '';
  if (diffMs <= 0) return formatRelative(iso, now);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'עוד רגע';
  if (minutes === 1) return 'בעוד דקה';
  if (minutes < 60) return `בעוד ${minutes} דקות`;

  const dayDelta = israelDayNumber(then) - israelDayNumber(now);
  if (dayDelta === 0) return `היום, ${timeFormatter.format(then)}`;
  if (dayDelta === 1) return `מחר, ${timeFormatter.format(then)}`;
  if (dayDelta < 7) return `בעוד ${dayDelta} ימים, ${timeFormatter.format(then)}`;
  return absoluteFormatter.format(then);
}
