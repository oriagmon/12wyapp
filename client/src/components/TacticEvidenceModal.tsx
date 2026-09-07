import { useState } from 'react';
import { useTacticEvidence, downloadTacticEvidenceFile, hasAcceptedEvidenceExtension, MAX_EVIDENCE_FILE_BYTES, type TacticEvidence } from '../hooks/useTacticEvidence';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { FilePicker } from './FilePicker';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { WEEKDAY_LABELS_HE } from '../lib/scoring';
import styles from './TacticEvidenceModal.module.css';

const MAX_NOTE_LENGTH = 2000;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function LegacyEvidence({ evidence }: { evidence: TacticEvidence }) {
  const status = useAsyncStatus();
  return (
    <li className={styles.legacyItem}>
      <h4 className={styles.legacyTitle}>עדות קודמת · {WEEKDAY_LABELS_HE[evidence.weekday!]}</h4>
      {evidence.note && <p className={styles.readOnlyField}>{evidence.note}</p>}
      {evidence.link && (
        <a href={evidence.link} target="_blank" rel="noreferrer noopener" className={styles.link}>{evidence.link}</a>
      )}
      {evidence.hasFile && (
        <div className={styles.fileRow}>
          <span>📎 {evidence.fileOriginalName ?? 'קובץ'} ({formatBytes(evidence.fileSize)})</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={status.status === 'saving'}
            aria-label={`הורדת קובץ קודם · ${WEEKDAY_LABELS_HE[evidence.weekday!]}`}
            onClick={() => status.run(() => downloadTacticEvidenceFile(evidence.tacticId, evidence.week, evidence.weekday, evidence.fileOriginalName))}
          >
            הורדה
          </button>
        </div>
      )}
      <StatusBadge status={status.status} error={status.error} />
    </li>
  );
}

interface TacticEvidenceModalProps {
  tacticId: number;
  week: number;
  tacticTitle: string;
  isOwner: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

/** New edits are weekly; every legacy entry remains independently readable/downloadable. */
export function TacticEvidenceModal(props: TacticEvidenceModalProps) {
  return <WeeklyEvidenceEditor key={`${props.tacticId}:${props.week}`} {...props} />;
}

function WeeklyEvidenceEditor({
  tacticId,
  week,
  tacticTitle,
  isOwner,
  onClose,
  onChanged,
}: TacticEvidenceModalProps) {
  const { evidence, legacyEvidence, canCreate, access, loadStatus, loadError, saveMeta, uploadFile, deleteFile, deleteAll, downloadFile } = useTacticEvidence(
    tacticId,
    week
  );
  const canEdit = isOwner && access === 'owner';
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const saveStatus = useAsyncStatus();
  const fileStatus = useAsyncStatus();
  const downloadStatus = useAsyncStatus();
  const deleteStatus = useAsyncStatus();

  // Seeds the local draft fields from the loaded evidence exactly once per week (never
  // again afterward, so the user's in-progress typing is never clobbered by a background
  // reload triggered by one of this same modal's own save actions).
  const seedKey = `${tacticId}:${week}`;
  if (loadStatus === 'ready' && seededFor !== seedKey) {
    setNote(evidence?.note ?? '');
    setLink(evidence?.link ?? '');
    setSeededFor(seedKey);
  }

  const handleSaveMeta = () =>
    saveStatus.run(async () => {
      await saveMeta({ note: note.trim(), link: link.trim() });
      onChanged?.();
    });

  const handleFileChosen = (file: File) => {
    setFileError(null);
    if (!hasAcceptedEvidenceExtension(file.name)) {
      setFileError('סוג קובץ לא נתמך — יש להעלות PNG, JPEG, WebP, PDF, DOCX או TXT בלבד');
      return;
    }
    if (file.size > MAX_EVIDENCE_FILE_BYTES) {
      setFileError('הקובץ גדול מדי — הגודל המרבי הוא 8MB');
      return;
    }
    fileStatus.run(async () => {
      await uploadFile(file);
      onChanged?.();
    });
  };

  const handleDeleteFile = () =>
    fileStatus.run(async () => {
      await deleteFile();
      onChanged?.();
    });

  const handleDeleteAll = () =>
    deleteStatus.run(async () => {
      await deleteAll();
      setNote('');
      setLink('');
      onChanged?.();
      if (legacyEvidence.length === 0) onClose();
    });

  const handleDownload = () => downloadStatus.run(() => downloadFile());

  const busy = [saveStatus, fileStatus, deleteStatus].some((status) => status.status === 'saving');

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`עדות עבור ${tacticTitle}`} onClick={onClose}>
      <div className={`card ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>{tacticTitle}</h3>
            <p className={styles.subtitle}>צרופות שבועיות · שבוע {week}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>

        {loadStatus === 'loading' && <p className={styles.text}>טוען...</p>}
        {loadStatus === 'error' && (
          <p className={styles.errorText} role="alert">
            {loadError}
          </p>
        )}

        {loadStatus === 'ready' && !canEdit && (
          <div className={styles.readOnly}>
            {!evidence && <p className={styles.text}>עדיין לא נוספה עדות שבועית.</p>}
            {evidence?.note && <p className={styles.readOnlyField}>{evidence.note}</p>}
            {evidence?.link && (
              <a href={evidence.link} target="_blank" rel="noreferrer noopener" className={styles.link}>
                {evidence.link}
              </a>
            )}
            {evidence?.hasFile && (
              <div className={styles.fileRow}>
                <span>
                  📎 {evidence.fileOriginalName ?? 'קובץ'} ({formatBytes(evidence.fileSize)})
                </span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={downloadStatus.status === 'saving'} onClick={handleDownload}>
                  הורדה
                </button>
              </div>
            )}
            <StatusBadge status={downloadStatus.status} error={downloadStatus.error} />
          </div>
        )}

        {loadStatus === 'ready' && canEdit && !evidence && !canCreate && (
          <p className={styles.text}>ניתן להוסיף עדות שבועית לאחר השלמת ביצוע אחד לפחות בשבוע.</p>
        )}
        {loadStatus === 'ready' && canEdit && (evidence || canCreate) && (
          <div className={styles.editor}>
            <h4 className={styles.legacyTitle}>עדות שבועית</h4>
            <label className={styles.label} htmlFor="evidence-note">
              מה עבד? (הערה)
            </label>
            <textarea
              id="evidence-note"
              ref={(el) => {
                if (el) autoResizeTextarea(el);
              }}
              className={styles.textarea}
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(e) => {
                autoResizeTextarea(e.currentTarget);
                setNote(e.target.value);
              }}
            />

            <label className={styles.label} htmlFor="evidence-link">
              קישור (אופציונלי)
            </label>
            <input
              id="evidence-link"
              type="url"
              className={styles.input}
              placeholder="https://..."
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />

            <div className={styles.actions}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={handleSaveMeta}>
                שמירה
              </button>
              <StatusBadge status={saveStatus.status} error={saveStatus.error} />
            </div>

            <div className={styles.fileSection}>
              <span className={styles.label}>קובץ מצורף</span>
              {evidence?.hasFile ? (
                <div className={styles.fileRow}>
                  <span>
                    📎 {evidence.fileOriginalName ?? 'קובץ'} ({formatBytes(evidence.fileSize)})
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={downloadStatus.status === 'saving'} onClick={handleDownload}>
                    הורדה
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={handleDeleteFile}>
                    הסרת קובץ
                  </button>
                </div>
              ) : (
                <FilePicker
                  label="בחירת קובץ עדות"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt"
                  disabled={busy}
                  hint="PNG, JPEG, WebP, PDF, DOCX או TXT · עד 8MB"
                  onFiles={(files) => handleFileChosen(files[0])}
                />
              )}
              {fileError && (
                <p className={styles.errorText} role="alert">
                  {fileError}
                </p>
              )}
              <StatusBadge status={fileStatus.status} error={fileStatus.error} />
              <StatusBadge status={downloadStatus.status} error={downloadStatus.error} />
            </div>

            {evidence && (
              <div className={styles.dangerZone}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={handleDeleteAll}>
                  מחיקת העדות השבועית
                </button>
                <StatusBadge status={deleteStatus.status} error={deleteStatus.error} />
              </div>
            )}
            {loadStatus === 'ready' && legacyEvidence.length > 0 && (
              <section className={styles.legacySection} aria-label="צרופות קודמות">
                <h4 className={styles.legacyTitle}>צרופות קודמות</h4>
                <p className={styles.text}>כל ההערות, הקישורים והקבצים שנוספו בעבר לפי ימים נשמרו כאן לצפייה ולהורדה. שמירה או מחיקה של העדות השבועית אינה משנה אותם.</p>
                <ul className={styles.legacyList}>
                  {legacyEvidence.map((item) => <LegacyEvidence key={item.weekday} evidence={item} />)}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
