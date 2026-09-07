import { useEffect, useState } from 'react';
import styles from './Avatar.module.css';
import { useTranslation } from '../i18n';

export type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  /** The authenticated owner of this avatar. Included in the image URL (alongside
   *  avatarVersion) so the browser's HTTP cache key is unique per-account, not just
   *  per-version — otherwise two different users who happen to share the same avatarVersion
   *  number (e.g. both "1", both never having changed their photo) could collide in the same
   *  browser's cache after a logout/login as a different account. */
  userId: number;
  displayName: string;
  email: string;
  hasAvatar: boolean;
  avatarVersion: number;
  /** Consecutive finished weeks scored >= 85%. Rendered as a small numbered chip when
   *  provided. Omit entirely (e.g. the Duo Streak card/celebration overlay, which already
   *  show their own *shared* streak) to render a clean avatar with no personal-streak chip. */
  successStreak?: number;
  size?: AvatarSize;
}

function initialsFrom(displayName: string, email: string): string {
  const source = displayName.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/**
 * Reusable avatar: shows the given user's uploaded image (via the authenticated
 * /api/profile/avatar?u=<userId> endpoint — the browser sends the session cookie automatically
 * for this same-origin request; the server allows fetching either your own avatar or your
 * currently accepted partner's) or, absent one / on load failure, a fallback circle with
 * initials. Optionally carries a small bottom-left chip showing a personal success-streak
 * number, when `successStreak` is provided.
 */
export function Avatar({ userId, displayName, email, hasAvatar, avatarVersion, successStreak, size = 'md' }: AvatarProps) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [userId, hasAvatar, avatarVersion]);

  const showImage = hasAvatar && !imageFailed;
  const initials = initialsFrom(displayName, email);
  const streakLabel =
    successStreak !== undefined
      ? t('common.avatar.streak', { count: successStreak })
      : '';

  return (
    <span className={`${styles.wrap} ${styles[size]}`}>
      {showImage ? (
        <img
          className={styles.image}
          src={`/api/profile/avatar?u=${userId}&v=${avatarVersion}`}
          alt={displayName || email}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials}
        </span>
      )}
      {/* role="img" makes assistive tech announce the aria-label instead of the bare digit,
          so the streak's meaning (not just its number) is what gets read out. */}
      {successStreak !== undefined && (
        <span className={styles.chip} title={streakLabel} role="img" aria-label={streakLabel}>
          {successStreak}
        </span>
      )}
    </span>
  );
}
