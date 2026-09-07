import { formatScore, remainingToTarget, TARGET_SCORE } from '../lib/scoring';
import styles from './CycleProgressCard.module.css';

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
  const progress = Math.round((currentWeek / 12) * 100);
  const weeksLeft = 12 - currentWeek;
  const remaining = remainingToTarget(weekScore);
  const onTarget = weekScore !== null && weekScore >= TARGET_SCORE;
  const nextMeeting = MEETINGS.find((meeting) => currentWeek <= meeting.week);
  const message =
    nextMeeting?.week === currentWeek
      ? `השבוע פגישת הסיכום החודשית ${nextMeeting.month}. עוצרים, מסתכלים אחורה ומכוונים מחדש.`
      : nextMeeting?.week === currentWeek + 1
        ? `בשבוע הבא פגישת הסיכום החודשית ${nextMeeting.month} — שווה לקבוע אותה ביומן כבר עכשיו.`
        : nextMeeting
          ? `פגישת הסיכום החודשית הבאה בשבוע ${nextMeeting.week}.`
          : 'זה השבוע האחרון במחזור — זמן לסכם, לחגוג ולתכנן את הבא.';

  return (
    <section className={`card ${styles.card}`} aria-label="התקדמות">
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.eyebrow}>המחזור</span>
          <strong className={styles.statValue}>
            שבוע {currentWeek}<span className={styles.statUnit}> מתוך 12</span>
          </strong>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={`${progress}% מהמחזור מאחורינו`}
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
            {progress}% מהדרך · {weeksLeft === 0 ? 'השבוע האחרון' : `נותרו ${weeksLeft} שבועות`}
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.eyebrow}>ביצוע השבוע</span>
          <strong key={weekScore} className={`${styles.statValue} ${onTarget ? styles.onTarget : ''}`}>
            {formatScore(weekScore)}<span className={styles.statUnit}> מתוך יעד {TARGET_SCORE}%</span>
          </strong>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={weekScore ?? 0}
            aria-valuetext={weekScore === null ? 'אין טקטיקות מתוזמנות השבוע' : formatScore(weekScore)}
            aria-label={`ביצוע השבוע מול יעד ${TARGET_SCORE}%`}
          >
            <div
              className={`${styles.fill} ${onTarget ? styles.fillGold : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, weekScore ?? 0))}%` }}
            />
            <span className={styles.targetMark} style={{ insetInlineStart: `${TARGET_SCORE}%` }} aria-hidden="true" />
          </div>
          <span className={styles.statCaption}>
            {weekScore === null
              ? 'אין טקטיקות מתוזמנות השבוע'
              : onTarget
                ? '🏆 מעל היעד'
                : `נותרו ${remaining}% ליעד`}
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
                <strong>סיכום חודש {meeting.month}</strong>
                <small>
                  שבוע {meeting.week}
                  {status === 'schedule' ? ' · לקבוע עכשיו' : ''}
                  {status === 'current' ? ' · השבוע' : ''}
                  {status === 'done' ? ' · הושלם' : ''}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
