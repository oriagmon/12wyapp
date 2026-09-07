import { useState } from 'react';
import type { WamListResponse, WamSummary } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { DuoStreakCard } from './DuoStreakCard';
import { TimeAgo } from './TimeAgo';
import { useDateFormat } from '../lib/relativeTime';
import styles from './WamListPanel.module.css';

/** Starting a new cycle restarts the week numbering, so an archive can legitimately hold
 *  several "שבוע 1" rows. Without a date they are impossible to tell apart. */
function wamMoment(summary: WamSummary): string {
  return summary.completedAt ?? summary.updatedAt;
}

function StatusTag({ summary }: { summary: WamSummary }) {
  return (
    <>
      <span className={`${styles.badge} ${summary.status === 'complete' ? styles.badgeComplete : ''}`}>
        {summary.status === 'complete' ? 'הושלמה' : 'טיוטה'}
      </span>
      {summary.isHistorical && <span className={styles.historicalTag}>🔒 היסטוריה</span>}
    </>
  );
}

export function WamListPanel({
  data,
  onOpenById,
  onStartOrOpenCurrent,
  onSearch,
  selectedWeek,
  onWeekChange,
}: {
  data: WamListResponse;
  onOpenById: (id: number, week: number) => void;
  onStartOrOpenCurrent: (week: number) => Promise<unknown>;
  onSearch: (q: string) => Promise<WamSummary[]>;
  selectedWeek?: number;
  onWeekChange?: (week: number) => void;
}) {
  const { formatAbsolute } = useDateFormat();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WamSummary[] | null>(null);
  const searchStatus = useAsyncStatus();
  const startStatus = useAsyncStatus();
  const [localWeekToStart, setWeekToStart] = useState(1);
  const weekToStart = selectedWeek ?? localWeekToStart;

  // "Latest" = most recently touched meeting across every cycle era, not just the highest
  // week number (which would be misleading once someone has started a new cycle and is back
  // at week 1 while older, higher-numbered meetings still exist as history).
  const latest = [...data.wams].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];

  const runSearch = () => {
    if (query.trim().length === 0) {
      setSearchResults(null);
      return;
    }
    searchStatus.run(() => onSearch(query)).then((res) => {
      if (res !== undefined) setSearchResults(res);
    });
  };

  const handleStart = () => {
    startStatus.run(() => onStartOrOpenCurrent(weekToStart));
  };

  if (!data.partnership) {
    return (
      <div className={`card ${styles.emptyState}`}>
        <h3 className={styles.emptyTitle}>אין עדיין שותף/ה מאושר/ת</h3>
        <p className={styles.emptyText}>
          פגישות אחריותיות שבועיות זמינות רק לאחר חיבור לשותף/ה. הוסיפו שותף/ה בלשונית ההגדרות מתחת ללוח.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.startCard}`}>
        <div className={styles.startText}>
          <h2 className={styles.latestTitle}>פגישה משותפת · WAM</h2>
          <p className={styles.startHint}>
            נפגשים פעם בשבוע, עוברים על הביצועים, ומסכמים מחויבויות להמשך. המיקוד והטקטיקות לשבוע
            הבא נקבעים בתכנון האישי שלמעלה.
          </p>
        </div>
        <div className={styles.startControls}>
          <label className={styles.startLabel} htmlFor="wam-week">שבוע</label>
          <select id="wam-week" value={weekToStart} onChange={(e) => {
            const week = Number(e.target.value);
            if (onWeekChange) onWeekChange(week);
            else setWeekToStart(week);
          }} aria-label="שבוע לפגישה">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                שבוע {w}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleStart}>
            פתיחת הפגישה
          </button>
          <StatusBadge status={startStatus.status} error={startStatus.error} />
        </div>
      </div>

      {latest && (
        <div className={`card ${styles.latestCard}`}>
          <div className={styles.latestHeader}>
            <h3 className={styles.latestTitle}>הפגישה האחרונה — שבוע {latest.week}</h3>
            <span className={styles.latestWhen}>
              {latest.completedAt ? 'הושלמה ' : 'עודכנה '}
              <TimeAgo iso={wamMoment(latest)} />
            </span>
          </div>
          <div className={styles.latestBody}>
            <StatusTag summary={latest} />
            <span className={styles.fact}>
              ציוני השבוע: {latest.scoreSnapshotA === null && latest.scoreSnapshotB === null
                ? 'לא נשמרו'
                : `${latest.scoreSnapshotA ?? '?'}% · ${latest.scoreSnapshotB ?? '?'}%`}
            </span>
            <span className={styles.fact}>
              דירוג עצמי: {latest.ratingA === null && latest.ratingB === null
                ? 'טרם דורג'
                : `${latest.ratingA ?? '?'} · ${latest.ratingB ?? '?'}`}
            </span>
            <span className={styles.fact}>
              {latest.commitmentsTotal === 0
                ? 'לא נקבעו מחויבויות'
                : `מחויבויות: ${latest.commitmentsDone} מתוך ${latest.commitmentsTotal}`}
            </span>
            {latest.punishmentsDueTotal > 0 && (
              <span className={styles.fact}>
                עונשים לביצוע: {latest.punishmentsDueDone} מתוך {latest.punishmentsDueTotal}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenById(latest.id, latest.week)}>
            {latest.status === 'complete' ? 'צפייה בסיכום' : 'המשך מאיפה שעצרנו'}
          </button>
        </div>
      )}

      <DuoStreakCard duoStreak={data.duoStreak} />

      <div className={`card ${styles.searchCard}`}>
        <div className={styles.searchRow}>
          <input
            type="text"
            placeholder="חיפוש בהערות, לקחים, מחויבויות ועונשים..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            aria-label="חיפוש בפגישות האחריותיות"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={runSearch}>
            חיפוש
          </button>
          <StatusBadge status={searchStatus.status} error={searchStatus.error} />
        </div>
        {searchResults !== null && (
          <div className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <p className={styles.empty}>לא נמצאו תוצאות.</p>
            ) : (
              searchResults.map((w) => (
                <button key={w.id} type="button" className={styles.searchResultRow} onClick={() => onOpenById(w.id, w.week)}>
                  שבוע {w.week} — {w.status === 'complete' ? 'הושלמה' : 'טיוטה'}
                  {' · '}{formatAbsolute(wamMoment(w))}
                  {w.isHistorical ? ' (היסטוריה)' : ''}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <details className={`card ${styles.listCard}`}>
        <summary className={styles.listTitle}>כל הפגישות ({data.wams.length})</summary>
        {data.wams.length === 0 ? (
          <p className={styles.empty}>עדיין לא התקיימה אף פגישה. אפשר לפתוח אחת למעלה.</p>
        ) : (
          <ul className={styles.weekList}>
            {[...data.wams].reverse().map((summary) => (
              <li key={summary.id} className={styles.weekRow}>
                <span className={styles.weekNum}>שבוע {summary.week}</span>
                <span className={styles.rowWhen}>{formatAbsolute(wamMoment(summary))}</span>
                <StatusTag summary={summary} />
                <span className={styles.miniInfo}>
                  {summary.scoreSnapshotA === null && summary.scoreSnapshotB === null
                    ? 'ללא ציונים'
                    : `${summary.scoreSnapshotA ?? '?'}% · ${summary.scoreSnapshotB ?? '?'}%`}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenById(summary.id, summary.week)}>
                  פתיחה
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
