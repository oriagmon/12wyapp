import { formatAbsolute, formatRelative, formatUpcoming } from '../lib/relativeTime';

/**
 * Renders a timestamp the way it is actually read: relative up front, exact on hover and in
 * the accessible name. Always a real `<time>` element, so the machine-readable instant
 * survives even when the visible text says "אתמול".
 */
export function TimeAgo({ iso, upcoming = false, className }: { iso: string; upcoming?: boolean; className?: string }) {
  const absolute = formatAbsolute(iso);
  return (
    <time className={className} dateTime={iso} title={`${absolute} (שעון ישראל)`}>
      {upcoming ? formatUpcoming(iso) : formatRelative(iso)}
    </time>
  );
}
