import type { Goal } from '../lib/types';
import { effectiveTacticForWeek, todayWeekday } from '../lib/scoring';
import { GOAL_COLOR_HEX } from '../lib/colors';
import { useCompletionFeedback } from '../hooks/useCompletionFeedback';
import styles from './TodayList.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  const weekdayLabels = useWeekdayLabels();
  const today = todayWeekday();
  const feedback = useCompletionFeedback(`${currentWeek}:${isOwner}:${goals.map((goal) => goal.id).join(',')}`);
  const items = goals.flatMap((g) =>
    g.tactics
      .filter((tactic) => currentWeek >= tactic.startWeek && currentWeek <= tactic.endWeek)
      .map((tactic) => ({
        ...tactic,
        ...effectiveTacticForWeek(tactic, currentWeek),
        goalColor: g.color,
        goalTitle: g.title,
      }))
  );

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.heading}>
        <h3 className={styles.title}>{t('week.today.title', { week: currentWeek })}</h3>
        <p className={styles.subtitle}>{t('week.today.subtitle')}</p>
      </div>
      {feedback.error && <p role="alert" className="completion-error">{feedback.error}</p>}
      {items.length === 0 ? (
        <p className={styles.empty}>{t('week.today.empty')}</p>
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
                    {t('week.today.progress', { done: completedDays, total: item.weekdays.length })}
                  </strong>
                </div>
                <div className={styles.days} aria-label={t('week.today.daysFor', { title: item.title })}>
                  {weekdayLabels.short.map((label, weekday) => {
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
                          aria-label={t('week.grid.cell', {
                            title: item.title,
                            day: label,
                            state: scheduled
                              ? (done ? t('week.today.done') : t('week.today.notDone'))
                              : t('week.today.unscheduled'),
                          })}
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
