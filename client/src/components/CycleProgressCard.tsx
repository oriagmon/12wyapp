import { formatScore, remainingToTarget, TARGET_SCORE } from '../lib/scoring';
import styles from './CycleProgressCard.module.css';
import { useTranslation } from '../i18n';

const MEETINGS = [
  { month: 1, week: 4 },
  { month: 2, week: 8 },
  { month: 3, week: 12 },
];

function meetingStatus(currentWeek: number, meetingWeek: number) {
  if (currentWeek > meetingWeek) return 'done';
  if (currentWeek === meetingWeek) return 'current';
  if (currentWeek === meetingWeek - 1) return 'schedule';
  return 'upcoming';
}

/**
 * The two percentages answer different questions, so they sit side by side rather than as two
 * stacked cards: how far into the 12 weeks we are is a calendar fact that moves on its own,
 * while this week's execution against the 85% standard is the only one still worth acting on.
 * Stacked, they read as two competing versions of the same number.
 */
export function CycleProgressCard({ currentWeek, weekScore }: { currentWeek: number; weekScore: number | null }) {
  const { t } = useTranslation();
  const progress = Math.round((currentWeek / 12) * 100);
  const weeksLeft = 12 - currentWeek;
  const remaining = remainingToTarget(weekScore);
  const onTarget = weekScore !== null && weekScore >= TARGET_SCORE;
  const nextMeeting = MEETINGS.find((meeting) => currentWeek <= meeting.week);
  const message =
    nextMeeting?.week === currentWeek
      ? t('dashboard.progress.meetingThisWeek', { month: nextMeeting.month })
      : nextMeeting?.week === currentWeek + 1
        ? t('dashboard.progress.meetingNextWeek', { month: nextMeeting.month })
        : nextMeeting
          ? t('dashboard.progress.meetingLater', { week: nextMeeting.week })
          : t('dashboard.progress.lastWeekOfCycle');

  return (
    <section className={`card ${styles.card}`} aria-label={t('dashboard.progress.label')}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.eyebrow}>{t('dashboard.progress.eyebrow')}</span>
          <strong className={styles.statValue}>
            {t('dashboard.progress.week', { week: currentWeek })}<span className={styles.statUnit}>{t('dashboard.progress.ofTwelve')}</span>
          </strong>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={t('dashboard.progress.barLabel', { percent: progress })}
          >
            <div className={styles.fill} style={{ width: `${progress}%` }} />
            {MEETINGS.map((meeting) => (
              <span
                key={meeting.week}
                className={styles.marker}
                style={{ insetInlineStart: `${(meeting.week / 12) * 100}%` }}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className={styles.statCaption}>
            {t('dashboard.progress.summary', {
              percent: progress,
              remaining: weeksLeft === 0
                ? t('dashboard.progress.lastWeek')
                : t('dashboard.progress.weeksLeft', { count: weeksLeft }),
            })}
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.eyebrow}>{t('dashboard.progress.scoreEyebrow')}</span>
          <strong key={weekScore} className={`${styles.statValue} ${onTarget ? styles.onTarget : ''}`}>
            {formatScore(weekScore)}<span className={styles.statUnit}>{t('dashboard.progress.ofTarget', { target: TARGET_SCORE })}</span>
          </strong>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={weekScore ?? 0}
            aria-valuetext={weekScore === null ? t('dashboard.progress.noTactics') : formatScore(weekScore)}
            aria-label={t('dashboard.progress.scoreLabel', { target: TARGET_SCORE })}
          >
            <div
              className={`${styles.fill} ${onTarget ? styles.fillGold : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, weekScore ?? 0))}%` }}
            />
            <span className={styles.targetMark} style={{ insetInlineStart: `${TARGET_SCORE}%` }} aria-hidden="true" />
          </div>
          <span className={styles.statCaption}>
            {weekScore === null
              ? t('dashboard.progress.noTactics')
              : onTarget
                ? t('dashboard.progress.aboveTarget')
                : t('dashboard.progress.toTarget', { percent: remaining })}
          </span>
        </div>
      </div>

      <p className={styles.message}>✨ {message}</p>

      <div className={styles.meetings}>
        {MEETINGS.map((meeting) => {
          const status = meetingStatus(currentWeek, meeting.week);
          return (
            <div
              key={meeting.week}
              className={`${styles.meeting} ${styles[status]}`}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className={styles.meetingIcon} aria-hidden="true">
                {status === 'done' ? '✓' : status === 'current' ? '●' : status === 'schedule' ? '!' : '○'}
              </span>
              <span>
                <strong>{t('dashboard.progress.monthSummary', { month: meeting.month })}</strong>
                <small>
                  {t('dashboard.progress.meetingWeek', { week: meeting.week })}
                  {status === 'schedule' ? t('dashboard.progress.meetingSchedule') : ''}
                  {status === 'current' ? t('dashboard.progress.meetingCurrent') : ''}
                  {status === 'done' ? t('dashboard.progress.meetingDone') : ''}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
