import { useEffect, useState } from 'react';
import type { WamDetail, WamPartnershipMeta, WamPunishment } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './WamPunishments.module.css';
import { useTranslation } from '../i18n';

const MAX_LABEL_LENGTH = 300;

function otherUserId(partnership: WamPartnershipMeta, myUserId: number): number {
  return partnership.initiatorId === myUserId ? partnership.inviteeId : partnership.initiatorId;
}

/** Source-side "Punishments" composer + author-aware list for a WAM. Either partnership
 *  member may add an item (assigning it to themself or the other member); only its own
 *  author may edit, reassign, or delete it. Read-only entirely once the WAM is
 *  complete/historical, or once the item's own *due* WAM has itself become frozen
 *  (complete/historical) — both server-enforced too, `punishment.canEdit` already reflects
 *  both, this only avoids a doomed round trip and hides controls accordingly. */
export function WamPunishments({
  wam,
  myUserId,
  sourceEditable,
  canAdd,
  onAdd,
  onUpdateLabel,
  onReassign,
  onDelete,
}: {
  wam: WamDetail;
  myUserId: number;
  /** True whenever the source WAM itself is an editable, non-historical draft — regardless
   *  of whether a new punishment could actually ever be checked off (see `canAdd`). Used only
   *  to distinguish "hidden because the WAM isn't editable at all" from "editable, but adding
   *  is specifically blocked by an already-frozen next WAM", which gets its own explanation. */
  sourceEditable: boolean;
  /** Server-derived: true only when a NEW punishment added right now could ever be checked
   *  off (`WamDetail.canAddPunishment`). */
  canAdd: boolean;
  onAdd: (label: string, assignedUserId: number) => Promise<unknown>;
  onUpdateLabel: (id: number, label: string) => Promise<unknown>;
  onReassign: (id: number, assignedUserId: number) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { partnership, punishments } = wam;
  const partnerId = otherUserId(partnership, myUserId);
  const [newLabel, setNewLabel] = useState('');
  const [assignTo, setAssignTo] = useState<'me' | 'partner'>('partner');
  const addStatus = useAsyncStatus();
  const adding = addStatus.status === 'saving';

  const submitAdd = () => {
    if (adding) return; // in-flight guard — a rapid double Enter/click must not double-submit
    const trimmed = newLabel.trim();
    if (trimmed.length === 0) return;
    const assignedUserId = assignTo === 'me' ? myUserId : partnerId;
    addStatus.run(() => onAdd(trimmed, assignedUserId)).then((res) => {
      if (res !== undefined) setNewLabel('');
    });
  };

  return (
    <div className={`card ${styles.wrap}`}>
      <h3 className={styles.title}>{t('wams.punishments.title')}</h3>
      {punishments.length === 0 && <p className={styles.empty}>{t('wams.punishments.empty')}</p>}
      <ul className={styles.list}>
        {punishments.map((p) => (
          <PunishmentRow
            key={p.id}
            punishment={p}
            myUserId={myUserId}
            partnerId={partnerId}
            onUpdateLabel={(label) => onUpdateLabel(p.id, label)}
            onReassign={(assignedUserId) => onReassign(p.id, assignedUserId)}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </ul>

      {canAdd && (
        <div className={styles.addRow}>
          <input
            type="text"
            placeholder={t('wams.punishments.placeholder')}
            value={newLabel}
            maxLength={MAX_LABEL_LENGTH}
            disabled={adding}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !adding) submitAdd();
            }}
            aria-label={t('wams.punishments.newLabel')}
          />
          <select
            value={assignTo}
            disabled={adding}
            onChange={(e) => setAssignTo(e.target.value as 'me' | 'partner')}
            aria-label={t('wams.punishments.assignLabel')}
          >
            <option value="me">{t('wams.punishments.onMe')}</option>
            <option value="partner">{t('wams.punishments.onPartner')}</option>
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={submitAdd} disabled={adding}>
            {t('wams.punishments.add')}
          </button>
          <StatusBadge status={addStatus.status} error={addStatus.error} />
        </div>
      )}
      {/* The source WAM is otherwise editable, but adding would create a punishment that
          could never be checked off — its would-be next WAM is already frozen. */}
      {!canAdd && sourceEditable && (
        <p className={styles.blockedHint}>
          {t('wams.punishments.blocked')}
        </p>
      )}
    </div>
  );
}

type PendingConfirmation = { type: 'reassign'; target: 'me' | 'partner' } | { type: 'delete' } | null;

function PunishmentRow({
  punishment,
  myUserId,
  partnerId,
  onUpdateLabel,
  onReassign,
  onDelete,
}: {
  punishment: WamPunishment;
  myUserId: number;
  partnerId: number;
  onUpdateLabel: (label: string) => Promise<unknown>;
  onReassign: (assignedUserId: number) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [label, setLabel] = useState(punishment.label);
  // A single shared status for every action on this row (label save, reassign, delete) —
  // whichever ran most recently is what's shown, so an older "saved" badge can never mask a
  // newer error, and — since `busy` below gates every control — no two actions on the same
  // row can ever overlap (e.g. a reassign firing mid-label-save).
  const { t } = useTranslation();
  const rowStatus = useAsyncStatus();
  const busy = rowStatus.status === 'saving';
  // A completed item's reassignment (and, for consistency, its deletion) requires an explicit
  // confirmation explaining that the change resets the recorded completion. The select stays
  // fully controlled from `punishment.assignedUserId` (never a separate local draft), so
  // cancelling this confirmation leaves the visible selection/record entirely unchanged.
  const [pending, setPending] = useState<PendingConfirmation>(null);

  // Keeps the local draft in sync with a server-confirmed label arriving via props (e.g. a
  // refresh, or another tab's edit) — without this, an external update would never be
  // reflected once the user had ever touched the input.
  useEffect(() => {
    setLabel(punishment.label);
  }, [punishment.label]);

  const commitLabel = () => {
    if (busy || !punishment.canEdit || label.trim() === punishment.label || label.trim().length === 0) return;
    rowStatus.run(() => onUpdateLabel(label.trim()));
  };

  const handleReassignChange = (target: 'me' | 'partner') => {
    if (busy) return;
    const currentlyMe = punishment.assignedUserId === myUserId;
    if ((currentlyMe && target === 'me') || (!currentlyMe && target === 'partner')) return; // no actual change
    if (punishment.done) {
      setPending({ type: 'reassign', target });
      return;
    }
    rowStatus.run(() => onReassign(target === 'me' ? myUserId : partnerId));
  };

  const handleDeleteClick = () => {
    if (busy) return;
    if (punishment.done) {
      setPending({ type: 'delete' });
      return;
    }
    rowStatus.run(onDelete);
  };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.type === 'reassign') {
      rowStatus.run(() => onReassign(pending.target === 'me' ? myUserId : partnerId));
    } else {
      rowStatus.run(onDelete);
    }
    setPending(null);
  };

  return (
    <li className={styles.item} id={`wam-punishment-${punishment.id}`} tabIndex={-1}>
      <input
        type="text"
        className={styles.itemInput}
        value={label}
        maxLength={MAX_LABEL_LENGTH}
        disabled={!punishment.canEdit || busy}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy) {
            e.currentTarget.blur();
          }
        }}
        aria-label={t('wams.punishments.text')}
      />
      <span className={styles.metaTag}>{t('wams.punishments.by', { name: punishment.authorLabel })}</span>
      {/* The assignee is always visible, profile-aware, and unambiguous — even when the
          author also gets a reassign control right next to it. */}
      <span className={styles.metaTag}>{t('wams.punishments.on', { name: punishment.assigneeLabel })}</span>
      {punishment.done && (
        <span className={styles.doneStatus} role="status">
          {t('wams.punishments.done')}
        </span>
      )}
      {punishment.canEdit && (
        <select
          className={styles.metaSelect}
          value={punishment.assignedUserId === myUserId ? 'me' : 'partner'}
          disabled={busy}
          onChange={(e) => handleReassignChange(e.target.value as 'me' | 'partner')}
          aria-label={t('wams.punishments.reassign')}
        >
          <option value="me">{t('wams.punishments.onMe')}</option>
          <option value="partner">{t('wams.punishments.onPartner')}</option>
        </select>
      )}
      {punishment.canEdit && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleDeleteClick}
          disabled={busy}
          aria-label={t('wams.punishments.deleteLabel')}
        >
          {t('wams.punishments.delete')}
        </button>
      )}
      <StatusBadge status={rowStatus.status} error={rowStatus.error} />
      {pending && (
        <div className={styles.confirmBox} role="alertdialog" aria-label={t('wams.punishments.confirmLabel')}>
          <p>
            {pending.type === 'reassign'
              ? t('wams.punishments.confirmReassign')
              : t('wams.punishments.confirmDelete')}
          </p>
          <div className={styles.confirmActions}>
            <button type="button" className="btn btn-danger btn-sm" onClick={confirmPending}>
              {t('wams.punishments.confirmYes')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
              {t('wams.punishments.confirmNo')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
