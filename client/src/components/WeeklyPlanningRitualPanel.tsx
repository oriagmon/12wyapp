import { useEffect, useMemo, useState } from 'react';
import type { Cycle, Goal, WeekScore } from '../lib/types';
import { effectiveTacticForWeek, formatScore, WEEKDAY_LABELS_HE } from '../lib/scoring';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import type { RitualLoadStatus, WeeklyPlanningDraftPatch, WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import styles from './WeeklyPlanningRitualPanel.module.css';

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
        <h2 className={styles.title}>תכנון אישי לשבוע הבא</h2>
        <p className={styles.finishedMessage}>
          המחזור הגיע לשבוע 12, השבוע האחרון שלו. במקום לתכנן שבוע 13 (שלא קיים במחזור בן 12 השבועות), זה הזמן לסיים
          ולסקור את המחזור כולו — ואז לפתוח מחזור חדש כדי להמשיך את הטקס השבועי.
        </p>
      </section>
    );
  }

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <section className="card" style={{ padding: 24 }}>טוען את טקס התכנון השבועי...</section>;
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
    !tacticsReviewed && 'לסמן שעברתם על הטקטיקות',
    weeklyFocus.trim().length === 0 && 'לכתוב מיקוד לשבוע',
    commitment.trim().length === 0 && 'לכתוב מחויבות אחת',
  ].filter((step): step is string => typeof step === 'string');
  const canComplete = missingSteps.length === 0;

  const currentDraft: WeeklyPlanningDraftPatch = { workedWell, improveNext, tacticsReviewed, weeklyFocus, commitment };

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>תכנון אישי — לקראת שבוע {targetWeek}</h2>
          <p className={styles.subtitle}>
            זמן אישי לבחור מיקוד, טקטיקות וזמנים לשבוע הבא. מומלץ לקראת סוף שבוע {currentWeek}.
            {' '}בהמשך אותו עמוד מסכמים יחד ביצועים ומחויבויות בפגישה המשותפת. התכנון האישי נשמר בנפרד.
          </p>
        </div>
        {isComplete && <span className={styles.completeBadge}>✓ הטקס הושלם</span>}
      </div>

      <section className={styles.step} aria-label="שלב 1">
        <h3 className={styles.stepTitle}>שלב 1: סקירת השבוע הנוכחי (שבוע {currentWeek})</h3>
        <p className={styles.stepScore}>ציון שבוע {currentWeek}: {formatScore(currentWeekScore)}</p>
        <label className={styles.field}>
          <span className={styles.label}>מה עבד השבוע?</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={workedWell}
            readOnly={!editable}
            placeholder="מה תרם להצלחה השבוע?"
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setWorkedWell(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>מה נשפר בשבוע הבא?</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={improveNext}
            readOnly={!editable}
            placeholder="מה כדאי לשנות או לשפר?"
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setImproveNext(e.target.value);
            }}
          />
        </label>
      </section>

      <section className={styles.step} aria-label="שלב 2">
        <h3 className={styles.stepTitle}>שלב 2: סקירת טקטיקות לשבוע {targetWeek}</h3>
        {targetTactics.length === 0 ? (
          <p className={styles.emptyTactics}>אין טקטיקות מתוזמנות לשבוע {targetWeek}.</p>
        ) : (
          <ul className={styles.tacticList}>
            {targetTactics.map((tactic) => (
              <li key={tactic.id} className={styles.tacticItem}>
                <span className={styles.tacticGoal}>{tactic.goalTitle}</span>
                <span className={styles.tacticTitle}>{tactic.title}</span>
                <span className={styles.tacticDays}>{tactic.weekdays.map((day) => WEEKDAY_LABELS_HE[day]).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNavigateToTactics}>
          מעבר למטרות וטקטיקות לעדכון
        </button>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={tacticsReviewed}
            disabled={!editable}
            onChange={(e) => setTacticsReviewed(e.target.checked)}
          />
          <span>בדקתי והתאמתי את הטקטיקות לשבוע הבא</span>
        </label>
      </section>

      <section className={styles.step} aria-label="שלב 3">
        <h3 className={styles.stepTitle}>שלב 3: התחייבות לשבוע {targetWeek}</h3>
        <label className={styles.field}>
          <span className={styles.label}>המיקוד המרכזי</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={weeklyFocus}
            readOnly={!editable}
            placeholder="מה הדבר האחד החשוב ביותר לשבוע הבא?"
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setWeeklyFocus(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>ההתחייבות שלי לשבוע הבא</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={commitment}
            readOnly={!editable}
            placeholder="מה אני מתחייב/ת לעשות?"
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
            שמירת טיוטה
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
            השלמת הטקס
          </button>
          <StatusBadge status={saveStatus.status} error={saveStatus.error} />
          <StatusBadge status={completeStatus.status} error={completeStatus.error} />
          {!canComplete && (
            <p id="ritual-missing-steps" className={styles.missingSteps}>
              {missingSteps.length === 1 ? 'נשאר רק ' : 'נשאר עוד: '}
              {missingSteps.join(' · ')}
            </p>
          )}
        </div>
      )}

      {isOwner && isComplete && (
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={() => onReopen()}>
            פתיחה מחדש לעריכה
          </button>
        </div>
      )}

      {!isOwner && (
        <p className={styles.readOnlyNote}>צפייה בלבד — רק בעל/ת הלוח יכול/ה לערוך את טקס התכנון השבועי.</p>
      )}
    </section>
  );
}
