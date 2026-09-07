import { useMemo, useState } from 'react';
import { usePartnerships } from '../hooks/usePartnerships';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { personLabel, personSubtitle } from '../lib/people';
import styles from './PartnerPanel.module.css';
import { useTranslation } from '../i18n';

export function PartnerPanel({
  partnerships,
}: {
  partnerships: ReturnType<typeof usePartnerships>;
}) {
  const { t } = useTranslation();
  const { state, candidates, loading, error, pair, remove } = partnerships;
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pairStatus = useAsyncStatus();

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return candidates;
    return candidates.filter((u) => u.email.toLowerCase().includes(q));
  }, [candidates, search]);

  // Word order around the partner's name differs per language, so split the sentence
  // at the placeholder and keep the name inside its own <bdi>.
  const connectedLabel = t('social.partner.connected').split('{name}');
  const submitPair = (targetUserId: number) => {
    setSelectedId(targetUserId);
    pairStatus.run(() => pair(targetUserId));
  };

  if (loading) return <div className={`card ${styles.wrap}`}>{t('social.partner.loading')}</div>;
  if (error) return <div className={`card ${styles.wrap} ${styles.errorState}`}>{error}</div>;
  if (!state) return null;

  return (
    <div className={`card ${styles.wrap}`}>
      <h3 className={styles.title}>{t('social.partner.title')}</h3>

      {state.partner ? (
        <div className={styles.partnerRow}>
          <span>
            {connectedLabel[0]}
            <strong><bdi>{personLabel(state.partner)}</bdi></strong>
            {connectedLabel[1]}
            {personSubtitle(state.partner) && <span className={styles.subtle}> · {state.partner.email}</span>}
          </span>
          <RemoveButton onRemove={() => remove(state.partner!.partnershipId)} />
        </div>
      ) : (
        <>
          <p className={styles.hint}>
            {t('social.partner.pickHint')}{' '}
            {t('social.partner.pickHint2')}
          </p>
          <div className={styles.searchRow}>
            <input
              type="text"
              placeholder={t('social.partner.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('social.partner.searchLabel')}
            />
          </div>

          {filteredCandidates.length === 0 ? (
            <p className={styles.empty}>
              {candidates && candidates.length === 0
                ? t('social.partner.noneAvailable')
                : t('social.partner.noResults')}
            </p>
          ) : (
            <ul className={styles.candidateList}>
              {filteredCandidates.map((u) => (
                <li key={u.id} className={styles.candidateRow}>
                  <span>{u.email}</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => submitPair(u.id)}
                    disabled={pairStatus.status === 'saving' && selectedId === u.id}
                  >
                    {t('social.partner.pick')}
                  </button>
                  {selectedId === u.id && (
                    <StatusBadge status={pairStatus.status} error={pairStatus.error} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
        {t('social.partner.remove')}
      </button>
    );
  }
  return (
    <span className="status-badge">
      {t('social.partner.confirmRemove')}{' '}
      <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
        {t('social.partner.confirmYes')}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
        {t('common.action.cancel')}
      </button>
    </span>
  );
}
