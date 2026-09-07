import type { Goal } from '../lib/types';
import { effectiveTacticForWeek } from '../lib/scoring';
import { israelWeekday } from '../lib/israelTime';
import { GOAL_COLOR_HEX } from '../lib/colors';
import { useCompletionFeedback } from '../hooks/useCompletionFeedback';
import styles from './WeeklyGrid.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';

function isScheduled(tactic: { weekdays: number[]; startWeek: number; endWeek: number }, week: number, weekday: number): boolean {
  return week >= tactic.startWeek && week <= tactic.endWeek && tactic.weekdays.includes(weekday);
}

export function WeeklyGrid({
  goals,
  week,
  currentWeek,
  isOwner,
  onToggle,
}: {
  goals: Goal[];
  week: number;
  /** Only the cycle's live week has a "today"; browsing week 2 in week 7 must not highlight
   *  a column that is not actually today. Omitted for read-only/archive contexts. */
  currentWeek?: number;
  isOwner: boolean;
  onToggle: (tacticId: number, weekday: number, done: boolean) => void | Promise<unknown>;
}) {
  const weekdayLabels = useWeekdayLabels();
  const today = currentWeek === week ? israelWeekday() : null;
  const feedback = useCompletionFeedback(`${week}:${isOwner}:${goals.map((goal) => goal.id).join(',')}`);
  const allTactics = goals.flatMap((g) =>
    g.tactics.map((t) => ({
      ...t,
      ...effectiveTacticForWeek(t, week),
      goalColor: g.color,
      goalTitle: g.title,
    }))
  );

  if (allTactics.length === 0) {
    return (
      <div className={`card ${styles.emptyCard}`}>
        <p>אין עדיין טקטיקות מוגדרות. הוסיפו מטרות וטקטיקות כדי לראות את הרשת השבועית.</p>
      </div>
    );
  }

  return (
    <div className={`card ${styles.wrap}`} role="region" aria-label="רשת ביצועים שבועית — ניתן לגלול לרוחב" tabIndex={0}>
      {feedback.error && <p role="alert" className="completion-error">{feedback.error}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.tacticHeader}>טקטיקה</th>
            {weekdayLabels.short.map((label, weekday) => (
              <th key={label} scope="col" className={weekday === today ? styles.todayColumn : undefined}>
                {label}
                {weekday === today && <span className={styles.todayBadge}>היום</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allTactics.map((tactic) => {
            return (
            <tr key={tactic.id}>
              <th scope="row" className={styles.tacticName}>
                <span
                  className={styles.colorDot}
                  style={{ background: GOAL_COLOR_HEX[tactic.goalColor] }}
                  aria-hidden="true"
                />
                <span>
                  {tactic.title}
                  <span className={styles.goalName}> · {tactic.goalTitle}</span>
                </span>
              </th>
              {weekdayLabels.short.map((_, weekday) => {
                const scheduled = isScheduled(tactic, week, weekday);
                const completion = tactic.completions.find((c) => c.week === week && c.weekday === weekday);
                const done = Boolean(completion?.done);
                const key = `${tactic.id}:${weekday}`;
                if (!scheduled) {
                  return (
                    <td key={weekday} className={`${styles.unscheduled} ${weekday === today ? styles.todayCell : ''}`}
                      aria-label="לא מתוזמן">
                      ·
                    </td>
                  );
                }
                return (
                  <td key={weekday} className={weekday === today ? styles.todayCell : undefined}>
                    <div className={styles.cellWrap}>
                      <button
                        type="button"
                        className={`${styles.cell} ${done ? styles.done : styles.pending} ${feedback.popped.has(key) ? 'completion-pop' : ''}`}
                        disabled={!isOwner || feedback.pending.has(key)}
                        aria-busy={feedback.pending.has(key) || undefined}
                        aria-pressed={done}
                        aria-label={`${tactic.title} — ${weekdayLabels.short[weekday]}, ${done ? 'בוצע' : 'לביצוע'}`}
                        onClick={() => void feedback.run(key, !done, () => onToggle(tactic.id, weekday, !done))}
                      >
                        {done ? '✓' : ''}
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendDone}`} aria-hidden="true">✓</span>בוצע
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} aria-hidden="true" />מתוכנן, טרם בוצע
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendUnscheduled}`} aria-hidden="true">·</span>
          לא מתוכנן ליום הזה
        </span>
        {today !== null && (
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendToday}`} aria-hidden="true" />
            היום — יום {weekdayLabels.full[today]}
          </span>
        )}
      </p>
    </div>
  );
}
