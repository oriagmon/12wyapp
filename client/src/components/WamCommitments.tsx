import { useState } from 'react';
import type { CommitmentScope, WamCommitment, WamPartnershipMeta } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './WamCommitments.module.css';
import { useTranslation, type Translator } from '../i18n';

function scopeLabel(scope: CommitmentScope, partnership: WamPartnershipMeta, t: Translator): string {
  if (scope === 'shared') return t('wams.scope.shared');
  if (scope === 'a') return partnership.initiatorEmail;
  return partnership.inviteeEmail;
}

export function WamCommitments({
  commitments,
  partnership,
  canEditContent,
  locked,
  onAdd,
  onToggle,
  onUpdateLabel,
  onDelete,
}: {
  commitments: WamCommitment[];
  partnership: WamPartnershipMeta;
  canEditContent: boolean;
  locked: boolean;
  onAdd: (label: string, scope: CommitmentScope) => Promise<unknown>;
  onToggle: (id: number, done: boolean) => Promise<unknown>;
  onUpdateLabel: (id: number, label: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [newLabel, setNewLabel] = useState('');
  const [newScope, setNewScope] = useState<CommitmentScope>('shared');
  const addStatus = useAsyncStatus();

  const submitAdd = () => {
    if (newLabel.trim().length === 0) return;
    addStatus.run(() => onAdd(newLabel.trim(), newScope)).then((res) => {
      if (res !== undefined) setNewLabel('');
    });
  };

  return (
    <div className={`card ${styles.wrap}`}>
      <h3 className={styles.title}>{t('wams.commitments.title')}</h3>
      {commitments.length === 0 && <p className={styles.empty}>{t('wams.commitments.empty')}</p>}
      <ul className={styles.list}>
        {commitments.map((c) => (
          <CommitmentRow
            key={c.id}
            commitment={c}
            partnership={partnership}
            canEditContent={canEditContent && !locked}
            canToggle={!locked}
            onToggle={(done) => onToggle(c.id, done)}
            onUpdateLabel={(label) => onUpdateLabel(c.id, label)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
      </ul>

      {canEditContent && !locked && (
        <div className={styles.addRow}>
          <input
            type="text"
            placeholder={t('wams.commitments.placeholder')}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAdd();
            }}
            aria-label={t('wams.commitments.newLabel')}
          />
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value as CommitmentScope)}
            aria-label={t('wams.commitments.scopeLabel')}
          >
            <option value="shared">{t('wams.scope.shared')}</option>
            <option value="a">{partnership.initiatorEmail}</option>
            <option value="b">{partnership.inviteeEmail}</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={submitAdd}>
            {t('wams.commitments.add')}
          </button>
          <StatusBadge status={addStatus.status} error={addStatus.error} />
        </div>
      )}
      {locked && <p className={styles.reopenHint}>{t('wams.locked')}</p>}
      {!locked && !canEditContent && (
        <p className={styles.reopenHint}>{t('wams.completed')}</p>
      )}
    </div>
  );
}

function CommitmentRow({
  commitment,
  partnership,
  canEditContent,
  canToggle,
  onToggle,
  onUpdateLabel,
  onDelete,
}: {
  commitment: WamCommitment;
  partnership: WamPartnershipMeta;
  canEditContent: boolean;
  canToggle: boolean;
  onToggle: (done: boolean) => Promise<unknown>;
  onUpdateLabel: (label: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(commitment.label);
  const toggleStatus = useAsyncStatus();
  const editStatus = useAsyncStatus();
  const deleteStatus = useAsyncStatus();

  const commitLabel = () => {
    if (!canEditContent || label.trim() === commitment.label || label.trim().length === 0) return;
    editStatus.run(() => onUpdateLabel(label.trim()));
  };

  return (
    <li className={styles.item} id={`wam-commitment-${commitment.id}`} tabIndex={-1}>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={commitment.done}
          disabled={!canToggle}
          onChange={(e) => toggleStatus.run(() => onToggle(e.target.checked))}
        />
      </label>
      <input
        type="text"
        className={`${styles.itemInput} ${commitment.done ? styles.done : ''}`}
        value={label}
        disabled={!canEditContent}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        aria-label={t('wams.commitments.text')}
      />
      <span className={styles.scopeTag}>{scopeLabel(commitment.scope, partnership, t)}</span>
      {canEditContent && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => deleteStatus.run(onDelete)}
          aria-label={t('wams.commitments.deleteLabel')}
        >
          {t('wams.commitments.delete')}
        </button>
      )}
      <StatusBadge
        status={
          editStatus.status !== 'idle'
            ? editStatus.status
            : toggleStatus.status !== 'idle'
              ? toggleStatus.status
              : deleteStatus.status
        }
        error={editStatus.error ?? toggleStatus.error ?? deleteStatus.error}
      />
    </li>
  );
}
