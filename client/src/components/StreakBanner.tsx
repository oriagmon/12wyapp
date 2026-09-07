import { useExecutionHeatmap } from '../hooks/useExecutionHeatmap';
import type { ExecutionHeatmapResponse } from '../lib/executionHeatmapTypes';
import styles from './StreakBanner.module.css';

type Summary = ExecutionHeatmapResponse['summary'];

/** The streak is the one number people come back for, so it says something rather than
 *  just counting. Wording is deliberately short — this sits above the fold on every visit. */
function streakMessage(summary: Summary, isActive: boolean, targetScore: number): string {
  if (!isActive) return 'המחזור הסתיים — הרצף נשמר בהיסטוריה.';
  if (summary.currentStreak === 0) {
    return summary.bestStreak > 0
      ? `הרצף נקטע. יום אחד מעל ${targetScore}% מתחיל רצף חדש.`
      : `יום אחד מעל ${targetScore}% ומתחילים רצף.`;
  }
  if (summary.currentStreak >= summary.bestStreak && summary.bestStreak > 1) {
    return 'זה הרצף הכי ארוך שלך עד היום. אל תשברו אותו.';
  }
  const toBeat = summary.bestStreak - summary.currentStreak + 1;
  return toBeat <= 3
    ? `עוד ${toBeat === 1 ? 'יום אחד' : `${toBeat} ימים`} ותשברו את השיא שלכם.`
    : 'הרצף פעיל. כל יום שמגיע ליעד מאריך אותו.';
}

export function StreakBanner({ userId, refreshKey }: { userId: number | null; refreshKey?: unknown }) {
  const { data, loadStatus } = useExecutionHeatmap(userId, undefined, refreshKey);

  // Nothing is worse than a motivational banner that flashes zeros while loading, so it
  // stays absent until there are real numbers to show.
  if (loadStatus !== 'ready' || !data?.cycle) return null;

  const { summary, cycle, targetScore } = data;
  const isRecord = cycle.isActive && summary.currentStreak > 0 && summary.currentStreak >= summary.bestStreak;
  const isCold = cycle.isActive && summary.currentStreak === 0;

  return (
    <section
      className={`card ${styles.banner} ${isRecord ? styles.record : ''} ${isCold ? styles.cold : ''}`}
      aria-label="רצף ימי ההצלחה"
    >
      <div className={styles.headline}>
        <span className={styles.flame} aria-hidden="true">{isCold ? '⚪' : '🔥'}</span>
        <span className={styles.count}>{summary.currentStreak}</span>
        <span className={styles.unit}>
          {summary.currentStreak === 1 ? 'יום הצלחה ברצף' : 'ימי הצלחה ברצף'}
        </span>
        {isRecord && summary.bestStreak > 1 && <span className={styles.badge}>שיא אישי</span>}
      </div>

      <p className={styles.message}>{streakMessage(summary, cycle.isActive, targetScore)}</p>

      <dl className={styles.side} aria-label="נתוני רצף נוספים">
        <div>
          <dt>הרצף הטוב ביותר</dt>
          <dd>{summary.bestStreak}<span> {summary.bestStreak === 1 ? 'יום' : 'ימים'}</span></dd>
        </div>
        <div>
          <dt>ימים שהגיעו ליעד</dt>
          <dd>{summary.successfulDays}<span> במחזור</span></dd>
        </div>
      </dl>
    </section>
  );
}
