import { useEffect, useMemo, useRef } from 'react';
import type { CommitmentScope, WamDetail } from '../lib/types';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import { WamScoreReview } from './WamScoreReview';
import { AutoSaveTextarea } from './AutoSaveTextarea';
import { WamCommitments } from './WamCommitments';
import { WamPunishments } from './WamPunishments';
import { WamDuePunishments } from './WamDuePunishments';
import { WamCompletionPanel } from './WamCompletionPanel';
import { NextWeekTacticAdjuster, type NextWeekTactic } from './NextWeekTacticAdjuster';
import { effectiveTacticForWeek } from '../lib/scoring';
import { DuoStreakCard } from './DuoStreakCard';
import { GoalsPanel } from './GoalsPanel';
import type { useDashboard } from '../hooks/useDashboard';
import styles from './WamDetailView.module.css';
import { useTranslation } from '../i18n';

type OwnDashboard = ReturnType<typeof useDashboard>;

export function WamDetailView({
  wam,
  searchTarget,
  myUserId,
  onBack,
  onUpdateContent,
  onRate,
  onComplete,
  onSchedule,
  onReopen,
  onAddCommitment,
  onToggleCommitment,
  onUpdateCommitmentLabel,
  onDeleteCommitment,
  onAddPunishment,
  onUpdatePunishmentLabel,
  onReassignPunishment,
  onDeletePunishment,
  onToggleDuePunishment,
  ownDash,
}: {
  wam: WamDetail;
  searchTarget?: Extract<ArchiveSearchTarget, { kind: 'wam' }>;
  myUserId: number;
  onBack: () => void;
  onUpdateContent: (patch: Record<string, string>) => Promise<unknown>;
  onRate: (rating: number) => Promise<unknown>;
  onComplete: (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) => Promise<unknown>;
  onSchedule: (schedule: { nextWamAt: string; nextWamDurationMinutes?: number }) => Promise<unknown>;
  onReopen: () => Promise<unknown>;
  onAddCommitment: (label: string, scope: CommitmentScope) => Promise<unknown>;
  onToggleCommitment: (id: number, done: boolean) => Promise<unknown>;
  onUpdateCommitmentLabel: (id: number, label: string) => Promise<unknown>;
  onDeleteCommitment: (id: number) => Promise<unknown>;
  onAddPunishment: (label: string, assignedUserId: number) => Promise<unknown>;
  onUpdatePunishmentLabel: (id: number, label: string) => Promise<unknown>;
  onReassignPunishment: (id: number, assignedUserId: number) => Promise<unknown>;
  onDeletePunishment: (id: number) => Promise<unknown>;
  onToggleDuePunishment: (id: number, done: boolean) => Promise<unknown>;
  ownDash: OwnDashboard;
}) {
  const { t } = useTranslation();
  const myScope: 'a' | 'b' = wam.partnership.initiatorId === myUserId ? 'a' : 'b';
  const isDraft = wam.status === 'draft';
  const locked = wam.isHistorical;
  const editable = isDraft && !locked;
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Mirrors the server, which always resolves an adaptation against the cycle's *current* week —
  // not the week this meeting reviews, which may be older when catching up on a missed WAM.
  const ownCycle = ownDash.bundle?.cycle;
  const nextWeek = ownCycle && ownCycle.isActive && ownCycle.currentWeek + 1 <= 12
    ? ownCycle.currentWeek + 1
    : null;
  const nextWeekTactics = useMemo<NextWeekTactic[]>(() => {
    if (nextWeek === null) return [];
    return (ownDash.bundle?.goals ?? []).flatMap((goal) =>
      goal.tactics
        .filter((tactic) => tactic.startWeek <= nextWeek && tactic.endWeek >= nextWeek)
        .map((tactic) => {
          const effective = effectiveTacticForWeek(tactic, nextWeek);
          return {
            id: tactic.id,
            goalId: goal.id,
            goalTitle: goal.title,
            title: effective.title,
            weekdays: effective.weekdays,
            adapted: (tactic.overrides ?? []).some((item) => item.week === nextWeek),
            baseTitle: tactic.title,
            baseWeekdays: tactic.weekdays,
            nextWeekOnly: tactic.startWeek === nextWeek && tactic.endWeek === nextWeek,
          };
        })
    );
  }, [ownDash.bundle?.goals, nextWeek]);
  const matchId = searchTarget?.commitmentId
    ? `wam-commitment-${searchTarget.commitmentId}`
    : searchTarget?.punishmentId ? `wam-punishment-${searchTarget.punishmentId}` : null;

  useEffect(() => {
    if (!matchId) return;
    const element = wrapperRef.current?.querySelector<HTMLElement>(`#${matchId}`);
    if (!element) return;
    element.dataset.searchMatch = 'true';
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    return () => { delete element.dataset.searchMatch; };
  }, [matchId, wam.id]);

  return (
    <div className={styles.wrap} ref={wrapperRef}>
      <div className={styles.topBar}>
        <button type="button" className="btn btn-ghost btn-sm" data-wam-return-focus onClick={onBack}>
          {t('wams.detail.back')}
        </button>
        <div className={styles.topBarRight}>
          <span className={`${styles.statusBadge} ${isDraft ? styles.draft : styles.complete}`}>
            {isDraft ? t('wams.list.draft') : t('wams.list.complete')}
          </span>
          {locked && <span className={`${styles.statusBadge} ${styles.historical}`}>{t('wams.detail.lockedBadge')}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            {t('wams.detail.print')}
          </button>
        </div>
      </div>

      <div className={styles.printTitle}>
        {t('wams.detail.subtitle', {
          week: wam.week,
          a: wam.partnership.initiatorEmail,
          b: wam.partnership.inviteeEmail,
        })}
      </div>

      <DuoStreakCard duoStreak={wam.duoStreak} />

      <WamCompletionPanel
        key={wam.id}
        wam={wam}
        readOnly={locked || (myUserId !== wam.partnership.initiatorId && myUserId !== wam.partnership.inviteeId)}
        onComplete={onComplete}
        onSchedule={onSchedule}
        onReopen={onReopen}
      />

      <WamScoreReview wam={wam} myScope={myScope} locked={locked} onRate={(r) => onRate(r)} />

      <div className={`card ${styles.contentGrid}`}>
        <AutoSaveTextarea
          label={t('wams.notes.wins')}
          value={wam.wins}
          disabled={!editable}
          placeholder={t('wams.notes.winsPlaceholder')}
          onSave={(v) => onUpdateContent({ wins: v })}
        />
        <AutoSaveTextarea
          label={t('wams.notes.misses')}
          value={wam.misses}
          disabled={!editable}
          placeholder={t('wams.notes.missesPlaceholder')}
          onSave={(v) => onUpdateContent({ misses: v })}
        />
        <AutoSaveTextarea
          label={t('wams.notes.blockers')}
          value={wam.blockers}
          disabled={!editable}
          placeholder={t('wams.notes.blockersPlaceholder')}
          onSave={(v) => onUpdateContent({ blockers: v })}
        />
        <AutoSaveTextarea
          label={t('wams.notes.lessons')}
          value={wam.lessonsLearned}
          disabled={!editable}
          placeholder={t('wams.notes.lessonsPlaceholder')}
          onSave={(v) => onUpdateContent({ lessonsLearned: v })}
        />
        <AutoSaveTextarea
          label={t('wams.notes.adjust')}
          value={wam.adjustmentNotes}
          disabled={!editable}
          placeholder={t('wams.notes.adjustPlaceholder')}
          onSave={(v) => onUpdateContent({ adjustmentNotes: v })}
        />
        <AutoSaveTextarea
          label={t('wams.notes.free')}
          value={wam.notes}
          disabled={!editable}
          placeholder={t('wams.notes.freePlaceholder')}
          onSave={(v) => onUpdateContent({ notes: v })}
        />
      </div>

      <WamCommitments
        commitments={wam.commitments}
        partnership={wam.partnership}
        canEditContent={isDraft}
        locked={locked}
        onAdd={onAddCommitment}
        onToggle={onToggleCommitment}
        onUpdateLabel={onUpdateCommitmentLabel}
        onDelete={onDeleteCommitment}
      />

      <WamDuePunishments wam={wam} onToggle={onToggleDuePunishment} />

      <WamPunishments
        wam={wam}
        myUserId={myUserId}
        sourceEditable={editable}
        canAdd={wam.canAddPunishment}
        onAdd={onAddPunishment}
        onUpdateLabel={onUpdatePunishmentLabel}
        onReassign={onReassignPunishment}
        onDelete={onDeletePunishment}
      />

      {/* The meeting is where "next week looks different" surfaces — a trip, a heavy work week,
          one extra thing you owe your partner. Rewriting the whole cycle for that is wrong, so
          this section only ever writes the upcoming week. Deeper edits stay in the panel below. */}
      {ownDash.loadStatus === 'ready' && ownDash.bundle?.cycle?.isActive && nextWeek !== null && (
        <div className={`card ${styles.ownGoalsSection}`}>
          <h3 className={styles.ownGoalsTitle}>{t('wams.adjust.title', { week: nextWeek })}</h3>
          <p className={styles.ownGoalsHint}>
            {t('wams.adjust.body', { week: nextWeek })}
          </p>
          <NextWeekTacticAdjuster
            targetWeek={nextWeek}
            tactics={nextWeekTactics}
            goals={ownDash.bundle.goals.map((goal) => ({ id: goal.id, title: goal.title }))}
            editable
            onAdapt={(tacticId, values) => ownDash.updateTactic(tacticId, { ...values, scope: 'nextWeek' })}
            onResetAdaptation={(tacticId) => ownDash.resetTacticAdaptation(tacticId)}
            onAddNextWeekTactic={({ goalId, title, weekdays }) => ownDash.createTactic({
              goalId, title, weekdays, startWeek: nextWeek, endWeek: nextWeek,
            })}
          />
        </div>
      )}

      <div className={`card ${styles.ownGoalsSection}`}>
        <h3 className={styles.ownGoalsTitle}>{t('wams.ownGoals.title')}</h3>
        <p className={styles.ownGoalsHint}>
          {t('wams.ownGoals.body')}
        </p>
        {ownDash.loadStatus === 'ready' && ownDash.bundle?.cycle ? (
          <GoalsPanel
            goals={ownDash.bundle.goals}
            isOwner
            currentWeek={ownDash.bundle.cycle.currentWeek}
            onCreateGoal={(title, color) => ownDash.createGoal(title, color)}
            onRenameGoal={(id, title) => ownDash.renameGoal(id, title)}
            onDeleteGoal={(id) => ownDash.deleteGoal(id)}
            onCreateTactic={(goalId, values) => ownDash.createTactic({ goalId, ...values })}
            onUpdateTactic={(tacticId, values) => ownDash.updateTactic(tacticId, values)}
            onDeleteTactic={(tacticId) => ownDash.deleteTactic(tacticId)}
          />
        ) : (
          <p className={styles.ownGoalsHint}>{t('wams.ownGoals.noCycle')}</p>
        )}
      </div>

    </div>
  );
}
