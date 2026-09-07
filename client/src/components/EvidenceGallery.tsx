import { useMemo } from 'react';
import { useWeekEvidence, type WeekEvidenceItem } from '../hooks/useWeekEvidence';
import { WeekEvidenceCard } from './WeekEvidenceAlbum';
import styles from './WeekEvidenceAlbum.module.css';

/** Read-only history for all week albums, including every legacy tactic/day entry. */
export function EvidenceGallery({ cycleId }: { cycleId: number }) {
  const album = useWeekEvidence(cycleId, null);
  const weeks = useMemo(() => {
    const result = new Map<number, WeekEvidenceItem[]>();
    for (const item of album.items) result.set(item.week, [...(result.get(item.week) ?? []), item]);
    return [...result.entries()].sort(([a], [b]) => a - b);
  }, [album.items]);
  return (
    <section className={`card ${styles.album}`} aria-label="אלבומי המחזור">
      <h3 className={styles.title}>תמונות וצרופות מהמחזור</h3>
      {album.status === 'loading' && <p>טוען...</p>}
      {album.status === 'error' && <p role="alert">{album.error}</p>}
      {album.status === 'ready' && weeks.length === 0 && <p>עדיין אין תמונות או צרופות במחזור הזה.</p>}
      {weeks.map(([week, items]) => (
        <section key={week} aria-label={`אלבום שבוע ${week}`}>
          <h4>שבוע {week}</h4>
          <ul className={styles.items}>
            {items.map((item) => <WeekEvidenceCard key={`${cycleId}:${item.id}`} item={item} />)}
          </ul>
        </section>
      ))}
    </section>
  );
}
