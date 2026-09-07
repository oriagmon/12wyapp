import styles from './RatingPicker.module.css';

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
            aria-label={`${n} מתוך 10`}
            onClick={() => onChange?.(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <span className={styles.value}>{value !== null ? `${value}/10` : 'טרם דורג'}</span>
    </div>
  );
}
