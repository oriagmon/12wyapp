import type { WamDetail } from '../lib/types';
import { formatScore } from '../lib/scoring';
import { RatingPicker } from './RatingPicker';
import styles from './WamScoreReview.module.css';

function ScoreSide({
  label,
  email,
  wam,
  side,
  isMe,
  locked,
  onRate,
}: {
  label: string;
  email: string;
  wam: WamDetail;
  side: 'a' | 'b';
  isMe: boolean;
  locked: boolean;
  onRate?: (rating: number) => void;
}) {
  const review = wam.reviews[side];
  const displayScore = wam.status === 'complete' ? review.scoreSnapshot : review.live.score;
  const frozen = wam.status === 'complete';

  return (
    <div className={`${styles.side} ${isMe ? styles.me : ''}`}>
      <div className={styles.sideHeader}>
        <span className={styles.sideLabel}>
          {label} {isMe && <span className={styles.meBadge}>(את/ה)</span>}
        </span>
        <span className={styles.email}>{email}</span>
      </div>

      <div className={styles.scoreRow}>
        <span className={styles.scoreValue}>{formatScore(displayScore)}</span>
        <span className={styles.scoreTag}>{frozen ? 'קפוא (הושלם)' : 'חי — נכון להיום'}</span>
      </div>

      {review.live.hasCycle ? (
        <p className={styles.cycleInfo}>
          מחזור: {review.live.cycleName}
          {review.live.cycleIsActive ? '' : ' (הסתיים)'} · שבוע נוכחי: {review.live.currentWeek}
        </p>
      ) : (
        <p className={styles.cycleInfo}>אין מחזור פעיל</p>
      )}

      <RatingPicker
        label={isMe ? 'הדירוג העצמי שלי (1-10)' : 'דירוג עצמי'}
        value={review.rating}
        disabled={!isMe || locked}
        onChange={isMe ? onRate : undefined}
      />
    </div>
  );
}

export function WamScoreReview({
  wam,
  myScope,
  locked,
  onRate,
}: {
  wam: WamDetail;
  myScope: 'a' | 'b';
  locked: boolean;
  onRate: (rating: number) => void;
}) {
  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>סקירת ציונים — שבוע {wam.week}</h3>
        {wam.isHistorical && (
          <div className={styles.historicalBanner} role="status">
            🔒 פגישה זו שייכת למחזור שהסתיים — כל הנתונים כאן נשמרים לצמיתות כהיסטוריה לקריאה בלבד.
          </div>
        )}
        {wam.mismatch && (
          <div className={styles.mismatch} role="alert">
            ⚠️ שימו לב: השבוע הנוכחי במחזורים של שני הצדדים שונה. אין סנכרון אוטומטי — כל אחד/ת ממשיך/ה
            בקצב שלו/ה.
          </div>
        )}
      </div>
      <div className={styles.sides}>
        <ScoreSide
          label="צד א׳"
          email={wam.partnership.initiatorEmail}
          wam={wam}
          side="a"
          isMe={myScope === 'a'}
          locked={locked}
          onRate={onRate}
        />
        <ScoreSide
          label="צד ב׳"
          email={wam.partnership.inviteeEmail}
          wam={wam}
          side="b"
          isMe={myScope === 'b'}
          locked={locked}
          onRate={onRate}
        />
      </div>
    </div>
  );
}
