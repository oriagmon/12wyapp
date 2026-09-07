import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './MobileNavigation.module.css';

export interface MobileNavigationItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  group?: string;
}

export function MobileNavigation({
  activeId, onNavigate, items, disabled = false, mainId = 'main-content', layout = 'mobile',
}: {
  activeId: string;
  onNavigate: (id: string) => void;
  items: MobileNavigationItem[];
  disabled?: boolean;
  mainId?: string;
  layout?: 'mobile' | 'desktop';
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const sheetId = useId();
  const primaryLabels: Record<string, string> = { home: 'בית', week: 'השבוע', goals: 'מטרות', wams: 'פגישה משותפת' };
  const primaryIds = ['home', 'week', 'goals', 'wams'];
  const primary = primaryIds.map((id) => items.find((item) => item.id === id) ?? {
    id, label: primaryLabels[id], disabled: true,
  });
  const more = items.filter((item) => !primaryIds.includes(item.id));
  const groups = [...new Set(more.map((item) => item.group ?? 'כלים נוספים'))];
  const icons: Record<string, string> = { home: '⌂', week: '▦', goals: '◉', wams: '◎' };
  const previousActive = useRef(activeId);

  useEffect(() => {
    if (previousActive.current !== activeId || disabled) setOpen(false);
    previousActive.current = activeId;
  }, [activeId, disabled]);

  useEffect(() => {
    if (!open) return;
    const trigger = moreRef.current;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      if (event.key !== 'Tab' || !sheet) return;
      const targets = [...sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    const onResize = () => {
      if (layout === 'mobile' ? window.innerWidth > 720 : window.innerWidth <= 720) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      else document.getElementById(mainId)?.focus({ preventScroll: true });
    };
  }, [open, mainId, layout]);

  const navigate = (item: MobileNavigationItem) => {
    if (disabled || item.disabled) return;
    setOpen(false);
    onNavigate(item.id);
  };

  return (
    <>
      <nav className={layout === 'desktop' ? styles.desktopNav : styles.nav}
        aria-label={layout === 'desktop' ? 'ניווט ראשי' : 'ניווט ראשי בנייד'}>
        {primary.map((item) => (
          <button key={item.id} type="button" className={styles.item}
            aria-current={activeId === item.id ? 'page' : undefined}
            aria-controls={mainId} disabled={disabled || item.disabled}
            onClick={() => navigate(item)}>
            <span className={styles.icon} aria-hidden="true">{item.icon ?? icons[item.id]}</span>
            <span>{primaryLabels[item.id]}</span>
          </button>
        ))}
        <button ref={moreRef} type="button" className={styles.item}
          aria-current={more.some((item) => item.id === activeId) ? 'page' : undefined}
          aria-expanded={open} aria-controls={sheetId} aria-haspopup="dialog"
          disabled={disabled || more.length === 0} onClick={() => setOpen(true)}>
          <span className={styles.icon} aria-hidden="true">•••</span><span>עוד</span>
        </button>
      </nav>
      {open && createPortal(
        <div className={`${styles.backdrop} ${layout === 'desktop' ? styles.desktopBackdrop : ''}`}
          onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div ref={sheetRef} id={sheetId} className={`${styles.sheet} ${layout === 'desktop' ? styles.desktopSheet : ''}`}
            role="dialog" aria-modal="true" aria-labelledby={titleId} dir="rtl">
            <div className={styles.heading}>
              <h2 id={titleId}>לאן ממשיכים?</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} aria-label="סגירת תפריט ניווט">✕</button>
            </div>
            {groups.map((group) => <section key={group} aria-label={group}>
              <h3 className={styles.groupTitle}>{group}</h3>
              <div className={styles.links}>
              {more.filter((item) => (item.group ?? 'כלים נוספים') === group).map((item) => (
                <button key={item.id} type="button" className={styles.link}
                  aria-current={item.id === activeId ? 'page' : undefined}
                  disabled={disabled || item.disabled} onClick={() => navigate(item)}>
                  {item.icon && <span aria-hidden="true">{item.icon}</span>}{item.label}
                </button>
              ))}
              </div>
            </section>)}
          </div>
        </div>, document.body,
      )}
    </>
  );
}
