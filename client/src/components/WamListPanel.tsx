import { useState } from 'react';
import type { WamListResponse, WamSummary } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { DuoStreakCard } from './DuoStreakCard';
import { TimeAgo } from './TimeAgo';
import { useDateFormat } from '../lib/relativeTime';
import styles from './WamListPanel.module.css';
import { useTranslation } from '../i18n';

/** Starting a new cycle restarts the week numbering, so an archive can legitimately hold
 *  several "week 1" rows. Without a date they are impossible to tell apart. */
function wamMoment(summary: WamSummary): string {
  return summary.completedAt ?? summary.updatedAt;
}

function StatusTag({ summary }: { summary: WamSummary }) {
  const { t } = useTranslation();
  return (
    <>
      <span className={`${styles.badge} ${summary.status === 'complete' ? styles.badgeComplete : ''}`}>
        {summary.status === 'complete' ? t('wams.list.complete') : t('wams.list.draft')}
      </span>
      {summary.isHistorical && <span className={styles.historicalTag}>{t('wams.list.historical')}</span>}
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
  const { t } = useTranslation();
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
        <h3 className={styles.emptyTitle}>{t('wams.list.noPartnerTitle')}</h3>
        <p className={styles.emptyText}>
          {t('wams.list.noPartnerBody')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.startCard}`}>
        <div className={styles.startText}>
          <h2 className={styles.latestTitle}>{t('wams.list.title')}</h2>
          <p className={styles.startHint}>
            {t('wams.list.blurb')}
          </p>
        </div>
        <div className={styles.startControls}>
          <label className={styles.startLabel} htmlFor="wam-week">{t('wams.list.weekLabel')}</label>
          <select id="wam-week" value={weekToStart} onChange={(e) => {
            const week = Number(e.target.value);
            if (onWeekChange) onWeekChange(week);
            else setWeekToStart(week);
          }} aria-label={t('wams.list.weekSelect')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {t('wams.list.weekOption', { week: w })}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleStart}>
            {t('wams.list.open')}
          </button>
          <StatusBadge status={startStatus.status} error={startStatus.error} />
        </div>
      </div>

      {latest && (
        <div className={`card ${styles.latestCard}`}>
          <div className={styles.latestHeader}>
            <h3 className={styles.latestTitle}>{t('wams.list.latestTitle', { week: latest.week })}</h3>
            <span className={styles.latestWhen}>
              {latest.completedAt ? t('wams.list.completedAt') : t('wams.list.updatedAt')}
              <TimeAgo iso={wamMoment(latest)} />
            </span>
          </div>
          <div className={styles.latestBody}>
            <StatusTag summary={latest} />
            <span className={styles.fact}>
              {t('wams.list.scores', {
                value: latest.scoreSnapshotA === null && latest.scoreSnapshotB === null
                  ? t('wams.list.scoresNone')
                  : `${latest.scoreSnapshotA ?? '?'}% · ${latest.scoreSnapshotB ?? '?'}%`,
              })}
            </span>
            <span className={styles.fact}>
              {t('wams.list.ratings', {
                value: latest.ratingA === null && latest.ratingB === null
                  ? t('wams.list.ratingsNone')
                  : `${latest.ratingA ?? '?'} · ${latest.ratingB ?? '?'}`,
              })}
            </span>
            <span className={styles.fact}>
              {latest.commitmentsTotal === 0
                ? t('wams.list.noCommitments')
                : t('wams.list.commitments', {
                    done: latest.commitmentsDone,
                    total: latest.commitmentsTotal,
                  })}
            </span>
            {latest.punishmentsDueTotal > 0 && (
              <span className={styles.fact}>
                {t('wams.list.duePunishments', {
                  done: latest.punishmentsDueDone,
                  total: latest.punishmentsDueTotal,
                })}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenById(latest.id, latest.week)}>
            {latest.status === 'complete' ? t('wams.list.viewSummary') : t('wams.list.resume')}
          </button>
        </div>
      )}

      <DuoStreakCard duoStreak={data.duoStreak} />

      <div className={`card ${styles.searchCard}`}>
        <div className={styles.searchRow}>
          <input
            type="text"
            placeholder={t('wams.list.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            aria-label={t('wams.list.searchLabel')}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={runSearch}>
            {t('wams.list.search')}
          </button>
          <StatusBadge status={searchStatus.status} error={searchStatus.error} />
        </div>
        {searchResults !== null && (
          <div className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <p className={styles.empty}>{t('wams.list.noResults')}</p>
            ) : (
              searchResults.map((w) => (
                <button key={w.id} type="button" className={styles.searchResultRow} onClick={() => onOpenById(w.id, w.week)}>
                  {t('wams.list.resultRow', {
                    week: w.week,
                    status: w.status === 'complete' ? t('wams.list.complete') : t('wams.list.draft'),
                  })}
                  {' · '}{formatAbsolute(wamMoment(w))}
                  {w.isHistorical ? t('wams.list.resultHistorical') : ''}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <details className={`card ${styles.listCard}`}>
        <summary className={styles.listTitle}>{t('wams.list.allTitle', { count: data.wams.length })}</summary>
        {data.wams.length === 0 ? (
          <p className={styles.empty}>{t('wams.list.allEmpty')}</p>
        ) : (
          <ul className={styles.weekList}>
            {[...data.wams].reverse().map((summary) => (
              <li key={summary.id} className={styles.weekRow}>
                <span className={styles.weekNum}>{t('wams.list.rowWeek', { week: summary.week })}</span>
                <span className={styles.rowWhen}>{formatAbsolute(wamMoment(summary))}</span>
                <StatusTag summary={summary} />
                <span className={styles.miniInfo}>
                  {summary.scoreSnapshotA === null && summary.scoreSnapshotB === null
                    ? t('wams.list.rowNoScores')
                    : `${summary.scoreSnapshotA ?? '?'}% · ${summary.scoreSnapshotB ?? '?'}%`}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenById(summary.id, summary.week)}>
                  {t('wams.list.rowOpen')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
