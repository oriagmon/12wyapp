import { useState } from 'react';
import type { Goal, Tactic } from '../lib/types';
import { GOAL_COLOR_HEX } from '../lib/colors';

import { TacticForm, type TacticFormValues } from './TacticForm';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './GoalCard.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

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
  const weekdayLabels = useWeekdayLabels();
  const [editing, setEditing] = useState(false);
  // Deleting a tactic also drops every completion and piece of evidence recorded against it,
  // so it gets the same two-step confirmation a goal already had instead of firing on the
  // first tap of a red button that repeats on every single row.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { t } = useTranslation();
  const del = useAsyncStatus();
  const nextWeekOverride = tactic.overrides?.find(
    (override) => override.week === currentWeek + 1
  );

  if (editing) {
    return (
      <TacticForm
        initial={tactic}
        currentWeek={currentWeek}
        submitLabel={t('goals.tactic.saveSubmit')}
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
          {t('goals.tactic.weeks', {
            days: tactic.weekdays.map((d) => weekdayLabels.short[d]).join(', '),
            start: tactic.startWeek,
            end: tactic.endWeek,
          })}
        </span>
        {nextWeekOverride && (
          <span className={styles.adaptation}>
            {t('goals.tactic.override', {
              week: nextWeekOverride.week,
              title: nextWeekOverride.title,
              days: nextWeekOverride.weekdays.map((day) => weekdayLabels.short[day]).join(', '),
            })}
          </span>
        )}
      </div>
      {isOwner && (
        <div className={styles.tacticActions}>
          {confirmingDelete ? (
            <span className={styles.inlineConfirm} role="alertdialog" aria-label={t('goals.tactic.deleteLabel', { title: tactic.title })}>
              <span className={styles.inlineConfirmText}>{t('goals.tactic.deleteConfirm')}</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => del.run(onDelete)}
                disabled={del.status === 'saving'}
              >
                {t('goals.tactic.deleteYes')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
                {t('goals.tactic.deleteNo')}
              </button>
              <StatusBadge status={del.status} error={del.error} />
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                {t('goals.tactic.edit')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmingDelete(true)}
                aria-label={t('goals.tactic.deleteLabel', { title: tactic.title })}
              >
                {t('goals.tactic.delete')}
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
  const { t } = useTranslation();
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
          aria-label={t('goals.name.label')}
        />
        <StatusBadge status={rename.status} error={rename.error} />
        {isOwner && !confirmingDelete && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
            {t('goals.delete')}
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div className={styles.confirmBox} role="alertdialog">
          <p>{t('goals.delete.confirm')}</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => del.run(onDelete)}
              disabled={del.status === 'saving'}
            >
              {t('goals.delete.yes')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(false)}>
              {t('goals.delete.cancel')}
            </button>
            <StatusBadge status={del.status} error={del.error} />
          </div>
        </div>
      )}

      <div className={styles.tactics}>
        {goal.tactics.length === 0 && <p className={styles.emptyTactics}>{t('goals.tactic.none')}</p>}
        {goal.tactics.map((goalTactic) => (
          <TacticRow
            key={goalTactic.id}
            tactic={goalTactic}
            isOwner={isOwner}
            currentWeek={currentWeek}
            onUpdate={(values) => onUpdateTactic(goalTactic.id, values)}
            onDelete={() => onDeleteTactic(goalTactic.id)}
          />
        ))}
      </div>

      {isOwner && (
        <div className={styles.addTacticSection}>
          {addingTactic ? (
            <TacticForm
              currentWeek={currentWeek}
              submitLabel={t('goals.tactic.addSubmit')}
              onSubmit={onCreateTactic}
              onCancel={() => setAddingTactic(false)}
            />
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingTactic(true)}>
              {t('goals.tactic.add')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
