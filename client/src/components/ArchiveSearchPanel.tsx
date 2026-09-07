import { useId, useState } from 'react';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { ARCHIVE_SEARCH_CATEGORIES, type ArchiveSearchCategory, type ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import styles from './ArchiveSearchPanel.module.css';
import { useTranslation, type Translator } from '../i18n';

export interface ArchiveSearchPanelProps {
  onNavigate: (target: ArchiveSearchTarget) => void;
}

const categoryLabel = (category: ArchiveSearchCategory, t: Translator) => t(`insights.search.${category}`);
const ownershipLabel = (ownership: 'mine' | 'partner' | 'shared', t: Translator) =>
  t(`insights.search.ownership${ownership[0].toUpperCase()}${ownership.slice(1)}`);

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
  const { t, dir } = useTranslation();
  const { query, changeQuery, data, status, error, search } = useArchiveSearch();
  const [category, setCategory] = useState<ArchiveSearchCategory | 'all'>('all');
  const id = useId();
  const groups = data?.groups.filter((group) => category === 'all' || group.category === category) ?? [];
  const visibleCount = groups.reduce((sum, group) => sum + group.count, 0);

  return (
    <section className={styles.panel} dir={dir} aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`} className={styles.title}>{t('insights.search.title')}</h2>
        <p id={`${id}-help`} className={styles.help}>
          {t('insights.search.help')}
        </p>
      </header>
      <form role="search" onSubmit={(event) => { event.preventDefault(); void search(); }} className={styles.form}>
        <label htmlFor={`${id}-query`}>{t('insights.search.queryLabel')}</label>
        <div className={styles.searchRow}>
          <input
            id={`${id}-query`}
            type="search"
            value={query}
            maxLength={120}
            placeholder={t('insights.search.placeholder')}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            onChange={(event) => changeQuery(event.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={status === 'loading' || !query.trim()}>{t('insights.search.submit')}</button>
          {query && <button type="button" onClick={() => changeQuery('')}>{t('insights.search.clear')}</button>}
        </div>
      </form>
      <div className={styles.filters}>
        <label htmlFor={`${id}-category`}>{t('insights.search.categoryLabel')}</label>
        <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value as ArchiveSearchCategory | 'all')}>
          <option value="all">{t('insights.search.all')}{data ? ` (${data.totalCount})` : ''}</option>
          {ARCHIVE_SEARCH_CATEGORIES.map((key) => (
            <option key={key} value={key}>{categoryLabel(key, t)}{data ? ` (${data.groups.find((group) => group.category === key)?.count ?? 0})` : ''}</option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className={styles.summary}>
        {status === 'idle' && t('insights.search.idle')}
        {status === 'loading' && t('insights.search.loading')}
        {status === 'ready' && (visibleCount === 0
          ? t('insights.search.noResults')
          : category === 'all'
            ? t('insights.search.resultsAll', { count: visibleCount, query: data?.query ?? '' })
            : t('insights.search.resultsCategory', {
                count: visibleCount,
                category: categoryLabel(category, t),
                query: data?.query ?? '',
              }))}
      </p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div aria-busy={status === 'loading'} className={styles.groups}>
        {groups.filter((group) => group.count > 0).map((group) => (
          <section key={group.category} aria-labelledby={`${id}-${group.category}`} className={styles.group}>
            <h3 id={`${id}-${group.category}`} className={styles.groupTitle}>
              {categoryLabel(group.category, t)} <span className={styles.count}>{group.count}</span>
            </h3>
            <ul className={styles.results}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={styles.result} onClick={() => onNavigate(item.target)}>
                    <span className={styles.resultTitle}><Highlight text={item.title} query={data!.query} /></span>
                    <span className={styles.context}>
                      <span className={styles.badge}>{ownershipLabel(item.ownership, t)}</span>
                      {item.isArchived !== null && <span className={styles.badge}>{item.isArchived ? t('insights.search.archived') : t('insights.search.active')}</span>}
                      {item.cycleName && <span>{item.cycleName}</span>}
                      {item.target.kind !== 'reminder' && <span>{t('insights.search.week', { week: item.target.week })}</span>}
                    </span>
                    <span className={styles.snippet}><span>{item.matchedField}: </span><Highlight text={item.snippet} query={data!.query} /></span>
                    <span className={styles.open}>
                      {item.target.kind === 'cycle'
                        ? t('insights.search.openCycle')
                        : item.target.kind === 'wam'
                          ? t('insights.search.openWam')
                          : t('insights.search.openReminder')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {group.hasMore && <p className={styles.help}>
                {t('insights.search.hasMore', { shown: group.items.length, total: group.count })}
              </p>}
          </section>
        ))}
      </div>
    </section>
  );
}
