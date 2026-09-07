import { useState } from 'react';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import type { Cycle } from '../lib/types';
import styles from './CycleHeader.module.css';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  // Split around the placeholder so the number can stay bold while each language keeps
  // its own word order.
  const currentWeekLabel = t('dashboard.cycle.currentWeek').split('{week}');
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
          aria-label={t('dashboard.cycle.nameLabel')}
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
          aria-label={t('dashboard.cycle.prevWeek')}
        >
          <span className={styles.arrow} dir="ltr" aria-hidden="true">→</span>
        </button>
        <div className={styles.weekLabel}>
          {currentWeekLabel[0]}<strong>{cycle.currentWeek}</strong>{currentWeekLabel[1]}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!isOwner || cycle.currentWeek >= 12}
          onClick={() => changeWeek(1)}
          aria-label={t('dashboard.cycle.nextWeek')}
        >
          <span className={styles.arrow} dir="ltr" aria-hidden="true">←</span>
        </button>
        <StatusBadge status={weekNav.status} error={weekNav.error} />
      </div>

      {isOwner && (
        <div className={styles.resetSection}>
          {!confirmingReset ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingReset(true)}>
              {t('dashboard.cycle.endAndStart')}
            </button>
          ) : (
            <div className={styles.confirmBox} role="alertdialog" aria-label={t('dashboard.cycle.confirmLabel')}>
              <p className={styles.confirmText}>
                {t('dashboard.cycle.confirmBody')}
              </p>
              <input
                type="text"
                value={resetName}
                onChange={(e) => setResetName(e.target.value)}
                placeholder={t('dashboard.cycle.newNamePlaceholder')}
                aria-label={t('dashboard.cycle.newNameLabel')}
              />
              <div className={styles.confirmActions}>
                <button type="button" className="btn btn-primary btn-sm" onClick={submitReset}>
                  {t('dashboard.cycle.confirmEnd')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingReset(false)}>
                  {t('dashboard.cycle.cancel')}
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
