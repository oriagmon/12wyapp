import styles from './RatingPicker.module.css';
import { useTranslation } from '../i18n';

export function RatingPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange?: (rating: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.row} role="group" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`${styles.pip} ${value !== null && n <= value ? styles.filled : ''}`}
            disabled={disabled}
            aria-pressed={value === n}
            aria-label={t('common.rating.outOfTen', { n })}
            onClick={() => onChange?.(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <span className={styles.value}>{value !== null ? `${value}/10` : t('common.rating.none')}</span>
    </div>
  );
}
