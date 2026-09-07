import type { Cycle } from '../lib/types';
import type { RitualLoadStatus, WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import styles from './WeeklyPlanningRitualHomeCard.module.css';

interface WeeklyPlanningRitualHomeCardProps {
  cycle: Cycle;
  isOwner: boolean;
  ritual: WeeklyPlanningRitual | null;
  loadStatus: RitualLoadStatus;
  onOpen: () => void;
}

/**
 * Compact Home surfacing of the weekly planning ritual status:
 * - Owner: always shown while the cycle has a valid next week to plan (weeks 1-11) — status +
 *   a CTA before completion, a positive completed status (not hidden) afterwards.
 * - Partner (read-only dashboard): only shown once the ritual is actually complete, as a
 *   read-only summary. No controls, and nothing rendered for an absent/draft ritual.
 */
export function WeeklyPlanningRitualHomeCard({ cycle, isOwner, ritual, loadStatus, onOpen }: WeeklyPlanningRitualHomeCardProps) {
  const currentWeek = cycle.currentWeek;
  const targetWeek = currentWeek + 1;
  const cycleFinished = currentWeek >= 12;

  if (cycleFinished) {
    if (!isOwner) return null;
    return (
      <section className={`card ${styles.card}`}>
        <h3 className={styles.title}>תכנון אישי לשבוע הבא</h3>
        <p className={styles.text}>
          המחזור בשבוע 12, השבוע האחרון — הגיע הזמן לסיים ולסקור את המחזור כולו, במקום לתכנן שבוע נוסף.
        </p>
      </section>
    );
  }

  const isComplete = ritual?.status === 'complete';

  if (!isOwner) {
    if (!isComplete) return null;
    return (
      <section className={`card ${styles.card}`}>
        <h3 className={styles.title}>תכנון אישי — שבוע {targetWeek}</h3>
        <p className={styles.completeText}>✓ השותף/ה השלים/ה את טקס התכנון לשבוע הבא</p>
        {ritual?.weeklyFocus && <p className={styles.summary}>מיקוד: {ritual.weeklyFocus}</p>}
      </section>
    );
  }

  if (loadStatus === 'loading' || loadStatus === 'idle') return null;

  return (
    <section className={`card ${styles.card}`}>
      <h3 className={styles.title}>תכנון אישי — שבוע {targetWeek}</h3>
      {isComplete ? (
        <>
          <p className={styles.completeText}>✓ הטקס הושלם</p>
          {ritual?.weeklyFocus && <p className={styles.summary}>מיקוד: {ritual.weeklyFocus}</p>}
        </>
      ) : (
        <p className={styles.pendingText}>המיקוד והטקטיקות שלך לשבוע הבא — באותו עמוד עם הפגישה המשותפת. התכנון האישי נשמר בנפרד.</p>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
        פגישה משותפת
      </button>
    </section>
  );
}
