import type { Goal } from '../lib/types';
import { effectiveTacticForWeek, WEEKDAY_LABELS_HE, todayWeekday } from '../lib/scoring';
import { GOAL_COLOR_HEX } from '../lib/colors';
import { useCompletionFeedback } from '../hooks/useCompletionFeedback';
import styles from './TodayList.module.css';

export function TodayList({
  goals,
  currentWeek,
  isOwner,
  onToggle,
}: {
  goals: Goal[];
  currentWeek: number;
  isOwner: boolean;
  onToggle: (tacticId: number, weekday: number, done: boolean) => void | Promise<unknown>;
}) {
  const today = todayWeekday();
  const feedback = useCompletionFeedback(`${currentWeek}:${isOwner}:${goals.map((goal) => goal.id).join(',')}`);
  const items = goals.flatMap((g) =>
    g.tactics
      .filter((t) => currentWeek >= t.startWeek && currentWeek <= t.endWeek)
      .map((t) => ({
        ...t,
        ...effectiveTacticForWeek(t, currentWeek),
        goalColor: g.color,
        goalTitle: g.title,
      }))
  );

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.heading}>
        <h3 className={styles.title}>ביצוע השבוע — שבוע {currentWeek}</h3>
        <p className={styles.subtitle}>סמנו את מה שכבר בוצע השבוע — אפשר גם בדיעבד, בבת אחת.</p>
      </div>
      {feedback.error && <p role="alert" className="completion-error">{feedback.error}</p>}
      {items.length === 0 ? (
        <p className={styles.empty}>אין טקטיקות מתוזמנות לשבוע הזה.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const completedDays = item.weekdays.filter((weekday) =>
              item.completions.some(
                (completion) =>
                  completion.week === currentWeek && completion.weekday === weekday && completion.done
              )
            ).length;

            return (
              <li key={item.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span
                    className={styles.colorDot}
                    style={{ background: GOAL_COLOR_HEX[item.goalColor] }}
                    aria-hidden="true"
                  />
                  <span className={styles.tacticName}>{item.title}</span>
                  <span className={styles.goalName}>{item.goalTitle}</span>
                  <strong className={styles.count}>
                    {completedDays}/{item.weekdays.length} ימים
                  </strong>
                </div>
                <div className={styles.days} aria-label={`ימי ביצוע עבור ${item.title}`}>
                  {WEEKDAY_LABELS_HE.map((label, weekday) => {
                    const scheduled = currentWeek >= item.startWeek && currentWeek <= item.endWeek && item.weekdays.includes(weekday);
                    const completion = item.completions.find(
                      (c) => c.week === currentWeek && c.weekday === weekday
                    );
                    const done = Boolean(completion?.done);
                    const key = `${item.id}:${weekday}`;
                    return (
                      <div key={weekday} className={styles.dayWrap}>
                        <button
                          type="button"
                          className={`${styles.day} ${done ? styles.dayDone : ''} ${feedback.popped.has(key) ? 'completion-pop' : ''} ${
                            weekday === today ? styles.today : ''
                          }`}
                          disabled={!isOwner || !scheduled || feedback.pending.has(key)}
                          aria-busy={feedback.pending.has(key) || undefined}
                          aria-pressed={done}
                          aria-label={`${item.title} — ${label}, ${
                            scheduled ? (done ? 'בוצע' : 'לא בוצע') : 'לא מתוזמן'
                          }`}
                          onClick={() => void feedback.run(key, !done, () => onToggle(item.id, weekday, !done))}
                        >
                          <span>{label}</span>
                          <span aria-hidden="true">{scheduled ? (done ? '✓' : '') : '·'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
