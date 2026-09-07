import { useState } from 'react';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import type { Cycle } from '../lib/types';
import styles from './CycleHeader.module.css';

export function CycleHeader({
  cycle,
  isOwner,
  onRename,
  onWeekChange,
  onReset,
}: {
  cycle: Cycle;
  isOwner: boolean;
  onRename: (name: string) => Promise<void>;
  onWeekChange: (week: number) => Promise<void>;
  onReset: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(cycle.name);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetName, setResetName] = useState('');
  const rename = useAsyncStatus();
  const weekNav = useAsyncStatus();
  const reset = useAsyncStatus();

  const commitName = () => {
    if (!isOwner || name.trim() === cycle.name || name.trim().length === 0) return;
    rename.run(() => onRename(name.trim()));
  };

  const changeWeek = (delta: number) => {
    if (!isOwner) return;
    const next = cycle.currentWeek + delta;
    if (next < 1 || next > 12) return;
    weekNav.run(() => onWeekChange(next));
  };

  const submitReset = () => {
    if (resetName.trim().length === 0) return;
    reset.run(() => onReset(resetName.trim())).then(() => {
      setConfirmingReset(false);
      setResetName('');
    });
  };

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.nameRow}>
        <input
          type="text"
          value={name}
          disabled={!isOwner}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          aria-label="שם המחזור"
          className={styles.nameInput}
        />
        <StatusBadge status={rename.status} error={rename.error} />
      </div>

      <div className={styles.weekRow}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!isOwner || cycle.currentWeek <= 1}
          onClick={() => changeWeek(-1)}
          aria-label="שבוע קודם"
        >
          <span className={styles.arrow} dir="ltr" aria-hidden="true">→</span>
        </button>
        <div className={styles.weekLabel}>
          שבוע נוכחי: <strong>{cycle.currentWeek}</strong> מתוך 12
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!isOwner || cycle.currentWeek >= 12}
          onClick={() => changeWeek(1)}
          aria-label="שבוע הבא"
        >
          <span className={styles.arrow} dir="ltr" aria-hidden="true">←</span>
        </button>
        <StatusBadge status={weekNav.status} error={weekNav.error} />
      </div>

      {isOwner && (
        <div className={styles.resetSection}>
          {!confirmingReset ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingReset(true)}>
              סיום מחזור והתחלת מחזור חדש
            </button>
          ) : (
            <div className={styles.confirmBox} role="alertdialog" aria-label="אישור סיום מחזור">
              <p className={styles.confirmText}>
                המחזור הנוכחי (כולל כל המטרות, הטקטיקות והביצועים) יישמר לצמיתות כהיסטוריה לקריאה בלבד, וניתן יהיה
                לצפות בו בכל עת בלשונית "מחזורים קודמים". שום דבר לא נמחק. שם למחזור החדש:
              </p>
              <input
                type="text"
                value={resetName}
                onChange={(e) => setResetName(e.target.value)}
                placeholder="לדוגמה: מחזור אביב 2026"
                aria-label="שם המחזור החדש"
              />
              <div className={styles.confirmActions}>
                <button type="button" className="btn btn-primary btn-sm" onClick={submitReset}>
                  אישור וסיום המחזור
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingReset(false)}>
                  ביטול
                </button>
                <StatusBadge status={reset.status} error={reset.error} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
