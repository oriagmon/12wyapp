import { useState } from 'react';
import { WeekdayPicker } from './WeekdayPicker';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { WEEKDAY_LABELS_HE } from '../lib/scoring';
import styles from './NextWeekTacticAdjuster.module.css';

export interface NextWeekTactic {
  id: number;
  goalId: number;
  goalTitle: string;
  /** Title as it will apply next week — the adaptation if one exists, otherwise the baseline. */
  title: string;
  weekdays: number[];
  /** True when this row already carries an adaptation for the upcoming week. */
  adapted: boolean;
  /** Baseline the tactic returns to when the adaptation is removed. */
  baseTitle: string;
  baseWeekdays: number[];
  /** A tactic scheduled for the upcoming week only, rather than an ongoing one. */
  nextWeekOnly: boolean;
}

export interface NextWeekTacticAdjusterProps {
  targetWeek: number;
  tactics: NextWeekTactic[];
  goals: { id: number; title: string }[];
  editable: boolean;
  onAdapt: (tacticId: number, values: { title: string; weekdays: number[] }) => Promise<unknown>;
  onResetAdaptation: (tacticId: number) => Promise<unknown>;
  onAddNextWeekTactic: (values: { goalId: number; title: string; weekdays: number[] }) => Promise<unknown>;
}

function daysLabel(weekdays: number[]): string {
  return weekdays.map((day) => WEEKDAY_LABELS_HE[day]).join(' · ');
}

/**
 * Lets the upcoming week be tuned without touching the plan for the rest of the cycle: a
 * tactic's load can be dialled up or down, and a one-off tactic can be added, for that single
 * week. Both are the normal outcome of a weekly review — "three gym sessions was too many while
 * travelling, make it one" — and neither should rewrite what was agreed for the whole cycle.
 */
export function NextWeekTacticAdjuster({
  targetWeek, tactics, goals, editable, onAdapt, onResetAdaptation, onAddNextWeekTactic,
}: NextWeekTacticAdjusterProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className={styles.wrap}>
      {tactics.length === 0 ? (
        <p className={styles.empty}>אין טקטיקות מתוזמנות לשבוע {targetWeek}.</p>
      ) : (
        <ul className={styles.list}>
          {tactics.map((tactic) => (
            <li key={tactic.id} className={styles.item}>
              {editingId === tactic.id ? (
                <AdaptForm
                  tactic={tactic}
                  targetWeek={targetWeek}
                  onSubmit={async (values) => {
                    await onAdapt(tactic.id, values);
                    setEditingId(null);
                  }}
                  onReset={async () => {
                    await onResetAdaptation(tactic.id);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <span className={styles.goal}>{tactic.goalTitle}</span>
                  <span className={styles.title}>{tactic.title}</span>
                  <span className={styles.days}>{daysLabel(tactic.weekdays)}</span>
                  <span className={styles.tags}>
                    {tactic.nextWeekOnly && (
                      <span className={styles.tagOnce}>לשבוע {targetWeek} בלבד</span>
                    )}
                    {tactic.adapted && !tactic.nextWeekOnly && (
                      <span className={styles.tagAdapted}>מותאם לשבוע {targetWeek}</span>
                    )}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditingId(tactic.id)}
                      aria-label={`התאמת "${tactic.title}" לשבוע ${targetWeek}`}
                    >
                      התאמה
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (adding ? (
        <AddForm
          targetWeek={targetWeek}
          goals={goals}
          onSubmit={async (values) => {
            await onAddNextWeekTactic(values);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        goals.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            + הוספת טקטיקה לשבוע {targetWeek} בלבד
          </button>
        )
      ))}
    </div>
  );
}

function AdaptForm({
  tactic, targetWeek, onSubmit, onReset, onCancel,
}: {
  tactic: NextWeekTactic;
  targetWeek: number;
  onSubmit: (values: { title: string; weekdays: number[] }) => Promise<void>;
  onReset: () => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(tactic.title);
  const [weekdays, setWeekdays] = useState<number[]>(tactic.weekdays);
  const status = useAsyncStatus();
  const resetStatus = useAsyncStatus();
  const canSubmit = title.trim().length > 0 && weekdays.length > 0;

  return (
    <div className={styles.form} role="group" aria-label={`התאמה לשבוע ${targetWeek}`}>
      <p className={styles.formHint}>
        השינוי חל על שבוע {targetWeek} בלבד. שאר המחזור נשאר כפי שתוכנן.
      </p>
      <label className={styles.field}>
        <span className={styles.label}>שם הטקטיקה בשבוע {targetWeek}</span>
        <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className={styles.field}>
        <span className={styles.label}>באילו ימים</span>
        <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      </div>
      <div className={styles.formActions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit || status.status === 'saving'}
          onClick={() => status.run(() => onSubmit({ title: title.trim(), weekdays }))}
        >
          שמירה לשבוע {targetWeek}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ביטול
        </button>
        {tactic.adapted && !tactic.nextWeekOnly && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={resetStatus.status === 'saving'}
            onClick={() => resetStatus.run(onReset)}
          >
            חזרה למקורי ({daysLabel(tactic.baseWeekdays)})
          </button>
        )}
        <StatusBadge status={status.status} error={status.error} />
        <StatusBadge status={resetStatus.status} error={resetStatus.error} />
      </div>
    </div>
  );
}

function AddForm({
  targetWeek, goals, onSubmit, onCancel,
}: {
  targetWeek: number;
  goals: { id: number; title: string }[];
  onSubmit: (values: { goalId: number; title: string; weekdays: number[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [goalId, setGoalId] = useState(goals[0]?.id ?? 0);
  const [title, setTitle] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const status = useAsyncStatus();
  const canSubmit = goalId > 0 && title.trim().length > 0 && weekdays.length > 0;

  return (
    <div className={styles.form} role="group" aria-label={`טקטיקה חדשה לשבוע ${targetWeek}`}>
      <p className={styles.formHint}>
        הטקטיקה תופיע בשבוע {targetWeek} בלבד ולא תימשך לשאר המחזור.
      </p>
      <label className={styles.field}>
        <span className={styles.label}>שייכת למטרה</span>
        <select value={goalId} onChange={(e) => setGoalId(Number(e.target.value))}>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>{goal.title}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>מה עושים</span>
        <input
          value={title}
          maxLength={160}
          placeholder={`משהו נקודתי לשבוע ${targetWeek}`}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.label}>באילו ימים</span>
        <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      </div>
      <div className={styles.formActions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit || status.status === 'saving'}
          onClick={() => status.run(() => onSubmit({ goalId, title: title.trim(), weekdays }))}
        >
          הוספה לשבוע {targetWeek}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ביטול
        </button>
        {!canSubmit && <span className={styles.blocked}>צריך שם ולפחות יום אחד</span>}
        <StatusBadge status={status.status} error={status.error} />
      </div>
    </div>
  );
}
