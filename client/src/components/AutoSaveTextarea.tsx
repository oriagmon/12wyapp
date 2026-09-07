import { useId, useState } from 'react';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import styles from './AutoSaveTextarea.module.css';

export function AutoSaveTextarea({
  label,
  value,
  disabled,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(value);
  const status = useAsyncStatus();
  const id = useId();

  const commit = () => {
    if (disabled || text === value) return;
    status.run(() => onSave(text));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <StatusBadge status={status.status} error={status.error} />
      </div>
      <textarea
        ref={(element) => {
          if (element) autoResizeTextarea(element);
        }}
        id={id}
        className={styles.textarea}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        onChange={(e) => {
          autoResizeTextarea(e.currentTarget);
          setText(e.target.value);
        }}
        onBlur={commit}
      />
    </div>
  );
}
