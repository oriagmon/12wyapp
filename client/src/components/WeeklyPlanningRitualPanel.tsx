import { useEffect, useMemo, useState } from 'react';
import type { Cycle, Goal, WeekScore } from '../lib/types';
import { effectiveTacticForWeek, formatScore } from '../lib/scoring';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import type { RitualLoadStatus, WeeklyPlanningDraftPatch, WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import styles from './WeeklyPlanningRitualPanel.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

interface WeeklyPlanningRitualPanelProps {
  cycle: Cycle;
  goals: Goal[];
  weekScores: WeekScore[];
  isOwner: boolean;
  ritual: WeeklyPlanningRitual | null;
  loadStatus: RitualLoadStatus;
  loadError: string | null;
  onSaveDraft: (patch: WeeklyPlanningDraftPatch) => Promise<WeeklyPlanningRitual>;
  onComplete: () => Promise<WeeklyPlanningRitual>;
  onReopen: () => Promise<WeeklyPlanningRitual>;
  onNavigateToTactics: () => void;
}

/**
 * Guided weekly planning ritual: reviews the current week, reviews (read-only) the effective
 * tactics scheduled for the next cycle week, and commits to a focus + concrete commitment for
 * that next week. Tactic *editing* itself always happens in the Goals/Tactics section — this
 * panel only links there, never duplicating that logic.
 */
export function WeeklyPlanningRitualPanel({
  cycle,
  goals,
  weekScores,
  isOwner,
  ritual,
  loadStatus,
  loadError,
  onSaveDraft,
  onComplete,
  onReopen,
  onNavigateToTactics,
}: WeeklyPlanningRitualPanelProps) {
  const weekdayLabels = useWeekdayLabels();
  const { t } = useTranslation();
  const currentWeek = cycle.currentWeek;
  const targetWeek = currentWeek + 1;
  const cycleFinished = currentWeek >= 12;
  const currentWeekScore = weekScores.find((w) => w.week === currentWeek)?.score ?? null;

  const [workedWell, setWorkedWell] = useState('');
  const [improveNext, setImproveNext] = useState('');
  const [tacticsReviewed, setTacticsReviewed] = useState(false);
  const [weeklyFocus, setWeeklyFocus] = useState('');
  const [commitment, setCommitment] = useState('');

  useEffect(() => {
    setWorkedWell(ritual?.workedWell ?? '');
    setImproveNext(ritual?.improveNext ?? '');
    setTacticsReviewed(ritual?.tacticsReviewed ?? false);
    setWeeklyFocus(ritual?.weeklyFocus ?? '');
    setCommitment(ritual?.commitment ?? '');
  }, [ritual?.id, ritual?.updatedAt]);

  const saveStatus = useAsyncStatus();
  const completeStatus = useAsyncStatus();

  const targetTactics = useMemo(
    () =>
      goals.flatMap((goal) =>
        goal.tactics
          .filter((tactic) => targetWeek >= tactic.startWeek && targetWeek <= tactic.endWeek)
          .map((tactic) => {
            const effective = effectiveTacticForWeek(tactic, targetWeek);
            return { id: tactic.id, goalTitle: goal.title, title: effective.title, weekdays: effective.weekdays };
          })
      ),
    [goals, targetWeek]
  );

  if (cycleFinished) {
    return (
      <section className={`card ${styles.panel}`}>
        <h2 className={styles.title}>{t('week.ritual.title')}</h2>
        <p className={styles.finishedMessage}>
          {t('week.ritual.finished')}
        </p>
      </section>
    );
  }

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <section className="card" style={{ padding: 24 }}>{t('week.ritual.loading')}</section>;
  }

  if (loadStatus === 'error') {
    return (
      <section className="card" style={{ padding: 24, color: 'var(--danger)' }}>
        {loadError}
      </section>
    );
  }

  const isComplete = ritual?.status === 'complete';
  const editable = isOwner && !isComplete;
  // A bare greyed-out button gave no clue what was missing, and this screen is only opened
  // about twice a week — long enough to forget the rules between visits.
  const missingSteps = [
    !tacticsReviewed && t('week.ritual.missingTactics'),
    weeklyFocus.trim().length === 0 && t('week.ritual.missingFocus'),
    commitment.trim().length === 0 && t('week.ritual.missingCommitment'),
  ].filter((step): step is string => typeof step === 'string');
  const canComplete = missingSteps.length === 0;

  const currentDraft: WeeklyPlanningDraftPatch = { workedWell, improveNext, tacticsReviewed, weeklyFocus, commitment };

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('week.ritual.headingTarget', { week: targetWeek })}</h2>
          <p className={styles.subtitle}>
            {t('week.ritual.subtitle', { week: currentWeek })}
            {' '}{t('week.ritual.subtitleShared')}
          </p>
        </div>
        {isComplete && <span className={styles.completeBadge}>{t('week.ritual.completeBadge')}</span>}
      </div>

      <section className={styles.step} aria-label={t('week.ritual.step1Label')}>
        <h3 className={styles.stepTitle}>{t('week.ritual.step1Title', { week: currentWeek })}</h3>
        <p className={styles.stepScore}>
          {t('week.ritual.weekScore', { week: currentWeek, score: formatScore(currentWeekScore) })}
        </p>
        <label className={styles.field}>
          <span className={styles.label}>{t('week.ritual.workedWell')}</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={workedWell}
            readOnly={!editable}
            placeholder={t('week.ritual.workedWellPlaceholder')}
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setWorkedWell(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('week.ritual.improveNext')}</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={improveNext}
            readOnly={!editable}
            placeholder={t('week.ritual.improveNextPlaceholder')}
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setImproveNext(e.target.value);
            }}
          />
        </label>
      </section>

      <section className={styles.step} aria-label={t('week.ritual.step2Label')}>
        <h3 className={styles.stepTitle}>{t('week.ritual.step2Title', { week: targetWeek })}</h3>
        {targetTactics.length === 0 ? (
          <p className={styles.emptyTactics}>{t('week.ritual.noTactics', { week: targetWeek })}</p>
        ) : (
          <ul className={styles.tacticList}>
            {targetTactics.map((tactic) => (
              <li key={tactic.id} className={styles.tacticItem}>
                <span className={styles.tacticGoal}>{tactic.goalTitle}</span>
                <span className={styles.tacticTitle}>{tactic.title}</span>
                <span className={styles.tacticDays}>{tactic.weekdays.map((day) => weekdayLabels.short[day]).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNavigateToTactics}>
          {t('week.ritual.goToTactics')}
        </button>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={tacticsReviewed}
            disabled={!editable}
            onChange={(e) => setTacticsReviewed(e.target.checked)}
          />
          <span>{t('week.ritual.tacticsReviewed')}</span>
        </label>
      </section>

      <section className={styles.step} aria-label={t('week.ritual.step3Label')}>
        <h3 className={styles.stepTitle}>{t('week.ritual.step3Title', { week: targetWeek })}</h3>
        <label className={styles.field}>
          <span className={styles.label}>{t('week.ritual.focusLabel')}</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={weeklyFocus}
            readOnly={!editable}
            placeholder={t('week.ritual.focusPlaceholder')}
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setWeeklyFocus(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('week.ritual.commitmentLabel')}</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={commitment}
            readOnly={!editable}
            placeholder={t('week.ritual.commitmentPlaceholder')}
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setCommitment(e.target.value);
            }}
          />
        </label>
      </section>

      {editable && (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => saveStatus.run(() => onSaveDraft(currentDraft))}
          >
            {t('week.ritual.saveDraft')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canComplete}
            aria-describedby={canComplete ? undefined : 'ritual-missing-steps'}
            onClick={() =>
              completeStatus.run(async () => {
                await onSaveDraft(currentDraft);
                await onComplete();
              })
            }
          >
            {t('week.ritual.complete')}
          </button>
          <StatusBadge status={saveStatus.status} error={saveStatus.error} />
          <StatusBadge status={completeStatus.status} error={completeStatus.error} />
          {!canComplete && (
            <p id="ritual-missing-steps" className={styles.missingSteps}>
              {t('week.ritual.missingPrefix', { count: missingSteps.length })}
              {missingSteps.join(' · ')}
            </p>
          )}
        </div>
      )}

      {isOwner && isComplete && (
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={() => onReopen()}>
            {t('week.ritual.reopen')}
          </button>
        </div>
      )}

      {!isOwner && (
        <p className={styles.readOnlyNote}>{t('week.ritual.readOnly')}</p>
      )}
    </section>
  );
}
