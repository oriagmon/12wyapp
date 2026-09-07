import { formatScore, remainingToTarget, TARGET_SCORE } from '../lib/scoring';
import { useTranslation } from '../i18n';
import styles from './ScoreSummary.module.css';

export function ScoreSummary({ week, score }: { week: number; score: number | null }) {
  const { t } = useTranslation();
  const remaining = remainingToTarget(score);
  const gold = score !== null && score >= TARGET_SCORE;
  const encouragement =
    score === null
      ? t('dashboard.score.noTactics')
      : score >= TARGET_SCORE
        ? t('dashboard.score.strong')
        : score >= 65
          ? t('dashboard.score.almost')
          : score >= 35
            ? t('dashboard.score.building')
            : t('dashboard.score.start');

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.top}>
        <div>
          <span className={styles.label}>{t('dashboard.score.week', { week })}</span>
          <div key={score} className={`${styles.score} ${gold ? styles.gold : ''}`}>
            {formatScore(score)}
          </div>
        </div>
        <div className={styles.remaining}>
          {score === null ? (
            <span>{t('dashboard.score.nothingScheduled')}</span>
          ) : gold ? (
            <span className={styles.goldText}>{t('dashboard.score.aboveTarget')}</span>
          ) : (
            <span>
              {t('dashboard.score.remainingPrefix')} <strong>{remaining}%</strong>{' '}
              {t('dashboard.score.remainingSuffix')}
            </span>
          )}
        </div>
      </div>
      <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={score ?? 0} aria-valuetext={score === null ? t('dashboard.score.nothingScheduled') : formatScore(score)}
        aria-label={t('dashboard.score.progressLabel', { score: score ?? 0 })}>
        <div
          className={`${styles.progressFill} ${gold ? styles.progressGold : ''}`}
          style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
        />
      </div>
      <p className={styles.encouragement}>{encouragement}</p>
    </div>
  );
}
