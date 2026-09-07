import type { WamDetail } from '../lib/types';
import { formatScore } from '../lib/scoring';
import { RatingPicker } from './RatingPicker';
import styles from './WamScoreReview.module.css';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  const review = wam.reviews[side];
  const displayScore = wam.status === 'complete' ? review.scoreSnapshot : review.live.score;
  const frozen = wam.status === 'complete';

  return (
    <div className={`${styles.side} ${isMe ? styles.me : ''}`}>
      <div className={styles.sideHeader}>
        <span className={styles.sideLabel}>
          {label} {isMe && <span className={styles.meBadge}>{t('wams.review.me')}</span>}
        </span>
        <span className={styles.email}>{email}</span>
      </div>

      <div className={styles.scoreRow}>
        <span className={styles.scoreValue}>{formatScore(displayScore)}</span>
        <span className={styles.scoreTag}>{frozen ? t('wams.review.frozen') : t('wams.review.live')}</span>
      </div>

      {review.live.hasCycle ? (
        <p className={styles.cycleInfo}>
          {t('wams.review.cycle', {
            name: review.live.cycleName ?? '',
            ended: review.live.cycleIsActive ? '' : t('wams.review.cycleEnded'),
            week: review.live.currentWeek ?? '',
          })}
        </p>
      ) : (
        <p className={styles.cycleInfo}>{t('wams.review.noCycle')}</p>
      )}

      <RatingPicker
        label={isMe ? t('wams.review.myRating') : t('wams.review.theirRating')}
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
  const { t } = useTranslation();
  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('wams.review.title', { week: wam.week })}</h3>
        {wam.isHistorical && (
          <div className={styles.historicalBanner} role="status">
            {t('wams.review.lockedNote')}
          </div>
        )}
        {wam.mismatch && (
          <div className={styles.mismatch} role="alert">
            {t('wams.review.driftNote')}
          </div>
        )}
      </div>
      <div className={styles.sides}>
        <ScoreSide
          label={t('wams.review.sideA')}
          email={wam.partnership.initiatorEmail}
          wam={wam}
          side="a"
          isMe={myScope === 'a'}
          locked={locked}
          onRate={onRate}
        />
        <ScoreSide
          label={t('wams.review.sideB')}
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
