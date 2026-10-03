import { formatScore, TARGET_SCORE } from '../lib/scoring';
import { useTranslation } from '../i18n';
import styles from './FinishedWeeksAverageCard.module.css';

type Props = {
  average: number | null;
  currentWeek: number;
  measuredWeeks: number;
};

export function FinishedWeeksAverageCard({ average, currentWeek, measuredWeeks }: Props) {
  const { t } = useTranslation();
  const onTarget = average !== null && average >= TARGET_SCORE;

  return (
    <section className={`card ${styles.card}`} aria-label={t('dashboard.average.label')}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{t('dashboard.average.eyebrow')}</span>
        <h2>{t('dashboard.average.title')}</h2>
        <p>
          {measuredWeeks === 0
            ? t('dashboard.average.noFinishedWeeks', { week: currentWeek })
            : t('dashboard.average.explanation', {
                count: measuredWeeks,
                week: currentWeek,
              })}
        </p>
      </div>

      <div className={`${styles.value} ${onTarget ? styles.onTarget : ''}`}>
        <strong>{formatScore(average)}</strong>
        <span>
          {average === null
            ? t('dashboard.average.pending')
            : onTarget
              ? t('dashboard.average.aboveTarget', { target: TARGET_SCORE })
              : t('dashboard.average.belowTarget', {
                  gap: Math.round((TARGET_SCORE - average) * 10) / 10,
                  target: TARGET_SCORE,
                })}
        </span>
      </div>
    </section>
  );
}
