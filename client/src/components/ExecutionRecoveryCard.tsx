import { useMemo, useState } from 'react';
import type { Goal } from '../lib/types';
import { effectiveTacticForWeek } from '../lib/scoring';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { WeekdayPicker } from './WeekdayPicker';
import type {
  ExecutionRecoveryPlan,
  ExecutionRiskAssessment,
  ReduceNextWeekInput,
  RecoveryLoadStatus,
} from '../hooks/useExecutionRecovery';
import styles from './ExecutionRecoveryCard.module.css';
import { useTranslation } from '../i18n';

interface ExecutionRecoveryCardProps {
  isOwner: boolean;
  currentWeek: number;
  goals: Goal[];
  risk: ExecutionRiskAssessment | null;
  plan: ExecutionRecoveryPlan | null;
  loadStatus: RecoveryLoadStatus;
  loadError: string | null;
  onSaveManeuver: (note: string) => Promise<ExecutionRecoveryPlan>;
  onReduceNextWeek: (input: ReduceNextWeekInput) => Promise<ExecutionRecoveryPlan>;
  onResolve: () => Promise<ExecutionRecoveryPlan>;
  onReopen: () => Promise<ExecutionRecoveryPlan>;
}

type Mode = 'summary' | 'choose' | 'reduce' | 'maneuver';

const STRATEGY_KEY: Record<ExecutionRecoveryPlan['strategy'], string> = {
  reduce_next_week: 'week.recovery.strategyReduce',
  maneuver: 'week.recovery.strategyManeuver',
};

function RiskExplanation({ risk }: { risk: ExecutionRiskAssessment }) {
  const { t } = useTranslation();
  return (
    <ul className={styles.numbers}>
      <li>
        {risk.dueScheduled === 0
          ? t('week.recovery.noneDue')
          : t('week.recovery.dueProgress', {
              done: risk.dueCompleted,
              due: risk.dueScheduled,
              rate: risk.dueCompletionRate ?? '—',
            })}
      </li>
      <li>
        {risk.remainingScheduled === 0
          ? t('week.recovery.allPastDue', { max: risk.maximumAchievableScore ?? '—' })
          : t('week.recovery.remaining', {
              remaining: risk.remainingScheduled,
              max: risk.maximumAchievableScore ?? '—',
              total: risk.totalScheduled,
            })}
      </li>
    </ul>
  );
}

function ManeuverEditor({
  initialNote,
  onSubmit,
  onCancel,
}: {
  initialNote: string;
  onSubmit: (note: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(initialNote);
  const status = useAsyncStatus();
  const canSubmit = note.trim().length > 0;

  const submit = () =>
    status.run(async () => {
      await onSubmit(note.trim());
      onCancel(); // closes the editor — never reached if onSubmit throws (see useAsyncStatus)
    });

  return (
    <div className={styles.editor}>
      <label className={styles.editorLabel} htmlFor="maneuver-note">
        {t('week.recovery.maneuverLabel')}
      </label>
      <textarea
        id="maneuver-note"
        ref={(el) => {
          if (el) autoResizeTextarea(el);
        }}
        className={styles.textarea}
        rows={2}
        value={note}
        placeholder={t('week.recovery.maneuverPlaceholder')}
        onChange={(e) => {
          autoResizeTextarea(e.currentTarget);
          setNote(e.target.value);
        }}
      />
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={submit}>
          {t('week.recovery.saveManeuver')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.action.cancel')}
        </button>
        <StatusBadge status={status.status} error={status.error} />
      </div>
    </div>
  );
}

function ReduceNextWeekEditor({
  goals,
  currentWeek,
  onSubmit,
  onCancel,
}: {
  goals: Goal[];
  currentWeek: number;
  onSubmit: (input: ReduceNextWeekInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const targetWeek = currentWeek + 1;
  const effectiveNextWeekTactics = useMemo(
    () =>
      goals
        .flatMap((g) => g.tactics)
        .filter((tactic) => targetWeek >= tactic.startWeek && targetWeek <= tactic.endWeek)
        .map((tactic) => ({ tactic, effective: effectiveTacticForWeek(tactic, targetWeek) })),
    [goals, targetWeek]
  );

  const [selections, setSelections] = useState<Record<number, number[]>>(() =>
    Object.fromEntries(effectiveNextWeekTactics.map(({ tactic, effective }) => [tactic.id, effective.weekdays]))
  );
  const [note, setNote] = useState('');
  const status = useAsyncStatus();

  const totalBefore = effectiveNextWeekTactics.reduce((sum, { effective }) => sum + effective.weekdays.length, 0);
  const totalAfter = Object.values(selections).reduce((sum, weekdays) => sum + weekdays.length, 0);
  const decreased = totalAfter < totalBefore;
  const atLeastOneRemains = totalAfter >= 1;
  const canSubmit = decreased && atLeastOneRemains && effectiveNextWeekTactics.length > 0;

  const submit = () =>
    status.run(async () => {
      await onSubmit({
        note: note.trim() || undefined,
        tactics: effectiveNextWeekTactics.map(({ tactic }) => ({
          tacticId: tactic.id,
          weekdays: selections[tactic.id] ?? [],
        })),
      });
      onCancel();
    });

  if (effectiveNextWeekTactics.length === 0) {
    return (
      <div className={styles.editor}>
        <p className={styles.text}>{t('week.recovery.nothingToReduce', { week: targetWeek })}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('week.recovery.back')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <p className={styles.text}>
        {t('week.recovery.reduceHint', { week: targetWeek })}
      </p>
      {effectiveNextWeekTactics.map(({ tactic, effective }) => (
        <div key={tactic.id} className={styles.tacticRow}>
          <strong className={styles.tacticTitle}>{effective.title}</strong>
          <WeekdayPicker value={selections[tactic.id] ?? []} onChange={(next) => setSelections((s) => ({ ...s, [tactic.id]: next }))} />
        </div>
      ))}
      <label className={styles.editorLabel} htmlFor="reduce-note">
        {t('week.recovery.noteOptional')}
      </label>
      <textarea
        id="reduce-note"
        ref={(el) => {
          if (el) autoResizeTextarea(el);
        }}
        className={styles.textarea}
        rows={1}
        value={note}
        onChange={(e) => {
          autoResizeTextarea(e.currentTarget);
          setNote(e.target.value);
        }}
      />
      {!decreased && (
        <p className={styles.validationText}>{t('week.recovery.mustDecrease', { total: totalBefore })}</p>
      )}
      {decreased && !atLeastOneRemains && (
        <p className={styles.validationText}>{t('week.recovery.mustKeepOne')}</p>
      )}
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={submit}>
          {t('week.recovery.saveReduction', { before: totalBefore, after: totalAfter })}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.action.cancel')}
        </button>
        <StatusBadge status={status.status} error={status.error} />
      </div>
    </div>
  );
}

/**
 * Prominent-but-non-alarming Home card for execution risk. Owner: an explanation + a choice
 * between reducing next week's workload or committing to a concrete rescue maneuver, while no
 * plan yet exists and risk is flagged; once a plan exists (active or resolved), it stays
 * pinned/readable regardless of whether live metrics later recover, with resolve/reopen
 * controls for an active *maneuver* only — a resolved `reduce_next_week` plan is a completed,
 * one-way action (its tactic_week_overrides are never undone) and so never offers a reopen
 * control; the server rejects reopening one outright too. Partner (read-only dashboard):
 * nothing shown for an absent/not-yet-created plan; a read-only status once one exists.
 *
 * A load failure never silently hides the feature: a compact inline Hebrew error is shown
 * (for both owner and partner) alongside whatever last-known-good risk/plan data is still
 * available, if any.
 */
export function ExecutionRecoveryCard({
  isOwner,
  currentWeek,
  goals,
  risk,
  plan,
  loadStatus,
  loadError,
  onSaveManeuver,
  onReduceNextWeek,
  onResolve,
  onReopen,
}: ExecutionRecoveryCardProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('summary');
  const resolveStatus = useAsyncStatus();
  const reopenStatus = useAsyncStatus();

  if (loadStatus === 'loading' || loadStatus === 'idle') return null;

  const errorBanner =
    loadStatus === 'error' ? (
      <p className={styles.loadErrorText} role="alert">
        {t('week.recovery.loadError')}{loadError ? ` — ${loadError}` : ''}
      </p>
    ) : null;

  if (!risk) {
    // Never loaded successfully yet (no active cycle, or the very first load itself failed) —
    // only render something if there's an error worth surfacing; otherwise there is genuinely
    // nothing to show (no active cycle at all).
    if (!errorBanner) return null;
    return <section className={`card ${styles.card}`}>{errorBanner}</section>;
  }

  const hasPlan = plan !== null;

  if (!isOwner) {
    if (!hasPlan) return errorBanner ? <section className={`card ${styles.card}`}>{errorBanner}</section> : null;
    return (
      <section className={`card ${styles.card}`} role="status">
        {errorBanner}
        <h3 className={styles.title}>{t('week.recovery.planTitleWeek', { week: plan.week })}</h3>
        <p className={styles.text}>{t('week.recovery.strategyLine', { strategy: t(STRATEGY_KEY[plan.strategy]) })}</p>
        {plan.note && <p className={styles.summary}>{plan.note}</p>}
        <p className={plan.status === 'resolved' ? styles.completeText : styles.pendingText}>
          {plan.status === 'resolved' ? t('week.recovery.resolved') : t('week.recovery.pending')}
        </p>
      </section>
    );
  }

  if (!hasPlan && !risk.triggered) {
    return errorBanner ? <section className={`card ${styles.card}`}>{errorBanner}</section> : null;
  }

  if (!hasPlan) {
    // risk.triggered, no plan yet — explain + offer the two CTAs (or the chosen editor inline).
    return (
      <section className={`card ${styles.card}`} aria-label={t('week.recovery.alertLabel')}>
        {errorBanner}
        <h3 className={styles.title}>{t('week.recovery.alertTitle')}</h3>
        <RiskExplanation risk={risk} />
        {mode === 'summary' && (
          <div className={styles.ctaRow}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode('reduce')} disabled={currentWeek >= 12}>
              {t('week.recovery.ctaReduce')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('maneuver')}>
              {t('week.recovery.ctaManeuver')}
            </button>
          </div>
        )}
        {currentWeek >= 12 && mode === 'summary' && (
          <p className={styles.text}>{t('week.recovery.week12')}</p>
        )}
        {mode === 'reduce' && (
          <ReduceNextWeekEditor goals={goals} currentWeek={currentWeek} onSubmit={onReduceNextWeek} onCancel={() => setMode('summary')} />
        )}
        {mode === 'maneuver' && (
          <ManeuverEditor initialNote="" onSubmit={onSaveManeuver} onCancel={() => setMode('summary')} />
        )}
      </section>
    );
  }

  // A plan already exists (active or resolved) — stays pinned/visible regardless of what the
  // live risk numbers currently say.
  const isManeuver = plan.strategy === 'maneuver';
  const activeManeuver = isManeuver && plan.status === 'active';
  // Defensive only: a reduce_next_week plan is always created already 'resolved' and the
  // server now rejects reopening it, so this should never actually be 'active' going forward
  // — but if it somehow were (e.g. legacy data), still offer a way to mark it resolved rather
  // than leaving the plan with no controls at all.
  const activeReductionNeedingResolve = !isManeuver && plan.status === 'active';

  return (
    <section className={`card ${styles.card}`}>
      {errorBanner}
      <h3 className={styles.title}>
        {plan.status === 'resolved' ? t('week.recovery.planResolvedTitle') : t('week.recovery.planActiveTitle')}
      </h3>
      <p className={styles.text}>{t('week.recovery.strategyLine', { strategy: t(STRATEGY_KEY[plan.strategy]) })}</p>
      {plan.strategy === 'reduce_next_week' && plan.adjustment && (
        <p className={styles.summary}>
          {t('week.recovery.reducedSummary', {
            before: plan.adjustment.before.reduce((sum, b) => sum + b.weekdays.length, 0),
            week: plan.adjustment.targetWeek,
            after: plan.adjustment.after.reduce((sum, a) => sum + a.weekdays.length, 0),
          })}
        </p>
      )}
      {plan.note && !activeManeuver && <p className={styles.summary}>{plan.note}</p>}

      {activeManeuver && mode !== 'maneuver' && (
        <>
          <p className={styles.summary}>{plan.note}</p>
          <div className={styles.ctaRow}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('maneuver')}>
              {t('week.recovery.editManeuver')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => resolveStatus.run(onResolve)}>
              {t('week.recovery.markResolved')}
            </button>
            <StatusBadge status={resolveStatus.status} error={resolveStatus.error} />
          </div>
        </>
      )}
      {activeManeuver && mode === 'maneuver' && (
        <ManeuverEditor initialNote={plan.note} onSubmit={onSaveManeuver} onCancel={() => setMode('summary')} />
      )}

      {activeReductionNeedingResolve && (
        <div className={styles.ctaRow}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => resolveStatus.run(onResolve)}>
            {t('week.recovery.markResolved')}
          </button>
          <StatusBadge status={resolveStatus.status} error={resolveStatus.error} />
        </div>
      )}

      {/* Reopen is offered only for a resolved *maneuver* — a resolved reduce_next_week plan
          is a completed, one-way action (its overrides are never undone), so no reopen
          control is ever shown for it; the server rejects that request outright too. */}
      {isManeuver && plan.status === 'resolved' && (
        <div className={styles.ctaRow}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => reopenStatus.run(onReopen)}>
            {t('week.recovery.reopen')}
          </button>
          <StatusBadge status={reopenStatus.status} error={reopenStatus.error} />
        </div>
      )}
    </section>
  );
}
