import { useRef, type ReactNode } from 'react';
import styles from './FilePicker.module.css';

/**
 * A bare `<input type="file">` renders the browser's own control, whose label ("Choose
 * Files" / "No file chosen") is fixed by the OS locale and cannot be translated — leaving
 * English text sitting inside this Hebrew RTL app. The input therefore stays in the DOM
 * (it is still the real, accessible control, reachable by its `label`) but is visually
 * hidden behind a normal Hebrew button, mirroring the profile-avatar picker.
 */
export function FilePicker({
  label, accept, multiple = false, disabled = false, hint, onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        type="file"
        className={styles.input}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared before the handler runs so re-picking the same file still fires `change`.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span aria-hidden="true">📎</span> {label}
      </button>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
