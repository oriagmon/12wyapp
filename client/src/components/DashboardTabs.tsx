import { useState, type ReactNode } from 'react';
import styles from './DashboardTabs.module.css';
import { useTranslation } from '../i18n';

export interface DashboardTab {
  id: string;
  label: string;
  content: ReactNode;
}

export function DashboardTabs({ tabs, initialTabId }: { tabs: DashboardTab[]; initialTabId?: string }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState(initialTabId ?? tabs[0]?.id);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.tabRow} role="tablist" aria-label={t('common.nav.tabs')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active?.id}
            aria-controls={`tabpanel-${tab.id}`}
            className={`${styles.tab} ${tab.id === active?.id ? styles.active : ''}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`tabpanel-${active.id}`}
          aria-labelledby={`tab-${active.id}`}
          className={styles.panel}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
