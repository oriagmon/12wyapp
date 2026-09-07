import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCycleHistory, useCycleDetail } from '../hooks/useCycleHistory';
import { Timeline } from './Timeline';
import { WeeklyGrid } from './WeeklyGrid';
import { GoalsPanel } from './GoalsPanel';
import { ScoreSummary } from './ScoreSummary';
import { CyclePlanningPanel } from './CyclePlanningPanel';
import { EvidenceGallery } from './EvidenceGallery';
import { ExecutionHeatmap } from './ExecutionHeatmap';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import styles from './CycleHistoryTab.module.css';
import { useTranslation, translateActive } from '../i18n';

const noop = async () => undefined;

export interface CycleHistoryTabProps {
  targetUserId: number;
  selection?: Extract<ArchiveSearchTarget, { kind: 'cycle' }>;
  onSelectionChange?: (selection: Extract<ArchiveSearchTarget, { kind: 'cycle' }> | null) => void;
}

interface HistoryNavigation {
  key: string;
  cycleId: number | null;
  week: number;
  goalId?: number;
  tacticId?: number;
  error: string | null;
}

function navigationFromSelection(key: string, targetUserId: number, selection: CycleHistoryTabProps['selection']): HistoryNavigation {
  if (!selection) return { key, cycleId: null, week: 1, error: null };
  const validId = (id: number) => Number.isInteger(id) && id > 0;
  if (selection.userId !== targetUserId || !validId(selection.cycleId) ||
      !validId(selection.week) || selection.week > 12 ||
      (selection.goalId !== undefined && !validId(selection.goalId)) ||
      (selection.tacticId !== undefined && !validId(selection.tacticId))) {
    return { key, cycleId: null, week: 1, error: translateActive('insights.history.badSelection') };
  }
  return { key, cycleId: selection.cycleId, week: selection.week, goalId: selection.goalId, tacticId: selection.tacticId, error: null };
}

function CycleHistoryHeatmap({ userId, cycleId }: { userId: number; cycleId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.heatmapDisclosure} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('insights.history.heatmapSummary')}</summary>
      {open && <ExecutionHeatmap userId={userId} cycleId={cycleId} />}
    </details>
  );
}

export function CycleHistoryTab({ targetUserId, selection, onSelectionChange }: CycleHistoryTabProps) {
  const { t } = useTranslation();
  const { list, loading, error, reload: reloadList } = useCycleHistory(targetUserId);
  const selectionKey = JSON.stringify([targetUserId, selection?.userId, selection?.cycleId, selection?.week, selection?.goalId, selection?.tacticId]);
  const [navigation, setNavigation] = useState(() => navigationFromSelection(selectionKey, targetUserId, selection));
  // URL-controlled views follow props, including an explicit return to the list.
  // Standalone views retain their legacy value-based selection/Back behavior.
  const current = !onSelectionChange && navigation.key === selectionKey
    ? navigation : navigationFromSelection(selectionKey, targetUserId, selection);
  const selectedCycleId = current.cycleId;
  const viewedWeek = current.week;
  const { detail, loadStatus, loadError, reload: reloadDetail } = useCycleDetail(targetUserId, selectedCycleId);
  const focusRef = useRef<HTMLDivElement>(null);
  const listFocusRef = useRef<HTMLDivElement>(null);
  const restoreListFocus = useRef(false);

  useEffect(() => {
    setNavigation((previous) => previous.key === selectionKey ? previous : navigationFromSelection(selectionKey, targetUserId, selection));
  }, [selectionKey, targetUserId, selection?.userId, selection?.cycleId, selection?.week, selection?.goalId, selection?.tacticId]);

  useLayoutEffect(() => {
    if (loadStatus !== 'ready' || !detail || detail.cycle.id !== selectedCycleId) return;
    focusRef.current?.focus({ preventScroll: true });
    focusRef.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  }, [loadStatus, detail, selectedCycleId, current.goalId, current.tacticId, selectionKey]);

  useLayoutEffect(() => {
    if (selectedCycleId !== null || loading || error || current.error || !list || !restoreListFocus.current) return;
    restoreListFocus.current = false;
    listFocusRef.current?.focus({ preventScroll: true });
  }, [selectedCycleId, loading, error, current.error, list]);

  const changeNavigation = (next: HistoryNavigation) => {
    if (onSelectionChange) {
      onSelectionChange(next.cycleId === null ? null : {
        kind: 'cycle', userId: targetUserId, cycleId: next.cycleId, week: next.week,
        goalId: next.goalId, tacticId: next.tacticId,
      });
    } else setNavigation(next);
  };
  const goBack = () => {
    restoreListFocus.current = true;
    changeNavigation({ key: selectionKey, cycleId: null, week: 1, error: null });
  };
  const setViewedWeek = (week: number) => changeNavigation({ ...current, week });
  const backButton = <button type="button" className="btn btn-ghost btn-sm" onClick={goBack}>{t('insights.history.back')}</button>;

  if (current.error) {
    return <div className={`card ${styles.message}`}><p role="alert">{current.error}</p>{backButton}</div>;
  }
  if (selectedCycleId !== null) {
    if (loadStatus === 'error') {
      return (
        <div className={`card ${styles.message}`}>
          <p role="alert">{t('insights.history.detailError', { error: loadError ?? '' })}</p>
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost" onClick={() => void reloadDetail()}>{t('insights.history.retry')}</button>
            {backButton}
          </div>
        </div>
      );
    }
    if (loadStatus !== 'ready' || !detail) {
      return <div className={`card ${styles.message}`}><p role="status">{t('insights.history.loadingCycle')}</p>{backButton}</div>;
    }
    const wantsMatch = current.goalId !== undefined || current.tacticId !== undefined;
    const matchedGoal = current.goalId !== undefined
      ? detail.goals.find((goal) => goal.id === current.goalId)
      : detail.goals.find((goal) => goal.tactics.some((tactic) => tactic.id === current.tacticId));
    const matchedTactic = matchedGoal?.tactics.find((tactic) => tactic.id === current.tacticId);
    const missingMatch = wantsMatch && (!matchedGoal || (current.tacticId !== undefined && !matchedTactic));
    const weekScore = detail.weekScores.find((w) => w.week === viewedWeek)?.score ?? null;
    return (
      <div className={styles.wrap}>
        {backButton}

        <div className={`card ${styles.banner}`} role="status">
          {detail.cycle.isActive
            ? t('insights.history.activeBanner')
            : t('insights.history.archivedBanner')}
        </div>

        <div className={`card ${styles.header}`} ref={wantsMatch ? undefined : focusRef} tabIndex={-1}>
          <h2 className={styles.title}>{detail.cycle.name}</h2>
          <p className={styles.meta}>
            {t('insights.history.lastWeekMeta', {
              week: detail.cycle.currentWeek,
              average: detail.averageScore ?? t('insights.history.noData'),
            })}
          </p>
        </div>

        {wantsMatch && (
          <div
            ref={focusRef}
            tabIndex={-1}
            role="region"
            aria-label={t('insights.history.matchLabel')}
            className={`card ${styles.searchMatch}`}
          >
            {missingMatch ? (
              <>
                <p role="alert">{t('insights.history.matchMissing')}</p>
                <div className={styles.actions}>
                  <button type="button" className="btn btn-ghost" onClick={() => void reloadDetail()}>{t('insights.history.retry')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => changeNavigation({ ...current, goalId: undefined, tacticId: undefined })}>{t('insights.history.showWholeCycle')}</button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.meta}>
                  {matchedTactic
                    ? t('insights.history.matchMetaTactic', { week: viewedWeek })
                    : t('insights.history.matchMetaGoal', { week: viewedWeek })}
                </p>
                <h3 className={styles.matchTitle}>{matchedTactic?.title ?? matchedGoal!.title}</h3>
                {matchedTactic && (
                  <p className={styles.meta}>
                    {t('insights.history.matchGoalLine', {
                      goal: matchedGoal!.title,
                      start: matchedTactic.startWeek,
                      end: matchedTactic.endWeek,
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className={styles.weekNav}>
          <span>{t('insights.history.viewWeek')}</span>
          <select value={viewedWeek} onChange={(e) => setViewedWeek(Number(e.target.value))} aria-label={t('insights.history.weekSelectLabel')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {t('insights.history.week', { week: w })}
              </option>
            ))}
          </select>
        </div>

        <ScoreSummary week={viewedWeek} score={weekScore} />

        <CyclePlanningPanel cycle={detail.cycle} isOwner={false} onSave={async () => undefined} />

        <Timeline
          weekScores={detail.weekScores}
          average={detail.averageScore}
          viewedWeek={viewedWeek}
          currentWeek={detail.cycle.currentWeek}
          onSelectWeek={setViewedWeek}
        />

        <WeeklyGrid goals={detail.goals} week={viewedWeek} isOwner={false} onToggle={() => undefined} />

        <CycleHistoryHeatmap key={`${targetUserId}:${detail.cycle.id}`} userId={targetUserId} cycleId={detail.cycle.id} />

        <GoalsPanel
          goals={detail.goals}
          isOwner={false}
          currentWeek={detail.cycle.currentWeek}
          onCreateGoal={noop}
          onRenameGoal={noop}
          onDeleteGoal={noop}
          onCreateTactic={noop}
          onUpdateTactic={noop}
          onDeleteTactic={noop}
        />

        <EvidenceGallery cycleId={detail.cycle.id} />
      </div>
    );
  }

  if (loading) return <div className={`card ${styles.message}`} role="status">{t('insights.history.loadingList')}</div>;
  if (error) return (
    <div className={`card ${styles.message}`}>
      <p role="alert">{error}</p>
      <button type="button" className="btn btn-ghost" onClick={() => void reloadList()}>{t('insights.history.retry')}</button>
    </div>
  );
  if (!list) return null;

  return (
    <div className={styles.wrap} ref={listFocusRef} tabIndex={-1} role="region" aria-label={t('insights.history.regionLabel')}>
      {list.cycles.length === 0 ? (
        <div className={`card ${styles.emptyState}`}>
          <h3 className={styles.emptyTitle}>{t('insights.history.emptyTitle')}</h3>
          <p className={styles.emptyText}>{t('insights.history.emptyText')}</p>
        </div>
      ) : (
        <div className={`card ${styles.listCard}`}>
          <h3 className={styles.listTitle}>{t('insights.history.listTitle', { count: list.cycles.length })}</h3>
          <ul className={styles.list}>
            {list.cycles.map((c) => (
              <li key={c.id} className={styles.row}>
                <span className={styles.name}>{c.name}</span>
                <span className={`${styles.badge} ${c.isActive ? styles.active : ''}`}>
                  {c.isActive ? t('insights.history.active') : t('insights.history.ended')}
                </span>
                <span className={styles.miniInfo}>{t('insights.history.weekOf12', { week: c.currentWeek })}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeNavigation({ key: selectionKey, cycleId: c.id, week: 1, error: null })}>
                  {t('insights.history.view')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
