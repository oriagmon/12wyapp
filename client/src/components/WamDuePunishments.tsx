import { useEffect, useState } from 'react';
import type { WamDetail, WamDuePunishment } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './WamDuePunishments.module.css';
import { useTranslation } from '../i18n';

/** "Due Punishments" checklist for the next WAM created after the one where each item was
 *  written. Either partner may view every item (author AND assignee are both always shown,
 *  so both viewers know exactly who owes what); only the assigned/punished user gets an
 *  enabled checkbox for their own row (never the item's author merely by authorship). Toggling
 *  is only possible while the *due* WAM itself is still draft and non-historical — the server
 *  enforces this too, this only avoids a doomed round trip. Completed rows cross out with a
 *  playful strikethrough animation, disabled entirely under `prefers-reduced-motion`. */
export function WamDuePunishments({
  wam,
  onToggle,
}: {
  wam: WamDetail;
  onToggle: (id: number, done: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { duePunishments } = wam;
  if (duePunishments.length === 0) return null;

  return (
    <div className={`card ${styles.wrap}`}>
      <h3 className={styles.title}>{t('wams.punishments.dueTitle')}</h3>
      <ul className={styles.list}>
        {duePunishments.map((p) => (
          <DueRow key={p.id} punishment={p} onToggle={(done) => onToggle(p.id, done)} />
        ))}
      </ul>
    </div>
  );
}

function DueRow({
  punishment,
  onToggle,
}: {
  punishment: WamDuePunishment;
  onToggle: (done: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const toggleStatus = useAsyncStatus();
  const busy = toggleStatus.status === 'saving';
  // Controlled optimistic checkbox: flips immediately on click for a snappy feel, but rolls
  // back to the last server-confirmed value if the request fails. Always re-synced from the
  // server-confirmed `punishment.done` prop (e.g. after a refresh, or the request actually
  // succeeding) so it can never drift from truth once settled.
  const [checked, setChecked] = useState(punishment.done);
  useEffect(() => {
    setChecked(punishment.done);
  }, [punishment.done]);

  const handleChange = (next: boolean) => {
    if (busy) return; // in-flight guard — a rapid double click cannot fire two toggles
    setChecked(next);
    toggleStatus.run(() => onToggle(next)).then((result) => {
      if (result === undefined) setChecked(punishment.done); // failed — roll back optimism
    });
  };

  return (
    <li className={`${styles.item} ${checked ? styles.done : ''}`}>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!punishment.canToggle || busy}
          onChange={(e) => handleChange(e.target.checked)}
          aria-label={t('wams.punishments.markLabel', { label: punishment.label })}
        />
      </label>
      <span className={styles.label}>{punishment.label}</span>
      <span className={styles.metaTag}>{t('wams.punishments.by', { name: punishment.authorLabel })}</span>
      <span className={styles.metaTag}>{t('wams.punishments.on', { name: punishment.assigneeLabel })}</span>
      <span className={styles.metaTag}>{t('wams.punishments.fromWeek', { week: punishment.sourceWeek })}</span>
      {checked && (
        <span className={styles.doneStatus} role="status">
          {t('wams.punishments.done')}
        </span>
      )}
      <StatusBadge status={toggleStatus.status} error={toggleStatus.error} />
    </li>
  );
}
