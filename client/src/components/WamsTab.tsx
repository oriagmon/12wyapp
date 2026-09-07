import { useEffect, useRef, useState } from 'react';
import { useWamList, useWamDetail } from '../hooks/useWams';
import type { useDashboard } from '../hooks/useDashboard';
import type { WamCelebration } from '../lib/types';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import { WamListPanel } from './WamListPanel';
import { WamDetailView } from './WamDetailView';
import { WamCelebrationOverlay } from './WamCelebrationOverlay';

export function WamsTab({ myUserId, ownDash, selection, onSelectionChange, selectedWeek, onWeekChange, navigationKey }: {
  myUserId: number;
  ownDash: ReturnType<typeof useDashboard>;
  selection?: Extract<ArchiveSearchTarget, { kind: 'wam' }>;
  onSelectionChange?: (selection: Extract<ArchiveSearchTarget, { kind: 'wam' }> | null) => void;
  selectedWeek?: number;
  onWeekChange?: (week: number) => void;
  navigationKey?: string;
}) {
  const list = useWamList();
  const [localSelectedWamId, setSelectedWamId] = useState<number | null>(selection?.wamId ?? null);
  const selectedWamId = onSelectionChange ? selection?.wamId ?? null : localSelectedWamId;
  const [celebration, setCelebration] = useState<WamCelebration | null>(null);
  const detail = useWamDetail(selectedWamId);

  // Read inside the async `.then()` below instead of the closed-over `selectedWamId` — by the
  // time a completion response resolves, the user may already have navigated to a different
  // WAM (or back to the list); this ref always reflects the *current* value, so a stale
  // response for a no-longer-open WAM can never pop up a celebration for the wrong meeting.
  const selectedWamIdRef = useRef(selectedWamId);
  selectedWamIdRef.current = selectedWamId;
  const navigationVersionRef = useRef(0);
  const selectionKey = JSON.stringify([navigationKey, selection?.wamId, selection?.userId, selection?.cycleId, selection?.week, selection?.commitmentId, selection?.punishmentId]);
  const previousSelectionKey = useRef(selectionKey);
  if (previousSelectionKey.current !== selectionKey) {
    previousSelectionKey.current = selectionKey;
    navigationVersionRef.current += 1;
  }

  useEffect(() => () => {
    navigationVersionRef.current += 1;
    selectedWamIdRef.current = null;
  }, []);

  useEffect(() => {
    setCelebration(null);
    if (selection && !onSelectionChange) setSelectedWamId(selection.wamId);
  }, [selectionKey, Boolean(onSelectionChange)]);

  const selectWam = (id: number, week: number) => {
    selectedWamIdRef.current = id;
    setCelebration(null);
    if (onSelectionChange) {
      onSelectionChange({ kind: 'wam', userId: myUserId, cycleId: null, wamId: id, week });
    } else setSelectedWamId(id);
  };

  // Ensures a draft WAM exists for this week under the caller's *current* active cycle
  // (idempotent — returns the existing one if already started), then opens it directly by
  // the id the server actually resolved to (never re-derived from the week number alone,
  // since several meetings across different cycle generations can share the same week).
  const startOrOpenCurrent = async (week: number) => {
    const version = ++navigationVersionRef.current;
    const wam = await list.startMeeting(week);
    if (wam && version === navigationVersionRef.current) {
      selectWam(wam.id, wam.week);
    }
  };

  const openWamById = (id: number, week: number) => {
    navigationVersionRef.current += 1;
    selectWam(id, week);
  };

  // Reload the list on the way back to the summary view so its per-WAM commitment/punishment
  // counters (which the detail view's own mutations never update in place) are never stale.
  // A reload failure surfaces through the list hook's own existing error state, same as any
  // other list load failure — no separate handling needed here.
  const goBackToList = () => {
    navigationVersionRef.current += 1;
    selectedWamIdRef.current = null;
    setCelebration(null);
    if (onSelectionChange) onSelectionChange(null);
    else setSelectedWamId(null);
    list.reload();
  };

  const handleComplete = (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) => {
    const version = navigationVersionRef.current;
    return detail.complete(schedule).then((res) => {
      list.reload();
      // Guards against a genuinely stale response: the user could in principle have already
      // navigated away from this exact WAM before the completion request resolved.
      if (res && res.wam.id === selectedWamIdRef.current && version === navigationVersionRef.current) {
        setCelebration(res.celebration);
      }
      return res;
    });
  };

  const handleSchedule = (schedule: { nextWamAt: string; nextWamDurationMinutes?: number }) =>
    // Invitation-only: no completion, so the list's status is unchanged and no celebration
    // can be produced. The list is still refreshed so the next-meeting summary stays current.
    detail.scheduleNextWam(schedule).then((res) => {
      list.reload();
      return res;
    });

  if (selectedWamId !== null) {
    if (detail.loadStatus === 'error') {
      return (
        <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>
          <p role="alert">{detail.loadError}</p>
          <button type="button" className="btn btn-ghost" onClick={detail.reload}>ניסיון נוסף</button>
          <button type="button" className="btn btn-ghost" onClick={goBackToList}>חזרה לרשימת הפגישות</button>
        </div>
      );
    }
    if (detail.loadStatus === 'loading' || !detail.wam || detail.wam.id !== selectedWamId) {
      return <div className="card" style={{ padding: 24 }}>טוען פגישה...</div>;
    }
    return (
      <>
        <WamDetailView
          key={detail.wam.id}
          wam={detail.wam}
          searchTarget={selection?.wamId === detail.wam.id ? selection : undefined}
          myUserId={myUserId}
          onBack={goBackToList}
          onUpdateContent={(patch) => detail.updateContent(patch)}
          onRate={(rating) => detail.setRating(rating)}
          onComplete={handleComplete}
          onSchedule={handleSchedule}
          onReopen={() => detail.reopen().then(() => list.reload())}
          onAddCommitment={(label, scope) => detail.addCommitment(label, scope)}
          onToggleCommitment={(id, done) => detail.updateCommitment(id, { done })}
          onUpdateCommitmentLabel={(id, label) => detail.updateCommitment(id, { label })}
          onDeleteCommitment={(id) => detail.deleteCommitment(id)}
          onAddPunishment={(label, assignedUserId) => detail.addPunishment(label, assignedUserId)}
          onUpdatePunishmentLabel={(id, label) => detail.updatePunishment(id, { label })}
          onReassignPunishment={(id, assignedUserId) => detail.updatePunishment(id, { assignedUserId })}
          onDeletePunishment={(id) => detail.deletePunishment(id)}
          onToggleDuePunishment={(id, done) => detail.toggleDuePunishment(id, done)}
          ownDash={ownDash}
        />
        {celebration && <WamCelebrationOverlay celebration={celebration} onClose={() => setCelebration(null)} />}
      </>
    );
  }

  if (list.loading) {
    return <div className="card" style={{ padding: 24 }}>טוען פגישות אחריותיות...</div>;
  }
  if (list.error) {
    return (
      <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>
        {list.error}
      </div>
    );
  }
  if (!list.data) return null;

  return (
    <WamListPanel
      data={list.data}
      onOpenById={openWamById}
      onStartOrOpenCurrent={startOrOpenCurrent}
      onSearch={list.search}
      selectedWeek={selectedWeek}
      onWeekChange={onWeekChange}
    />
  );
}
