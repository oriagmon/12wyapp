import { useRef, useState } from 'react';
import type { Goal, GoalColor } from '../lib/types';
import { GoalCard } from './GoalCard';
import type { TacticFormValues } from './TacticForm';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './GoalsPanel.module.css';
import { useTranslation } from '../i18n';

const MAX_GOALS = 3;

function AddGoalForm({
  goalsCount,
  onCreateGoal,
  autoFocus,
}: {
  goalsCount: number;
  onCreateGoal: (title: string, color?: GoalColor) => Promise<unknown>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const create = useAsyncStatus();
  const inputRef = useRef<HTMLInputElement>(null);

  const submitNewGoal = () => {
    if (newGoalTitle.trim().length === 0) return;
    create.run(() => onCreateGoal(newGoalTitle.trim())).then((res) => {
      if (res !== undefined) setNewGoalTitle('');
    });
  };

  return (
    <div className={`card ${styles.addGoal}`}>
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        placeholder={t('goals.add.placeholder', { count: goalsCount, max: MAX_GOALS })}
        value={newGoalTitle}
        onChange={(e) => setNewGoalTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitNewGoal();
        }}
        aria-label={t('goals.add.label')}
      />
      <button type="button" className="btn btn-primary btn-sm" onClick={submitNewGoal}>
        {t('goals.add.submit')}
      </button>
      <StatusBadge status={create.status} error={create.error} />
    </div>
  );
}

export function GoalsPanel({
  goals,
  isOwner,
  currentWeek,
  onCreateGoal,
  onRenameGoal,
  onDeleteGoal,
  onCreateTactic,
  onUpdateTactic,
  onDeleteTactic,
}: {
  goals: Goal[];
  isOwner: boolean;
  currentWeek: number;
  onCreateGoal: (title: string, color?: GoalColor) => Promise<unknown>;
  onRenameGoal: (goalId: number, title: string) => Promise<unknown>;
  onDeleteGoal: (goalId: number) => Promise<unknown>;
  onCreateTactic: (goalId: number, values: TacticFormValues) => Promise<unknown>;
  onUpdateTactic: (tacticId: number, values: TacticFormValues) => Promise<unknown>;
  onDeleteTactic: (tacticId: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [showFirstGoalForm, setShowFirstGoalForm] = useState(false);
  const [view, setView] = useState<'currentWeek' | 'allWeeks'>('currentWeek');

  if (goals.length === 0) {
    if (!isOwner) {
      return (
        <div className={`card ${styles.emptyState}`}>
          <h3 className={styles.emptyTitle}>{t('goals.empty.partner.title')}</h3>
          <p className={styles.emptyText}>{t('goals.empty.partner.body')}</p>
        </div>
      );
    }
    return (
      <section className={styles.wrap}>
        <div className={`card ${styles.emptyState}`}>
          <h3 className={styles.emptyTitle}>{t('goals.empty.title')}</h3>
          <p className={styles.emptyText}>
            {t('goals.empty.body')}
          </p>
          {showFirstGoalForm ? (
            <AddGoalForm goalsCount={0} onCreateGoal={onCreateGoal} autoFocus />
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setShowFirstGoalForm(true)}>
              {t('goals.empty.cta')}
            </button>
          )}
        </div>
      </section>
    );
  }

  const visibleGoals =
    view === 'currentWeek'
      ? goals.filter((goal) =>
          goal.tactics.some(
            (tactic) => currentWeek >= tactic.startWeek && currentWeek <= tactic.endWeek
          )
        )
      : goals;

  return (
    <section className={styles.wrap}>
      <div className={styles.viewToggle} role="group" aria-label={t('goals.view.label')}>
        <button
          type="button"
          className={view === 'currentWeek' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          aria-pressed={view === 'currentWeek'}
          onClick={() => setView('currentWeek')}
        >
          {t('goals.view.currentWeek', { week: currentWeek })}
        </button>
        <button
          type="button"
          className={view === 'allWeeks' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          aria-pressed={view === 'allWeeks'}
          onClick={() => setView('allWeeks')}
        >
          {t('goals.view.allWeeks')}
        </button>
      </div>

      <div className={styles.grid}>
        {visibleGoals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            isOwner={isOwner}
            currentWeek={currentWeek}
            currentWeekView={view === 'currentWeek'}
            onRename={(title) => onRenameGoal(goal.id, title)}
            onDelete={() => onDeleteGoal(goal.id)}
            onCreateTactic={(values) => onCreateTactic(goal.id, values)}
            onUpdateTactic={onUpdateTactic}
            onDeleteTactic={onDeleteTactic}
          />
        ))}
      </div>
      {visibleGoals.length === 0 && (
        <div className={`card ${styles.currentWeekEmpty}`}>
          {t('goals.view.currentWeekEmpty', { week: currentWeek })}
        </div>
      )}

      {view === 'allWeeks' && isOwner && goals.length < MAX_GOALS && (
        <AddGoalForm goalsCount={goals.length} onCreateGoal={onCreateGoal} />
      )}
      {view === 'allWeeks' && goals.length >= MAX_GOALS && isOwner && (
        <p className={styles.limitNote}>{t('goals.limit')}</p>
      )}
    </section>
  );
}
