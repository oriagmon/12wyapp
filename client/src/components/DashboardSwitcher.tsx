import styles from './DashboardSwitcher.module.css';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  // Split around the name so each language keeps its own word order while the name
  // itself stays inside a <bdi>, which is what stops a Latin name from reordering
  // the Hebrew sentence around it.
  const partnerBoardLabel = t('common.board.partner').split('{name}');

  if (!partnerLabel) return null;

  return (
    <div className={styles.wrap} role="tablist" aria-label={t('common.board.picker')}>
      <button
        type="button"
        role="tab"
        aria-selected={viewingOwn}
        className={`${styles.tab} ${viewingOwn ? styles.active : ''}`}
        onClick={() => onSwitch(true)}
      >
        {t('common.board.mine')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!viewingOwn}
        className={`${styles.tab} ${!viewingOwn ? styles.active : ''}`}
        onClick={() => onSwitch(false)}
      >
        {partnerBoardLabel[0]}<bdi>{partnerLabel}</bdi>{partnerBoardLabel[1]}
      </button>
    </div>
  );
}
