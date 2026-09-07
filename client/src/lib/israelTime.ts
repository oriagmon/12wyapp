/**
 * Israel wall-clock ⇄ UTC conversions for the WAM "next meeting" scheduler, correct
 * regardless of the browser/OS timezone. Uses Intl.DateTimeFormat with a fixed
 * `Asia/Jerusalem` timeZone (so it reflects Israel's actual DST rules for any given date)
 * rather than relying on the environment's local timezone in any way.
 */

const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';
const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTimeZone(date: Date, timeZone: string): WallTimeParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Partial<WallTimeParts> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type === 'literal') continue;
    out[part.type as keyof WallTimeParts] = Number(part.value);
  }
  return out as WallTimeParts;
}

/** The UTC offset (in minutes, positive means the zone is ahead of UTC) that applies to the
 *  given instant in `timeZone` — e.g. +120 for Israel Standard Time, +180 for Israel Daylight
 *  Time. Computed by re-interpreting the zone's local wall-clock fields at that instant as if
 *  they were themselves UTC and diffing against the true instant. */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const p = partsInTimeZone(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - utcMs) / 60_000;
}

/** Formats a UTC instant as Israel local wall-clock time in `YYYY-MM-DDTHH:mm` form — the
 *  exact value a `datetime-local` input expects — independent of the browser's own timezone. */
export function formatIsraelWallTime(date: Date): string {
  const p = partsInTimeZone(date, ISRAEL_TIME_ZONE);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Converts a saved UTC ISO timestamp to the Israel-local `datetime-local` input value. */
export function utcIsoToIsraelWallTime(iso: string): string {
  return formatIsraelWallTime(new Date(iso));
}

/** Default suggested slot for a next WAM: the nearest upcoming Friday at 13:05 Israel time.
 *  Friday itself only counts while 13:05 is still ahead, so the suggestion is always a future
 *  instant (the scheduler rejects past times). Weekday is derived from the Israel calendar
 *  date, never the browser's own timezone. */
export function nearestFridayWallTime(now: Date = new Date(), hour = 13, minute = 5): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(hour)}:${pad(minute)}`;
  const p = partsInTimeZone(now, ISRAEL_TIME_ZONE);
  const FRIDAY = 5;
  const todayUtcMs = Date.UTC(p.year, p.month - 1, p.day);
  let ahead = (FRIDAY - new Date(todayUtcMs).getUTCDay() + 7) % 7;
  if (ahead === 0 && (p.hour > hour || (p.hour === hour && p.minute >= minute))) ahead = 7;

  // A candidate can only be rejected if that wall time does not exist in Israel (DST gap);
  // stepping a further week keeps the suggestion on a Friday.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const day = new Date(todayUtcMs + (ahead + attempt * 7) * 86_400_000);
    const candidate = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${time}`;
    if (israelWallTimeToUtcIso(candidate)) return candidate;
  }
  return '';
}

/**
 * Converts an Israel wall-clock `YYYY-MM-DDTHH:mm` string (as produced by a `datetime-local`
 * input) to a UTC ISO timestamp, correctly handling Israel's DST transitions for the given
 * calendar date — independent of the browser/OS timezone. Returns `null` for a malformed
 * string or for a wall-clock time that does not exist in Israel (the ~1 hour "spring forward"
 * gap when clocks jump ahead), detected by requiring the conversion to round-trip exactly
 * back to the same wall-clock string.
 */
export function israelWallTimeToUtcIso(wallTime: string): string | null {
  const match = WALL_TIME_PATTERN.exec(wallTime.trim());
  if (!match) return null;
  const [, ys, ms, ds, hs, mins] = match;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mins);
  const targetWallTime = `${ys}-${ms}-${ds}T${hs}:${mins}`;

  // Fixed-point iteration: start by assuming the wall-clock fields are UTC, then repeatedly
  // correct by the Israel offset that actually applies at the current guess. Converges in at
  // most 2-3 iterations for any real (existing) local time; a nonexistent time (DST gap)
  // oscillates between two candidates instead of converging, so the iteration cap plus the
  // round-trip check below is what ultimately rejects it.
  let guessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 5; i += 1) {
    const offsetMin = offsetMinutesAt(guessUtcMs, ISRAEL_TIME_ZONE);
    const nextGuessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0) - offsetMin * 60_000;
    if (nextGuessUtcMs === guessUtcMs) break;
    guessUtcMs = nextGuessUtcMs;
  }

  if (formatIsraelWallTime(new Date(guessUtcMs)) !== targetWallTime) return null;
  return new Date(guessUtcMs).toISOString();
}

/** Today's weekday (0=Sunday..6=Saturday) on the Israel calendar, independent of the
 *  browser's own timezone — a browser in UTC-8 is still on "yesterday" late in the evening
 *  Israel time, which would otherwise highlight the wrong column in the weekly grid. */
export function israelWeekday(now: Date = new Date()): number {
  const p = partsInTimeZone(now, ISRAEL_TIME_ZONE);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
