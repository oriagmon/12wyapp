import type { DuoStreakSummary } from '../lib/types';
import { useTranslation } from '../i18n';
import { Avatar } from './Avatar';
import styles from './DuoStreakCard.module.css';

/**
 * Compact, shared "Duo Streak" summary — current/best/total plus both participants' avatars.
 * Purely a display of server-derived numbers (see `computeDuoStreak` on the server); this
 * component itself holds no streak logic. Shown in both the WAM list and detail views.
 */
export function DuoStreakCard({ duoStreak }: { duoStreak: DuoStreakSummary | null }) {
  const { t } = useTranslation();
  if (!duoStreak) return null;
  const [a, b] = duoStreak.participants;
  const hasEverSucceeded = duoStreak.totalDuoWins > 0;

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.avatars}>
        <div className={styles.participant}>
          <Avatar userId={a.userId} displayName={a.displayName} email={a.email} hasAvatar={a.hasAvatar} avatarVersion={a.avatarVersion} size="sm" />
          <span className={styles.name} dir="auto">{a.displayName.trim() || a.email}</span>
          {a.displayName.trim() && a.displayName.trim() === b.displayName.trim() && <span className={styles.identifier} dir="auto">{a.email}</span>}
        </div>
        <span className={styles.heart} aria-hidden="true">
          💛
        </span>
        <div className={styles.participant}>
          <Avatar userId={b.userId} displayName={b.displayName} email={b.email} hasAvatar={b.hasAvatar} avatarVersion={b.avatarVersion} size="sm" />
          <span className={styles.name} dir="auto">{b.displayName.trim() || b.email}</span>
          {b.displayName.trim() && b.displayName.trim() === a.displayName.trim() && <span className={styles.identifier} dir="auto">{b.email}</span>}
        </div>
      </div>

      <div className={styles.stats}>
        <div className={`${styles.stat} ${duoStreak.currentStreak > 0 ? styles.statActive : ''}`}>
          <span className={styles.statValue} aria-hidden="true">
            🔥 {duoStreak.currentStreak}
          </span>
          <span className={styles.statLabel}>{t('dashboard.duo.current')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>🏆 {duoStreak.bestStreak}</span>
          <span className={styles.statLabel}>{t('dashboard.duo.best')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>✅ {duoStreak.totalDuoWins}</span>
          <span className={styles.statLabel}>{t('dashboard.duo.wins')}</span>
        </div>
      </div>

      {!hasEverSucceeded ? (
        <p className={styles.motivation}>
          {t('dashboard.duo.never')}
        </p>
      ) : duoStreak.currentStreak === 0 ? (
        <p className={styles.motivation}>{t('dashboard.duo.stopped')}</p>
      ) : null}
    </div>
  );
}
