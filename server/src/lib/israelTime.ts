/**
 * Israel wall-clock ⇄ UTC conversions for scheduled email reminders, correct regardless of
 * the server process's own timezone. Uses Intl.DateTimeFormat with a fixed `Asia/Jerusalem`
 * timeZone (reflecting Israel's actual DST rules for any given date) rather than relying on
 * the host environment's local timezone in any way.
 *
 * This intentionally mirrors client/src/lib/israelTime.ts (same algorithm, same public
 * function names/signatures) — the client already needed this for the WAM "next meeting"
 * scheduler, and scheduled email reminders need the identical conversion server-side so the
 * server is the authoritative validator of "does this Israel wall-clock time exist?" rather
 * than trusting a client-side conversion. There is no shared package between the two
 * (separate npm workspaces without a common source), so this is a deliberate, documented
 * duplication rather than an import.
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

/** Formats a UTC instant as Israel local wall-clock time in `YYYY-MM-DDTHH:mm` form —
 *  independent of the server's own timezone. */
export function formatIsraelWallTime(date: Date): string {
  const p = partsInTimeZone(date, ISRAEL_TIME_ZONE);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Converts a saved UTC ISO timestamp to the Israel-local `YYYY-MM-DDTHH:mm` representation. */
export function utcIsoToIsraelWallTime(iso: string): string {
  return formatIsraelWallTime(new Date(iso));
}

/** Day-of-week (0=Sunday..6=Saturday, matching this app's `weekdays`/`completions` schema
 *  convention everywhere else) for the Israel-local *calendar date* containing this instant —
 *  independent of the server's own timezone. Only the calendar date matters for a
 *  day-of-week computation (not the time-of-day), so this reuses `formatIsraelWallTime`'s
 *  date parts and re-anchors them as UTC before asking JS for the day-of-week — sidestepping
 *  any local-timezone reinterpretation that constructing a plain `new Date(y, m, d)` (using
 *  the *server process's* local timezone) could otherwise introduce. */
export function israelWeekday(date: Date): number {
  const wallTime = formatIsraelWallTime(date); // 'YYYY-MM-DDTHH:mm'
  const [datePart] = wallTime.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Converts an Israel wall-clock `YYYY-MM-DDTHH:mm` string (as produced by a `datetime-local`
 * input) to a UTC ISO timestamp, correctly handling Israel's DST transitions for the given
 * calendar date — independent of the server's own timezone. Returns `null` for a malformed
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
