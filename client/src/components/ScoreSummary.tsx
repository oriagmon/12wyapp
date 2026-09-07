import { formatScore, remainingToTarget, TARGET_SCORE } from '../lib/scoring';
import styles from './ScoreSummary.module.css';

export function ScoreSummary({ week, score }: { week: number; score: number | null }) {
  const remaining = remainingToTarget(score);
  const gold = score !== null && score >= TARGET_SCORE;
  const encouragement =
    score === null
      ? 'עוד לא הוגדרו טקטיקות לשבוע — אפשר להתחיל מאחת.'
      : score >= TARGET_SCORE
        ? 'איזה שבוע חזק! שמרתם על ההבטחות שלכם לעצמכם. ✨'
        : score >= 65
          ? 'כמעט שם — עוד כמה ביצועים ואתם מעל היעד. קדימה!'
          : score >= 35
            ? 'התנופה נבנית. כל סימון מקרב אתכם ליעד.'
            : 'עצם המעקב הוא התחלה מצוינת. בחרו פעולה אחת קטנה להמשך.';

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.top}>
        <div>
          <span className={styles.label}>שבוע {week}</span>
          <div key={score} className={`${styles.score} ${gold ? styles.gold : ''}`}>
            {formatScore(score)}
          </div>
        </div>
        <div className={styles.remaining}>
          {score === null ? (
            <span>אין תוכניות מתוזמנות השבוע</span>
          ) : gold ? (
            <span className={styles.goldText}>🏆 עברת את יעד ה־85!</span>
          ) : (
            <span>
              נותרו <strong>{remaining}%</strong> ליעד 85%
            </span>
          )}
        </div>
      </div>
      <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={score ?? 0} aria-valuetext={score === null ? 'אין תוכניות מתוזמנות השבוע' : formatScore(score)}
        aria-label={`התקדמות שבועית: ${score ?? 0}%`}>
        <div
          className={`${styles.progressFill} ${gold ? styles.progressGold : ''}`}
          style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
        />
      </div>
      <p className={styles.encouragement}>{encouragement}</p>
    </div>
  );
}
