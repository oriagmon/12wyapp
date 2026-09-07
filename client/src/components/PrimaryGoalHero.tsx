import type { Cycle, Goal } from '../lib/types';
import { formatScore, TARGET_SCORE } from '../lib/scoring';
import styles from './PrimaryGoalHero.module.css';

/** The vision is shown in full, never clipped behind a "read more". It is the one sentence
 *  the whole cycle answers to, and hiding half of it behind a click meant it was effectively
 *  never read. Length is absorbed by the type scale instead of by truncation. */
export function PrimaryGoalHero({
  cycle,
  goals,
  currentScore,
}: {
  cycle: Cycle;
  goals: Goal[];
  currentScore: number | null;
}) {
  const primaryGoal = goals[0];
  const tacticCount = primaryGoal?.tactics.length ?? 0;
  const headline = cycle.vision.trim() || primaryGoal?.title || cycle.name;
  const context = cycle.vision.trim() && primaryGoal ? primaryGoal.title : null;

  return (
    <section className={`card ${styles.hero}`}>
      <span className={styles.accent} aria-hidden="true" />
      <div className={styles.label}>המטרה המרכזית</div>
      <h1 className={`${styles.headline} ${headline.length > 120 ? styles.long : ''}`}>
        {headline}
      </h1>
      {context && <p className={styles.context}>{context}</p>}
      <div className={styles.chips}>
        <span>12 שבועות</span>
        <span>{tacticCount} טקטיקות למטרה</span>
        <span>ביצוע השבוע: {formatScore(currentScore)}</span>
        <span>סטנדרט הצלחה: {TARGET_SCORE}%</span>
      </div>
    </section>
  );
}
