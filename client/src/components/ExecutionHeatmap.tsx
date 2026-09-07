import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useExecutionHeatmap } from '../hooks/useExecutionHeatmap';
import type { ExecutionHeatmapResponse, HeatmapDay, HeatmapDayState } from '../lib/executionHeatmapTypes';
import styles from './ExecutionHeatmap.module.css';

const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'];
const SHORT_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const STATE_LABELS: Record<HeatmapDayState, string> = {
  unscheduled: 'יום ללא תכנון',
  future: 'עוד לפנינו',
  pending: 'היום עוד פתוח',
  failed: 'לא בוצע',
  partial: 'ביצוע חלקי',
  success: 'היעד הושג',
  'not-reached': 'מחוץ למחזור שהסתיים',
};
const dateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function formatDate(date: string) { return dateFormatter.format(new Date(`${date}T12:00:00Z`)); }

export function heatmapCellLabel(day: HeatmapDay): string {
  const when = day.phase === 'today' ? ', היום' : day.phase === 'future' ? ', יום עתידי' : '';
  return `שבוע ${day.week}, ${WEEKDAYS[day.weekday]}, ${formatDate(day.date)} (תאריך משוער)${when}: ${STATE_LABELS[day.state]}. `
    + (day.scheduled === 0 ? 'לא תוכננו פעולות' : `${day.completed} מתוך ${day.scheduled} פעולות בוצעו, ${day.score}%`)
    + (day.phase === 'today' && day.state !== 'success' && day.scheduled > 0 ? '. היום טרם הסתיים ואינו קוטע רצף' : '');
}

export interface ExecutionHeatmapProps {
  userId: number | null;
  cycleId?: number;
  /** Change after dashboard mutations to refresh counts without unmounting the grid. */
  refreshKey?: unknown;
}

export function ExecutionHeatmap({ userId, cycleId, refreshKey }: ExecutionHeatmapProps) {
  const { data, loadStatus, loadError, reload } = useExecutionHeatmap(userId, cycleId, refreshKey);
  const headingId = useId();
  if (userId === null) return null;
  return (
    <section className={`card ${styles.card}`} dir="rtl" aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>עקביות נבנית יום אחר יום</span>
          <h2 id={headingId} className={styles.title}>מפת הביצוע</h2>
        </div>
        <span className={styles.period}>12 שבועות · 84 ימים</span>
      </header>
      {(loadStatus === 'loading' || loadStatus === 'idle') && <p className={styles.note} role="status">טוען את מפת הביצוע…</p>}
      {loadStatus === 'error' && (
        <div className={styles.error} role="alert">
          <span>{loadError}</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={reload}>ניסיון נוסף</button>
        </div>
      )}
      {loadStatus === 'ready' && !data?.cycle && (
        <p className={styles.empty}>עוד אין מחזור פעיל. לאחר יצירת מחזור ותכנון טקטיקות, יופיע כאן הסיפור היומי של הביצוע.</p>
      )}
      {data?.cycle && <ExecutionHeatmapGrid key={`${userId}:${data.cycle.id}`} data={data} />}
    </section>
  );
}

/** Presentational export for isolated accessibility tests and surfaces with preloaded data. */
export function ExecutionHeatmapGrid({ data }: { data: ExecutionHeatmapResponse }) {
  const helpId = useId();
  const detailId = useId();
  const initial = data.days.findIndex((day) => day.phase === 'today');
  const lastScheduled = data.days.reduce((last, day, index) =>
    day.phase === 'past' && day.scheduled > 0 ? index : last, 0);
  const [selectedIndex, setSelectedIndex] = useState(initial < 0 ? lastScheduled : initial);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = data.days[selectedIndex] ?? data.days[0];
  const { summary, cycle } = data;
  const strongest = summary.strongestWeekday;

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const weekday = index % 7;
    const week = Math.floor(index / 7);
    let next = index;
    if (event.key === 'ArrowDown') next = week * 7 + Math.min(6, weekday + 1);
    else if (event.key === 'ArrowUp') next = week * 7 + Math.max(0, weekday - 1);
    // Weeks progress right-to-left, matching the visual RTL grid.
    else if (event.key === 'ArrowLeft') next = Math.min(11, week + 1) * 7 + weekday;
    else if (event.key === 'ArrowRight') next = Math.max(0, week - 1) * 7 + weekday;
    else if (event.key === 'Home') next = event.ctrlKey ? 0 : weekday;
    else if (event.key === 'End') next = event.ctrlKey ? 83 : 77 + weekday;
    else return;
    event.preventDefault();
    setSelectedIndex(next);
    cellRefs.current[next]?.focus();
  }

  if (!cycle || !selected) return null;
  return (
    <>
      <p className={styles.cycleName}>{cycle.name}{!cycle.isActive && ' · מחזור שהסתיים'}{data.access === 'partner' && ' · צפייה בלבד'}</p>
      <dl className={styles.stats} aria-label="סיכום הביצוע היומי">
        <div className={styles.primaryStat}><dt>{cycle.isActive ? 'הרצף הנוכחי' : 'הרצף בסיום המחזור'}</dt><dd>{summary.currentStreak}<span> {summary.currentStreak === 1 ? 'יום הצלחה' : 'ימי הצלחה'}</span></dd></div>
        <div><dt>הרצף הטוב ביותר</dt><dd>{summary.bestStreak}<span> {summary.bestStreak === 1 ? 'יום' : 'ימים'}</span></dd></div>
        <div><dt>ימים שהגיעו ליעד</dt><dd>{summary.successfulDays}<span> במחזור</span></dd></div>
      </dl>
      <p id={helpId} className={styles.note}>כל עמודה היא שבוע. נגיעה ביום או ניווט בחצים מציגים פירוט. יעד יומי: {data.targetScore}% ומעלה.</p>
      <div className={styles.scroll}>
        <div className={styles.grid} role="grid" aria-label="מפת ביצוע: 12 שבועות, 7 ימים בשבוע" aria-describedby={helpId}>
          <div className={styles.row} role="row">
            <span className={styles.corner} role="columnheader">יום</span>
            {Array.from({ length: 12 }, (_, week) => <span className={styles.weekLabel} role="columnheader" key={week}>ש׳ {week + 1}</span>)}
          </div>
          {WEEKDAYS.map((weekdayName, weekday) => (
            <div className={styles.row} role="row" key={weekday}>
              <span className={styles.dayLabel} role="rowheader" aria-label={weekdayName}>{SHORT_DAYS[weekday]}</span>
              {Array.from({ length: 12 }, (_, week) => {
                const index = week * 7 + weekday;
                const day = data.days[index];
                return (
                  <div role="gridcell" aria-selected={selectedIndex === index} key={week}>
                    <button
                      type="button"
                      ref={(element) => { cellRefs.current[index] = element; }}
                      className={styles.cell}
                      data-state={day.state}
                      data-intensity={day.intensity}
                      data-today={day.phase === 'today' || undefined}
                      aria-label={heatmapCellLabel(day)}
                      aria-controls={detailId}
                      aria-current={day.phase === 'today' ? 'date' : undefined}
                      tabIndex={selectedIndex === index ? 0 : -1}
                      style={{ '--cell-delay': `${week * 18 + weekday * 7}ms` } as CSSProperties}
                      onFocus={() => setSelectedIndex(index)}
                      onClick={() => setSelectedIndex(index)}
                      onKeyDown={(event) => move(event, index)}
                    >
                      <span aria-hidden="true">{day.state === 'success' ? '✓' : day.state === 'failed' ? '−' : day.state === 'pending' ? '·' : ''}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.detail} id={detailId} role="status" aria-live="polite" aria-atomic="true">
        <div className={styles.detailHeading}>
          <strong>{WEEKDAYS[selected.weekday]} · שבוע {selected.week}{selected.phase === 'today' && ' · היום'}</strong>
          <span>{STATE_LABELS[selected.state]}</span>
        </div>
        <span className={styles.detailDate}>{formatDate(selected.date)} · תאריך משוער</span>
        <p>{selected.scheduled === 0
          ? 'יום ללא פעולות מתוכננות — מנוחה אינה קוטעת רצף.'
          : `${selected.completed} מתוך ${selected.scheduled} פעולות בוצעו · ${selected.score}%`}
        </p>
        {selected.phase === 'today' && selected.state !== 'success' && selected.scheduled > 0 && <p>היום עדיין פתוח. הרצף נשמר עד סיום היום בישראל.</p>}
        {selected.phase === 'future' && <p>יום עתידי — עדיין לא נספר בהצלחה או ברצף.</p>}
        {selected.phase === 'outside-cycle' && <p>המחזור הסתיים לפני השבוע הזה — היום אינו נספר.</p>}
      </div>
      <div className={styles.legend} aria-label="מקרא מפת הביצוע">
        {(['unscheduled', 'future', 'pending', 'failed', 'partial', 'success'] as const).map((state) => (
          <span className={styles.legendItem} key={state}>
            <span className={styles.swatch} data-state={state} data-intensity={state === 'success' ? 4 : state === 'partial' ? 2 : 0} aria-hidden="true" />
            {STATE_LABELS[state]}
          </span>
        ))}
        {!cycle.isActive && <span className={styles.legendItem}><span className={styles.swatch} data-state="not-reached" aria-hidden="true" />מחוץ למחזור</span>}
        <span className={styles.scale} aria-label="עוצמת הצבע עולה ככל שאחוז הביצוע גבוה יותר">
          פחות{[1, 2, 3, 4].map((intensity) => <span key={intensity} className={styles.swatch} data-intensity={intensity} aria-hidden="true" />)}יותר
        </span>
      </div>
      {summary.completedOccurrences > 0 ? (
        <p className={styles.insight}>
          <strong>{summary.completedOccurrences} פעולות שכבר הפכו להתקדמות.</strong>{' '}
          {strongest && `מבין הימים שהסתיימו, ${WEEKDAYS[strongest.weekday]} מוביל: ${strongest.completed} מתוך ${strongest.scheduled} פעולות (${strongest.score}%, על פני ${strongest.days === 1 ? 'יום אחד' : `${strongest.days} ימים`}).`}
        </p>
      ) : (
        <p className={styles.empty}>{data.days.some((day) => day.scheduled > 0 && day.phase !== 'outside-cycle')
          ? 'גם פעולה אחת היא התחלה. המפה תתעד כל צעד שבוצע, בלי להחשיב יום מנוחה ככישלון.'
          : 'עדיין אין פעולות מתוכננות במחזור הזה. אחרי תכנון טקטיקות, הימים יקבלו משמעות.'}</p>
      )}
      <p className={styles.footnote}>הרצפים סופרים ימי תכנון שבהם בוצעו לפחות 85% מהפעולות, ללא עיגול כלפי מעלה. ימי מנוחה ניטרליים; יום נוכחי שטרם הגיע ליעד אינו קוטע את הרצף. הרצפים מתייחסים למחזור המוצג בלבד.</p>
      <p className={styles.footnote}>התאריכים משוערים: אין תאריך התחלה שמור למחזור. שבוע {cycle.currentWeek} מעוגן {cycle.isActive ? 'לשבוע הנוכחי בישראל' : 'לשבוע סיום המחזור בישראל'}, לפי מספר השבוע שנבחר. אלה ימי התכנון, לא חותמות הזמן של סימון הביצוע.</p>
    </>
  );
}
