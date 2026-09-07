import type { Goal } from '../lib/types';
import { effectiveTacticForWeek } from '../lib/scoring';
import { israelWeekday } from '../lib/israelTime';
import { GOAL_COLOR_HEX } from '../lib/colors';
import { useCompletionFeedback } from '../hooks/useCompletionFeedback';
import styles from './WeeklyGrid.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  const weekdayLabels = useWeekdayLabels();
  const today = currentWeek === week ? israelWeekday() : null;
  const feedback = useCompletionFeedback(`${week}:${isOwner}:${goals.map((goal) => goal.id).join(',')}`);
  const allTactics = goals.flatMap((g) =>
    g.tactics.map((tactic) => ({
      ...tactic,
      ...effectiveTacticForWeek(tactic, week),
      goalColor: g.color,
      goalTitle: g.title,
    }))
  );

  if (allTactics.length === 0) {
    return (
      <div className={`card ${styles.emptyCard}`}>
        <p>{t('week.grid.empty')}</p>
      </div>
    );
  }

  return (
    <div className={`card ${styles.wrap}`} role="region" aria-label={t('week.grid.label')} tabIndex={0}>
      {feedback.error && <p role="alert" className="completion-error">{feedback.error}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.tacticHeader}>{t('week.grid.tactic')}</th>
            {weekdayLabels.short.map((label, weekday) => (
              <th key={label} scope="col" className={weekday === today ? styles.todayColumn : undefined}>
                {label}
                {weekday === today && <span className={styles.todayBadge}>{t('week.grid.today')}</span>}
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
                      aria-label={t('week.grid.unscheduled')}>
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
                        aria-label={t('week.grid.cell', {
                          title: tactic.title,
                          day: weekdayLabels.short[weekday],
                          state: done ? t('week.grid.cellDone') : t('week.grid.cellTodo'),
                        })}
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
          <span className={`${styles.legendSwatch} ${styles.legendDone}`} aria-hidden="true">✓</span>{t('week.grid.legendDone')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} aria-hidden="true" />{t('week.grid.legendPlanned')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendUnscheduled}`} aria-hidden="true">·</span>
          {t('week.grid.legendUnplanned')}
        </span>
        {today !== null && (
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendToday}`} aria-hidden="true" />
            {t('week.grid.legendToday', { day: weekdayLabels.full[today] })}
          </span>
        )}
      </p>
    </div>
  );
}
