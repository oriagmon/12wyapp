import { useTranslation } from '../i18n';
import { useDateFormat } from '../lib/relativeTime';

/**
 * Renders a timestamp the way it is actually read: relative up front, exact on hover and in
 * the accessible name. Always a real `<time>` element, so the machine-readable instant
 * survives even when the visible text says "yesterday".
 */
export function TimeAgo({
  iso,
  upcoming = false,
  className,
}: {
  iso: string;
  upcoming?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { formatAbsolute, formatRelative, formatUpcoming } = useDateFormat();
  const absolute = formatAbsolute(iso);

  return (
    <time className={className} dateTime={iso} title={t('common.time.title', { absolute })}>
      {upcoming ? formatUpcoming(iso) : formatRelative(iso)}
    </time>
  );
}
