import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePartnerships } from '../hooks/usePartnerships';
import { useDashboard } from '../hooks/useDashboard';
import { useDashboardNavigation } from '../hooks/useDashboardNavigation';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { useWeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import { useExecutionRecovery } from '../hooks/useExecutionRecovery';
import { DashboardSwitcher } from '../components/DashboardSwitcher';
import type { DashboardTab } from '../components/DashboardTabs';
import { CycleHeader } from '../components/CycleHeader';
import { ScoreSummary } from '../components/ScoreSummary';
import { Timeline } from '../components/Timeline';
import { TodayList } from '../components/TodayList';
import { WeeklyGrid } from '../components/WeeklyGrid';
import { GoalsPanel } from '../components/GoalsPanel';
import { PartnerPanel } from '../components/PartnerPanel';
import { StatusBadge } from '../components/StatusBadge';
import { WamsTab } from '../components/WamsTab';
import { CycleHistoryTab } from '../components/CycleHistoryTab';
import { ExportDataButton } from '../components/ExportDataButton';
import { CyclePlanningPanel } from '../components/CyclePlanningPanel';
import { CycleProgressCard } from '../components/CycleProgressCard';
import { CycleWrapUpCard } from '../components/CycleWrapUpCard';
import { PrimaryGoalHero } from '../components/PrimaryGoalHero';
import { StreakBanner } from '../components/StreakBanner';
import { WeeklyPlanningRitualPanel } from '../components/WeeklyPlanningRitualPanel';
import { WeeklyPlanningRitualHomeCard } from '../components/WeeklyPlanningRitualHomeCard';
import { ExecutionRecoveryCard } from '../components/ExecutionRecoveryCard';
import { WeekEvidenceAlbum } from '../components/WeekEvidenceAlbum';
import { ExecutionHeatmap } from '../components/ExecutionHeatmap';
import { ArchiveSearchPanel } from '../components/ArchiveSearchPanel';
import { MobileNavigation } from '../components/MobileNavigation';
import { MonitoringPanel } from '../components/MonitoringPanel';
import { ProfilePage } from './ProfilePage';
import { RemindersPage } from './RemindersPage';
import { BroostPage } from './BroostPage';
import { personLabel } from '../lib/people';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { user } = useAuth();
  const partnerships = usePartnerships();
  const partner = partnerships.state?.partner ?? null;
  const navigationState = useDashboardNavigation({
    ownUserId: user!.id,
    partnerId: partner?.id ?? null,
    partnershipsLoading: partnerships.loading,
    partnershipsError: partnerships.error,
  });
  const { viewingOwn, activeSection, archiveTarget, targetUserId, navigate, openArchiveResult } = navigationState;
  const dash = useDashboard(targetUserId, {
    viewedWeek: navigationState.viewedWeek,
    onViewedWeekChange: navigationState.setViewedWeek,
  });
  // Always kept available (regardless of the own/partner switcher) so the shared
  // Weekly Accountability Meeting flow can offer "edit my own goals/tactics" no
  // matter which dashboard is currently being viewed.
  const ownDash = useDashboard(user!.id);
  const [newCycleName, setNewCycleName] = useState('');
  const createStatus = useAsyncStatus();

  const week = dash.viewedWeek;
  const weekScore = dash.bundle?.weekScores.find((w) => w.week === week)?.score ?? null;
  const cycle = dash.bundle?.cycle ?? null;
  const currentWeekScore = cycle
    ? dash.bundle?.weekScores.find((item) => item.week === cycle.currentWeek)?.score ?? null
    : null;

  // The weekly planning ritual always targets "next cycle week" (N+1) for whichever
  // dashboard (own or partner) is currently selected — never a skipped-ahead week, and
  // never week 13 once the cycle has reached its final week 12.
  const ritualTargetWeek = cycle && cycle.currentWeek < 12 ? cycle.currentWeek + 1 : null;
  const ritual = useWeeklyPlanningRitual(cycle ? cycle.id : null, ritualTargetWeek);
  // refreshSignal: dash.bundle gets a new object reference after every dashboard mutation
  // (completions, tactic edits, current-week changes), so risk stays current without this
  // hook needing to know about any of those mutations directly.
  const recovery = useExecutionRecovery(targetUserId, dash.bundle, dash.reload);

  if (navigationState.resolvingBoard || navigationState.routeError || targetUserId === null) {
    return (
      <main id="main-content" className={styles.page} tabIndex={-1}>
        <section className="card" style={{ padding: 24 }}>
          <p role={navigationState.routeError ? 'alert' : 'status'}>
            {navigationState.routeError ?? 'טוען את הלוח המבוקש...'}
          </p>
          {navigationState.routeError && (
            <button type="button" className="btn btn-ghost" onClick={() => navigationState.resetToOwnHome()}>חזרה ללוח שלי</button>
          )}
          {navigationState.route && partnerships.error && (
            <button type="button" className="btn btn-ghost" onClick={() => void partnerships.reload()}>ניסיון נוסף לטעינת השותפות</button>
          )}
        </section>
      </main>
    );
  }

  const tabs: DashboardTab[] =
    dash.loadStatus === 'ready' && cycle && dash.bundle
      ? [
          {
            id: 'planning',
            label: 'תכנון המחזור',
            content: (
              <CyclePlanningPanel
                cycle={cycle}
                isOwner={dash.isOwner}
                onSave={(planning) => dash.updateCycle(planning)}
              />
            ),
          },
          {
            id: 'week',
            label: 'מעקב שבועי',
            content: (
              <>
                <div className={styles.weekNav}>
                  <span>צפייה בשבוע:</span>
                  <select
                    value={week}
                    onChange={(e) => dash.setViewedWeek(Number(e.target.value))}
                    aria-label="בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        שבוע {w}
                      </option>
                    ))}
                  </select>
                </div>

                <ScoreSummary week={week} score={weekScore} />

                <WeeklyGrid
                  goals={dash.bundle!.goals}
                  week={week}
                  currentWeek={cycle.currentWeek}
                  isOwner={dash.isOwner}
                  onToggle={(tacticId, weekday, done) => dash.toggleCompletion(tacticId, week, weekday, done)}
                />
                <WeekEvidenceAlbum cycleId={cycle.id} week={week} isOwner={dash.isOwner} />
              </>
            ),
          },
          {
            id: 'goals',
            label: 'מטרות וטקטיקות',
            content: (
              <GoalsPanel
                goals={dash.bundle!.goals}
                isOwner={dash.isOwner}
                currentWeek={cycle.currentWeek}
                onCreateGoal={(title, color) => dash.createGoal(title, color)}
                onRenameGoal={(id, title) => dash.renameGoal(id, title)}
                onDeleteGoal={(id) => dash.deleteGoal(id)}
                onCreateTactic={(goalId, values) => dash.createTactic({ goalId, ...values })}
                onUpdateTactic={(tacticId, values) => dash.updateTactic(tacticId, values)}
                onDeleteTactic={(tacticId) => dash.deleteTactic(tacticId)}
              />
            ),
          },
          {
            id: 'history',
            label: 'מגמות',
            content: (
              <>
              <Timeline
                weekScores={dash.bundle!.weekScores}
                average={dash.bundle!.averageScore}
                viewedWeek={week}
                currentWeek={cycle.currentWeek}
                onSelectWeek={dash.setViewedWeek}
              />
              <ExecutionHeatmap userId={targetUserId} refreshKey={dash.bundle} />
              </>
            ),
          },
        ]
      : [];

  // One destination, independent records: personal planning keeps its next-cycle-week
  // scope; shared meetings keep their own selected week, participants and permissions.
  tabs.push({
    id: 'wams',
    label: 'פגישה משותפת',
    content: (
      <div className={styles.meetingPage}>
        {/* The page holds two different rituals that used to run together as one long scroll.
            Naming them as ordered steps is what makes the order obvious on a screen that is
            opened roughly once a week. */}
        <p className={styles.stepLabel}>
          <span className={styles.stepIndex}>1</span> לבד — התכנון לשבוע הבא
        </p>
        {dash.loadStatus === 'ready' && cycle && dash.bundle ? (
          <WeeklyPlanningRitualPanel
            key={`${cycle.id}:${ritualTargetWeek}`}
            cycle={cycle}
            goals={dash.bundle.goals}
            weekScores={dash.bundle.weekScores}
            isOwner={dash.isOwner}
            ritual={ritual.ritual}
            loadStatus={ritual.loadStatus}
            loadError={ritual.loadError}
            onSaveDraft={ritual.saveDraft}
            onComplete={ritual.complete}
            onReopen={ritual.reopen}
            onNavigateToTactics={() => navigate('goals')}
          />
        ) : (
          <section className="card" style={{ padding: 24 }}>
            <h2>תכנון אישי לשבוע הבא</h2>
            {dash.loadStatus === 'loading' ? <p role="status">טוען את התכנון האישי...</p> :
              dash.loadStatus === 'error' ? <p role="alert">{dash.loadError}</p> :
              <p>{dash.isOwner
                ? 'לתכנון אישי נדרש מחזור פעיל. אפשר ליצור מחזור בדף הבית.'
                : 'לשותף/ה אין מחזור פעיל לתכנון אישי.'}</p>}
          </section>
        )}
        <p className={styles.stepLabel}>
          <span className={styles.stepIndex}>2</span> ביחד — הפגישה עם השותף/ה
        </p>
        {partnerships.loading ? (
          <section className="card" style={{ padding: 24 }}><p role="status">טוען את השותפות לפגישה...</p></section>
        ) : partnerships.error ? (
          <section className="card" style={{ padding: 24 }}>
            <p role="alert">לא ניתן לאמת כרגע גישה לפגישה. הכתובת נשמרה ללא שינוי.</p>
            <button type="button" className="btn btn-ghost" onClick={() => void partnerships.reload()}>ניסיון נוסף לטעינת השותפות</button>
          </section>
        ) : partner ? (
          <WamsTab myUserId={user!.id} ownDash={ownDash}
            selection={archiveTarget?.kind === 'wam' ? archiveTarget : undefined}
            onSelectionChange={navigationState.setArchiveTarget}
            selectedWeek={navigationState.viewedWeek ?? 1}
            onWeekChange={navigationState.setViewedWeek}
            navigationKey={JSON.stringify(navigationState.route)} />
        ) : archiveTarget?.kind === 'wam' ? (
          <section className="card" style={{ padding: 24 }}>
            <p role="alert">הפגישה שבכתובת אינה זמינה ללא שותפות פעילה. לא נפתחה פגישה אחרת.</p>
            <button type="button" className="btn btn-ghost" onClick={() => navigationState.setArchiveTarget(null)}>חזרה לרשימת הפגישות</button>
          </section>
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <h2>פגישת האחריות השבועית שלכם</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              כדי ליצור, לשמור ולצפות בפגישות WAM, יש להתחבר תחילה לשותף או לשותפה.
            </p>
            <PartnerPanel partnerships={partnerships} />
          </div>
        )}
      </div>
    ),
  });

  // Cycle history is tied to whichever dashboard (own or partner) is currently selected,
  // and is available even when that person has no *active* cycle right now — past,
  // archived cycles remain visible forever as read-only history.
  tabs.push({
    id: 'cycleHistory',
    label: 'מחזורים קודמים',
    content: <CycleHistoryTab targetUserId={targetUserId}
      selection={archiveTarget?.kind === 'cycle' && archiveTarget.userId === targetUserId ? archiveTarget : undefined}
      onSelectionChange={navigationState.setArchiveTarget} />,
  });

  // BROOST is always about the logged-in user's own current partnership (the whole
  // /api/broosts API is self-scoped: sends only to the caller's own current partner),
  // regardless of the own/partner dashboard switcher above, and works with no active cycle
  // at all — mirrors the WAM tab's own "no partner yet" onboarding fallback exactly.
  tabs.push({
    id: 'broosts',
    label: 'BROOST',
    content: partner ? (
      <BroostPage partner={partner} />
    ) : (
      <div className="card" style={{ padding: 24 }}>
        <h2>BROOST</h2>
        <p style={{ color: 'var(--text-muted)' }}>כדי לשלוח BROOST, יש להתחבר תחילה לשותף או לשותפה.</p>
        <PartnerPanel partnerships={partnerships} />
      </div>
    ),
  });

  // Profile is always about the logged-in user themself (the whole /api/profile API is
  // self-scoped), regardless of the own/partner dashboard switcher above, and works with no
  // active cycle at all.
  tabs.push({
    id: 'profile',
    label: 'פרופיל',
    content: <ProfilePage />,
  });

  // Scheduled email reminders are also always about the logged-in user themself (the whole
  // /api/reminders API is creator-scoped), regardless of the own/partner switcher, and works
  // with no active cycle at all.
  tabs.push({
    id: 'reminders',
    label: 'תזכורות',
    content: <RemindersPage ownUserId={user!.id} ownEmail={user!.email} partner={partner}
      focusedReminderId={archiveTarget?.kind === 'reminder' ? archiveTarget.reminderId : undefined}
      onDismissFocusedReminder={() => navigationState.setArchiveTarget(null)} />,
  });
  tabs.push({
    id: 'search',
    label: 'חיפוש בארכיון',
    content: <ArchiveSearchPanel onNavigate={openArchiveResult} />,
  });
  tabs.push({
    id: 'monitoring',
    label: 'בריאות המערכת',
    content: <MonitoringPanel />,
  });

  const navigation = [
    { id: 'home', label: 'דף הבית', requiresCycle: false },
    { id: 'planning', label: 'תכנון המחזור', requiresCycle: true, group: 'תכנון' },
    { id: 'week', label: 'מעקב שבועי', requiresCycle: true },
    { id: 'goals', label: 'מטרות וטקטיקות', requiresCycle: true },
    { id: 'history', label: 'מגמות', requiresCycle: true, group: 'התקדמות וארכיון' },
    { id: 'wams', label: 'פגישה משותפת', requiresCycle: false },
    { id: 'cycleHistory', label: 'מחזורים קודמים', requiresCycle: false, group: 'התקדמות וארכיון' },
    { id: 'broosts', label: 'BROOST', requiresCycle: false, group: 'קשר ותזכורות' },
    { id: 'profile', label: 'פרופיל', requiresCycle: false, group: 'חשבון ומערכת' },
    { id: 'reminders', label: 'תזכורות', requiresCycle: false, group: 'קשר ותזכורות' },
    { id: 'search', label: 'חיפוש בארכיון', requiresCycle: false, group: 'התקדמות וארכיון' },
    { id: 'monitoring', label: 'בריאות המערכת', requiresCycle: false, group: 'חשבון ומערכת' },
  ];
  const navigationItems = navigation.map((item) => ({
    id: item.id, label: item.label, group: item.group, disabled: item.requiresCycle && !cycle,
  }));
  const activeTab = tabs.find((tab) => tab.id === activeSection);
  const isCycleSection = ['planning', 'week', 'goals', 'history'].includes(activeSection);
  // Loading/error/empty-cycle status cards are only relevant to the Home tab and the
  // cycle-dependent tabs above (which have nothing else to show without cycle data). Tabs
  // that work with no active cycle at all (Profile, WAM, cycle history) must render their own
  // content cleanly, without one of these cards stacked above it.
  const showsCycleStatusCard = activeSection === 'home' || isCycleSection;

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <DashboardSwitcher
          ownLabel={personLabel(user!)}
          partnerLabel={partner ? personLabel(partner) : null}
          viewingOwn={viewingOwn}
          onSwitch={navigationState.switchBoard}
        />
        {!viewingOwn && <span className={styles.readOnlyBadge}>👁 צפייה בלבד</span>}
        <ExportDataButton />
      </div>
      <div className={styles.globalNav}>
        <MobileNavigation layout="desktop" activeId={activeSection} onNavigate={navigate} items={navigationItems} />
      </div>

      <main id="main-content" tabIndex={-1} className="motion-route" key={`${activeSection}:${targetUserId}`} style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      {showsCycleStatusCard && dash.loadStatus === 'loading' && (
        <div className="card" style={{ padding: 24 }}>טוען לוח...</div>
      )}

      {showsCycleStatusCard && dash.loadStatus === 'error' && (
        <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>
          {dash.loadError}
        </div>
      )}

      {showsCycleStatusCard && dash.loadStatus === 'empty' && dash.isOwner && (
        <div className={`card ${styles.emptyCycle}`}>
          <h2 className={styles.emptyCycleTitle}>עדיין אין מחזור פעיל</h2>
          <p className={styles.emptyCycleText}>
            צרו מחזור חדש בן 12 שבועות כדי להתחיל להגדיר מטרות, טקטיקות ולעקוב אחר ההתקדמות השבועית.
          </p>
          <div className={styles.emptyCycleForm}>
            <input
              type="text"
              placeholder="שם המחזור"
              value={newCycleName}
              onChange={(e) => setNewCycleName(e.target.value)}
              aria-label="שם המחזור החדש"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createStatus.run(() => dash.createCycle(newCycleName.trim()))}
              disabled={newCycleName.trim().length === 0}
            >
              + יצירת מחזור ראשון
            </button>
            <StatusBadge status={createStatus.status} error={createStatus.error} />
          </div>
        </div>
      )}

      {showsCycleStatusCard && dash.loadStatus === 'empty' && !dash.isOwner && (
        <div className="card" style={{ padding: 24, color: 'var(--text-muted)' }}>
          השותף/ה טרם יצר/ה מחזור פעיל.
        </div>
      )}

      {dash.loadStatus === 'ready' && cycle && isCycleSection && (
        <CycleHeader
          key={cycle.id}
          cycle={cycle}
          isOwner={dash.isOwner}
          onRename={(name) => dash.updateCycle({ name })}
          onWeekChange={(w) => dash.updateCycle({ currentWeek: w })}
          onReset={(name) => dash.resetCycle(name)}
        />
      )}

      {dash.loadStatus === 'ready' && cycle && activeSection === 'home' && (
        <>
          <CycleHeader
            key={cycle.id}
            cycle={cycle}
            isOwner={dash.isOwner}
            onRename={(name) => dash.updateCycle({ name })}
            onWeekChange={(w) => dash.updateCycle({ currentWeek: w })}
            onReset={(name) => dash.resetCycle(name)}
          />
          <StreakBanner userId={targetUserId} refreshKey={dash.bundle} />
          <PrimaryGoalHero
            cycle={cycle}
            goals={dash.bundle!.goals}
            currentScore={currentWeekScore}
          />
          <CycleProgressCard currentWeek={cycle.currentWeek} weekScore={currentWeekScore} />
          <CycleWrapUpCard currentWeek={cycle.currentWeek} weekScores={dash.bundle!.weekScores} />
          <ExecutionRecoveryCard
            isOwner={dash.isOwner}
            currentWeek={cycle.currentWeek}
            goals={dash.bundle!.goals}
            risk={recovery.risk}
            plan={recovery.plan}
            loadStatus={recovery.loadStatus}
            loadError={recovery.loadError}
            onSaveManeuver={recovery.saveManeuver}
            onReduceNextWeek={recovery.reduceNextWeek}
            onResolve={recovery.resolve}
            onReopen={recovery.reopen}
          />
          <WeeklyPlanningRitualHomeCard
            cycle={cycle}
            isOwner={dash.isOwner}
            ritual={ritual.ritual}
            loadStatus={ritual.loadStatus}
            onOpen={() => navigate('wams')}
          />
          <TodayList
            goals={dash.bundle!.goals}
            currentWeek={cycle.currentWeek}
            isOwner={dash.isOwner}
            onToggle={(tacticId, weekday, done) =>
              dash.toggleCompletion(tacticId, cycle.currentWeek, weekday, done)
            }
          />
          <WeekEvidenceAlbum cycleId={cycle.id} week={cycle.currentWeek} isOwner={dash.isOwner} />
        </>
      )}

      {activeSection !== 'home' && activeTab && (
        <div className={styles.sectionContent} role="region" aria-label={activeTab.label}>
          {activeTab.content}
        </div>
      )}

      {activeSection === 'home' && viewingOwn && <PartnerPanel partnerships={partnerships} />}
      </main>

      <MobileNavigation
        activeId={activeSection}
        onNavigate={navigate}
        items={navigationItems}
      />

    </div>
  );
}
