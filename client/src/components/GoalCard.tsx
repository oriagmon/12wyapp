import { useState } from 'react';
import type { Goal, Tactic } from '../lib/types';
import { GOAL_COLOR_HEX } from '../lib/colors';
import { WEEKDAY_LABELS_HE } from '../lib/scoring';
import { TacticForm, type TacticFormValues } from './TacticForm';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './GoalCard.module.css';

function TacticRow({
  tactic,
  isOwner,
  currentWeek,
  onUpdate,
  onDelete,
}: {
  tactic: Tactic;
  isOwner: boolean;
  currentWeek: number;
  onUpdate: (values: TacticFormValues) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  // Deleting a tactic also drops every completion and piece of evidence recorded against it,
  // so it gets the same two-step confirmation a goal already had instead of firing on the
  // first tap of a red button that repeats on every single row.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const del = useAsyncStatus();
  const nextWeekOverride = tactic.overrides?.find(
    (override) => override.week === currentWeek + 1
  );

  if (editing) {
    return (
      <TacticForm
        initial={tactic}
        currentWeek={currentWeek}
        submitLabel="שמירה"
        onSubmit={onUpdate}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={styles.tacticRow}>
      <div className={styles.tacticInfo}>
        <span className={styles.tacticTitle}>{tactic.title}</span>
        <span className={styles.tacticMeta}>
          {tactic.weekdays.map((d) => WEEKDAY_LABELS_HE[d]).join(', ')} · שבועות {tactic.startWeek}–
          {tactic.endWeek}
        </span>
        {nextWeekOverride && (
          <span className={styles.adaptation}>
            שבוע {nextWeekOverride.week}: {nextWeekOverride.title} ·{' '}
            {nextWeekOverride.weekdays.map((day) => WEEKDAY_LABELS_HE[day]).join(', ')}
          </span>
        )}
      </div>
      {isOwner && (
        <div className={styles.tacticActions}>
          {confirmingDelete ? (
            <span className={styles.inlineConfirm} role="alertdialog" aria-label={`מחיקת הטקטיקה ${tactic.title}`}>
              <span className={styles.inlineConfirmText}>למחוק? גם הביצועים והעדויות שלה יימחקו.</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => del.run(onDelete)}
                disabled={del.status === 'saving'}
              >
                כן, למחוק
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
                לא
              </button>
              <StatusBadge status={del.status} error={del.error} />
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                עריכה
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`מחיקת הטקטיקה ${tactic.title}`}
              >
                מחיקה
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function GoalCard({
  goal,
  isOwner,
  currentWeek,
  onRename,
  onDelete,
  onCreateTactic,
  onUpdateTactic,
  onDeleteTactic,
}: {
  goal: Goal;
  isOwner: boolean;
  currentWeek: number;
  onRename: (title: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onCreateTactic: (values: TacticFormValues) => Promise<unknown>;
  onUpdateTactic: (tacticId: number, values: TacticFormValues) => Promise<unknown>;
  onDeleteTactic: (tacticId: number) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(goal.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingTactic, setAddingTactic] = useState(false);
  const rename = useAsyncStatus();
  const del = useAsyncStatus();

  const commitRename = () => {
    if (!isOwner || title.trim() === goal.title || title.trim().length === 0) return;
    rename.run(() => onRename(title.trim()));
  };

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <span className={styles.colorDot} style={{ background: GOAL_COLOR_HEX[goal.color] }} aria-hidden="true" />
        <input
          type="text"
          value={title}
          disabled={!isOwner}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          className={styles.titleInput}
          aria-label="שם המטרה"
        />
        <StatusBadge status={rename.status} error={rename.error} />
        {isOwner && !confirmingDelete && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
            מחיקת מטרה
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div className={styles.confirmBox} role="alertdialog">
          <p>מחיקת המטרה תמחק גם את כל הטקטיקות והביצועים המשויכים אליה. לאשר?</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => del.run(onDelete)}
              disabled={del.status === 'saving'}
            >
              אישור מחיקה
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
              ביטול
            </button>
            <StatusBadge status={del.status} error={del.error} />
          </div>
        </div>
      )}

      <div className={styles.tactics}>
        {goal.tactics.length === 0 && <p className={styles.emptyTactics}>אין עדיין טקטיקות למטרה זו.</p>}
        {goal.tactics.map((t) => (
          <TacticRow
            key={t.id}
            tactic={t}
            isOwner={isOwner}
            currentWeek={currentWeek}
            onUpdate={(values) => onUpdateTactic(t.id, values)}
            onDelete={() => onDeleteTactic(t.id)}
          />
        ))}
      </div>

      {isOwner && (
        <div className={styles.addTacticSection}>
          {addingTactic ? (
            <TacticForm
              currentWeek={currentWeek}
              submitLabel="הוספה"
              onSubmit={onCreateTactic}
              onCancel={() => setAddingTactic(false)}
            />
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingTactic(true)}>
              + הוספת טקטיקה
            </button>
          )}
        </div>
      )}
    </div>
  );
}
