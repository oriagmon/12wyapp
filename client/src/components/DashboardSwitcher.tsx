import styles from './DashboardSwitcher.module.css';

export function DashboardSwitcher({
  ownLabel,
  partnerLabel,
  viewingOwn,
  onSwitch,
}: {
  ownLabel: string;
  partnerLabel: string | null;
  viewingOwn: boolean;
  onSwitch: (own: boolean) => void;
}) {
  if (!partnerLabel) return null;

  return (
    <div className={styles.wrap} role="tablist" aria-label="בחירת לוח לצפייה">
      <button
        type="button"
        role="tab"
        aria-selected={viewingOwn}
        className={`${styles.tab} ${viewingOwn ? styles.active : ''}`}
        onClick={() => onSwitch(true)}
      >
        הלוח שלי
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!viewingOwn}
        className={`${styles.tab} ${!viewingOwn ? styles.active : ''}`}
        onClick={() => onSwitch(false)}
      >
        הלוח של <bdi>{partnerLabel}</bdi> · צפייה בלבד
      </button>
    </div>
  );
}
