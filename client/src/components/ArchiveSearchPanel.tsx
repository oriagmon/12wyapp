import { useId, useState } from 'react';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { ARCHIVE_SEARCH_CATEGORIES, type ArchiveSearchCategory, type ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import styles from './ArchiveSearchPanel.module.css';

export interface ArchiveSearchPanelProps {
  onNavigate: (target: ArchiveSearchTarget) => void;
}

const labels: Record<ArchiveSearchCategory, string> = {
  cycles: 'מחזורים', goals: 'מטרות', tactics: 'טקטיקות', wams: 'פגישות אחריותיות',
  commitments: 'התחייבויות', punishments: 'עונשים', reminders: 'תזכורות',
};
const ownershipLabels = { mine: 'שלי', partner: 'של השותף/ה', shared: 'משותף' };

function Highlight({ text, query }: { text: string; query: string }) {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const haystack = fold(text);
  const needle = fold(query);
  if (!needle) return <>{text}</>;
  const parts = [];
  let offset = 0;
  let index = haystack.indexOf(needle, offset);
  while (index !== -1) {
    parts.push(text.slice(offset, index));
    parts.push(<mark className={styles.match} key={index}>{text.slice(index, index + needle.length)}</mark>);
    offset = index + needle.length;
    index = haystack.indexOf(needle, offset);
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

export function ArchiveSearchPanel({ onNavigate }: ArchiveSearchPanelProps) {
  const { query, changeQuery, data, status, error, search } = useArchiveSearch();
  const [category, setCategory] = useState<ArchiveSearchCategory | 'all'>('all');
  const id = useId();
  const groups = data?.groups.filter((group) => category === 'all' || group.category === category) ?? [];
  const visibleCount = groups.reduce((sum, group) => sum + group.count, 0);

  return (
    <section className={styles.panel} dir="rtl" aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`} className={styles.title}>חיפוש בכל המחזורים</h2>
        <p id={`${id}-help`} className={styles.help}>
          מצאו החלטות, מטרות ותזכורות — גם ממחזורים שהסתיימו. נתוני השותף/ה הנוכחי/ת משותפים; תזכורות שיצרתם בלבד.
        </p>
      </header>
      <form role="search" onSubmit={(event) => { event.preventDefault(); void search(); }} className={styles.form}>
        <label htmlFor={`${id}-query`}>מה לחפש?</label>
        <div className={styles.searchRow}>
          <input
            id={`${id}-query`}
            type="search"
            value={query}
            maxLength={120}
            placeholder="מילה, החלטה או רעיון…"
            aria-describedby={`${id}-help`}
            autoComplete="off"
            onChange={(event) => changeQuery(event.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={status === 'loading' || !query.trim()}>חיפוש</button>
          {query && <button type="button" onClick={() => changeQuery('')}>ניקוי</button>}
        </div>
      </form>
      <div className={styles.filters}>
        <label htmlFor={`${id}-category`}>סוג תוצאה</label>
        <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value as ArchiveSearchCategory | 'all')}>
          <option value="all">הכול{data ? ` (${data.totalCount})` : ''}</option>
          {ARCHIVE_SEARCH_CATEGORIES.map((key) => (
            <option key={key} value={key}>{labels[key]}{data ? ` (${data.groups.find((group) => group.category === key)?.count ?? 0})` : ''}</option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className={styles.summary}>
        {status === 'idle' && 'הקלידו ביטוי ולחצו Enter לחיפוש. הסימנים % ו־_ נחשבים לתווים רגילים.'}
        {status === 'loading' && 'מחפשים במחזורים ובארכיון…'}
        {status === 'ready' && (visibleCount === 0
          ? 'לא נמצאו תוצאות. נסו ביטוי קצר יותר או סוג תוצאה אחר.'
          : `${visibleCount} תוצאות${category === 'all' ? '' : ` בקטגוריית ${labels[category]}`} עבור ״${data?.query}״`)}
      </p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div aria-busy={status === 'loading'} className={styles.groups}>
        {groups.filter((group) => group.count > 0).map((group) => (
          <section key={group.category} aria-labelledby={`${id}-${group.category}`} className={styles.group}>
            <h3 id={`${id}-${group.category}`} className={styles.groupTitle}>
              {labels[group.category]} <span className={styles.count}>{group.count}</span>
            </h3>
            <ul className={styles.results}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={styles.result} onClick={() => onNavigate(item.target)}>
                    <span className={styles.resultTitle}><Highlight text={item.title} query={data!.query} /></span>
                    <span className={styles.context}>
                      <span className={styles.badge}>{ownershipLabels[item.ownership]}</span>
                      {item.isArchived !== null && <span className={styles.badge}>{item.isArchived ? 'ארכיון' : 'פעיל'}</span>}
                      {item.cycleName && <span>{item.cycleName}</span>}
                      {item.target.kind !== 'reminder' && <span>שבוע {item.target.week}</span>}
                    </span>
                    <span className={styles.snippet}><span>{item.matchedField}: </span><Highlight text={item.snippet} query={data!.query} /></span>
                    <span className={styles.open}>פתיחת {item.target.kind === 'cycle' ? 'המחזור' : item.target.kind === 'wam' ? 'הפגישה' : 'התזכורת'} ←</span>
                  </button>
                </li>
              ))}
            </ul>
            {group.hasMore && <p className={styles.help}>מוצגות {group.items.length} מתוך {group.count}. דייקו את החיפוש כדי להגיע לתוצאות נוספות.</p>}
          </section>
        ))}
      </div>
    </section>
  );
}
