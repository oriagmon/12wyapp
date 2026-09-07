
import styles from './WeekdayPicker.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

export function WeekdayPicker({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const weekdayLabels = useWeekdayLabels();
  const toggle = (day: number) => {
    if (disabled) return;
    if (value.includes(day)) {
      onChange(value.filter((d) => d !== day));
    } else {
      onChange([...value, day].sort());
    }
  };

  return (
    <div className={styles.row} role="group" aria-label={t('common.weekdays.group')}>
      {weekdayLabels.short.map((label, day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            className={`${styles.day} ${active ? styles.active : ''}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => toggle(day)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
