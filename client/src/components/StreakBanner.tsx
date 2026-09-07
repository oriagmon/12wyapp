import { useExecutionHeatmap } from '../hooks/useExecutionHeatmap';
import type { ExecutionHeatmapResponse } from '../lib/executionHeatmapTypes';
import { useTranslation, type Translator } from '../i18n';
import styles from './StreakBanner.module.css';

type Summary = ExecutionHeatmapResponse['summary'];

/** The streak is the one number people come back for, so it says something rather than
 *  just counting. Wording is deliberately short — this sits above the fold on every visit. */
function streakMessage(summary: Summary, isActive: boolean, targetScore: number, t: Translator): string {
  if (!isActive) return t('dashboard.streak.ended');
  if (summary.currentStreak === 0) {
    return summary.bestStreak > 0
      ? t('dashboard.streak.broken', { target: targetScore })
      : t('dashboard.streak.none', { target: targetScore });
  }
  if (summary.currentStreak >= summary.bestStreak && summary.bestStreak > 1) {
    return t('dashboard.streak.record');
  }
  const toBeat = summary.bestStreak - summary.currentStreak + 1;
  return toBeat <= 3
    ? t('dashboard.streak.toBeat', { count: toBeat })
    : t('dashboard.streak.alive');
}

export function StreakBanner({ userId, refreshKey }: { userId: number | null; refreshKey?: unknown }) {
  const { data, loadStatus } = useExecutionHeatmap(userId, undefined, refreshKey);
  const { t } = useTranslation();

  // Nothing is worse than a motivational banner that flashes zeros while loading, so it
  // stays absent until there are real numbers to show.
  if (loadStatus !== 'ready' || !data?.cycle) return null;

  const { summary, cycle, targetScore } = data;
  const isRecord = cycle.isActive && summary.currentStreak > 0 && summary.currentStreak >= summary.bestStreak;
  const isCold = cycle.isActive && summary.currentStreak === 0;

  return (
    <section
      className={`card ${styles.banner} ${isRecord ? styles.record : ''} ${isCold ? styles.cold : ''}`}
      aria-label={t('dashboard.streak.label')}
    >
      <div className={styles.headline}>
        <span className={styles.flame} aria-hidden="true">{isCold ? '⚪' : '🔥'}</span>
        <span className={styles.count}>{summary.currentStreak}</span>
        <span className={styles.unit}>
          {t('dashboard.streak.unit', { count: summary.currentStreak })}
        </span>
        {isRecord && summary.bestStreak > 1 && <span className={styles.badge}>{t('dashboard.streak.personalBest')}</span>}
      </div>

      <p className={styles.message}>{streakMessage(summary, cycle.isActive, targetScore, t)}</p>

      <dl className={styles.side} aria-label={t('dashboard.streak.sideLabel')}>
        <div>
          <dt>{t('dashboard.streak.best')}</dt>
          <dd>{summary.bestStreak}<span> {t('dashboard.streak.days', { count: summary.bestStreak })}</span></dd>
        </div>
        <div>
          <dt>{t('dashboard.streak.targetDays')}</dt>
          <dd>{summary.successfulDays}<span> {t('dashboard.streak.inCycle')}</span></dd>
        </div>
      </dl>
    </section>
  );
}
