import { useEffect, useRef, useState } from 'react';
import { useWeekEvidence, downloadWeekEvidenceFile, fetchWeekEvidenceFile, type WeekEvidenceItem } from '../hooks/useWeekEvidence';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { FilePicker } from './FilePicker';

import styles from './WeekEvidenceAlbum.module.css';
import { useWeekdayLabels } from '../i18n/useWeekdayLabels';
import { useTranslation } from '../i18n';

export function WeekEvidenceCard({ item, onSave, onRemove }: {
  item: WeekEvidenceItem;
  onSave?: (input: { note: string; link: string }) => Promise<void>;
  onRemove?: (fileOnly?: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const weekdayLabels = useWeekdayLabels();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note ?? '');
  const [link, setLink] = useState(item.link ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const status = useAsyncStatus();
  const previewUrl = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  const label = item.scope === 'week'
    ? t('week.album.weekAttachment')
    : item.weekday === null
      ? t('week.album.legacyItem', { title: item.tacticTitle ?? t('week.album.tactic') })
      : t('week.album.legacyItemDay', {
          title: item.tacticTitle ?? t('week.album.tactic'),
          day: weekdayLabels.short[item.weekday],
        });
  const showPreview = () => status.run(async () => {
    const blob = await fetchWeekEvidenceFile(item);
    if (!alive.current) return;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(blob);
    setPreview(previewUrl.current);
  });
  return (
    <li className={styles.item} aria-label={label}>
      <p className={styles.caption}>{label}</p>
      {preview && <img className={styles.preview} src={preview} alt={item.fileOriginalName ?? t('week.album.imageAlt')} />}
      {item.note && <p className={styles.note}>{item.note}</p>}
      {item.link && <a className={styles.link} href={item.link} target="_blank" rel="noreferrer noopener">{item.link}</a>}
      {item.hasFile && (
        <div className={styles.actions}>
          <span className={styles.filename}>{item.fileOriginalName ?? t('week.evidence.file')} · {Math.ceil((item.fileSize ?? 0) / 1024)} KB</span>
          {item.fileMime?.startsWith('image/') && !preview && (
            <button className="btn btn-ghost btn-sm" type="button" disabled={status.status === 'saving'} onClick={showPreview}>{t('week.album.showImage')}</button>
          )}
          <button className="btn btn-ghost btn-sm" type="button" disabled={status.status === 'saving'} onClick={() => status.run(() => downloadWeekEvidenceFile(item))}>{t('week.album.download')}</button>
        </div>
      )}
      {editing && onSave && (
        <form className={styles.editor} onSubmit={(event) => {
          event.preventDefault();
          void status.run(async () => { await onSave({ note, link }); setEditing(false); });
        }}>
          <label>{t('week.album.note')}<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label>
          <label>{t('week.album.link')}<input type="url" value={link} maxLength={2048} onChange={(event) => setLink(event.target.value)} /></label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={status.status === 'saving'}>{t('week.album.saveItem')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('common.action.cancel')}</button>
        </form>
      )}
      {onSave && !editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNote(item.note ?? ''); setLink(item.link ?? ''); setEditing(true); }}>{t('week.album.editNote')}</button>}
      {onRemove && (
        <div className={styles.actions}>
          {item.hasFile && (item.note || item.link) && <button type="button" className="btn btn-ghost btn-sm" disabled={status.status === 'saving'} onClick={() => status.run(() => onRemove(true))}>{t('week.album.removeFileOnly')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={status.status === 'saving'} onClick={() => status.run(() => onRemove())}>{t('week.album.deleteItem')}</button>
        </div>
      )}
      <StatusBadge status={status.status} error={status.error} />
    </li>
  );
}

/** Keyed by the full scope: drafts/uploads/previews cannot spill into another week or user. */
export function WeekEvidenceAlbum(props: { cycleId: number; week: number; isOwner: boolean }) {
  return <WeekAlbumBody key={`${props.cycleId}:${props.week}`} {...props} />;
}

function WeekAlbumBody({ cycleId, week, isOwner }: { cycleId: number; week: number; isOwner: boolean }) {
  const { t } = useTranslation();
  const album = useWeekEvidence(cycleId, week);
  const uploadStatus = useAsyncStatus();
  const noteStatus = useAsyncStatus();
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const canEdit = isOwner && album.access === 'owner' && album.status === 'ready';
  return (
    <section className={`card ${styles.album}`} aria-label={t('week.weekAlbum.label', { week })}>
      <h3 className={styles.title}>{t('week.weekAlbum.title', { week })}</h3>
      <p className={styles.caption}>{t('week.album.caption')}</p>
      {album.status === 'loading' && <p role="status">{t('week.weekAlbum.loading')}</p>}
      {album.status === 'error' && <div><p role="alert">{album.error}</p><button type="button" className="btn btn-ghost" onClick={() => void album.reload()}>{t('week.album.retry')}</button></div>}
      {canEdit && (
        <>
          <FilePicker
            label={t('week.album.uploadLabel', { week })}
            accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt"
            multiple
            disabled={uploadStatus.status === 'saving'}
            hint={t('week.album.uploadHint')}
            onFiles={(files) => void uploadStatus.run(() => album.uploadFiles(files))}
          />
          <StatusBadge status={uploadStatus.status} error={uploadStatus.error} />
          <details>
            <summary>{t('week.album.addNoteSummary')}</summary>
            <form className={styles.editor} onSubmit={(event) => {
              event.preventDefault();
              void noteStatus.run(async () => { await album.save({ note, link }); setNote(''); setLink(''); });
            }}>
              <label>{t('week.album.weekNote')}<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label>
              <label>{t('week.album.weekLink')}<input type="url" value={link} maxLength={2048} onChange={(event) => setLink(event.target.value)} /></label>
              <button type="submit" className="btn btn-primary btn-sm" disabled={noteStatus.status === 'saving' || (!note.trim() && !link.trim())}>{t('week.album.addToAlbum')}</button>
              <StatusBadge status={noteStatus.status} error={noteStatus.error} />
            </form>
          </details>
        </>
      )}
      {album.status === 'ready' && album.items.length === 0 && <p className={styles.caption}>{t('week.weekAlbum.empty')}</p>}
      {album.items.some((item) => item.scope !== 'week') && <p className={styles.caption}>{t('week.album.legacyHint')}</p>}
      <ul className={styles.items}>
        {album.items.map((item) => (
          <WeekEvidenceCard key={`${item.id}:${item.updatedAt}:${item.hasFile}`} item={item}
            onSave={canEdit ? (input) => album.save(input, item.id) : undefined}
            onRemove={canEdit ? (fileOnly) => album.remove(item.id, fileOnly) : undefined} />
        ))}
      </ul>
    </section>
  );
}
