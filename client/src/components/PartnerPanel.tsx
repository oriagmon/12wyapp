import { useMemo, useState } from 'react';
import { usePartnerships } from '../hooks/usePartnerships';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { personLabel, personSubtitle } from '../lib/people';
import styles from './PartnerPanel.module.css';

export function PartnerPanel({
  partnerships,
}: {
  partnerships: ReturnType<typeof usePartnerships>;
}) {
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

  const submitPair = (targetUserId: number) => {
    setSelectedId(targetUserId);
    pairStatus.run(() => pair(targetUserId));
  };

  if (loading) return <div className={`card ${styles.wrap}`}>טוען שותפויות...</div>;
  if (error) return <div className={`card ${styles.wrap} ${styles.errorState}`}>{error}</div>;
  if (!state) return null;

  return (
    <div className={`card ${styles.wrap}`}>
      <h3 className={styles.title}>שותף/ה לאחריותיות</h3>

      {state.partner ? (
        <div className={styles.partnerRow}>
          <span>
            מחוברים עם <strong><bdi>{personLabel(state.partner)}</bdi></strong>{personSubtitle(state.partner) && <span className={styles.subtle}> · {state.partner.email}</span>}
          </span>
          <RemoveButton onRemove={() => remove(state.partner!.partnershipId)} />
        </div>
      ) : (
        <>
          <p className={styles.hint}>
            בחירת שותף/ה יוצרת שיתוף מיידי ודו-כיווני — ללא הזמנה נוספת.
            מוצגים רק חשבונות הזמינים לשיתוף לפי מדיניות הגישה. ודאו שבחרתם את השותף/ה הנכון/ה.
          </p>
          <div className={styles.searchRow}>
            <input
              type="text"
              placeholder="חיפוש לפי אימייל..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="חיפוש משתמש/ת לבחירה כשותף/ה"
            />
          </div>

          {filteredCandidates.length === 0 ? (
            <p className={styles.empty}>
              {candidates && candidates.length === 0 ? 'אין כרגע חשבונות זמינים לשיתוף.' : 'לא נמצאו תוצאות.'}
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
                    בחירה כשותף/ה
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
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
        הסרת שיתוף
      </button>
    );
  }
  return (
    <span className="status-badge">
      לאשר הסרה?{' '}
      <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
        כן, הסר
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
        ביטול
      </button>
    </span>
  );
}
