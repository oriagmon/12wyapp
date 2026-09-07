import { useEffect, useState } from 'react';
import type { Cycle } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import styles from './CyclePlanningPanel.module.css';
import { useTranslation } from '../i18n';

type Planning = Pick<
  Cycle,
  | 'vision'
  | 'successDefinition'
  | 'whyItMatters'
  | 'blockers'
  | 'risks'
  | 'lagMeasures'
  | 'leadMeasures'
  | 'notes'
>;

const fields: { key: keyof Planning }[] = [
  { key: 'vision' },
  { key: 'successDefinition' },
  { key: 'whyItMatters' },
  { key: 'blockers' },
  { key: 'risks' },
  { key: 'lagMeasures' },
  { key: 'leadMeasures' },
  { key: 'notes' },
];

function valuesFrom(cycle: Cycle): Planning {
  return Object.fromEntries(fields.map(({ key }) => [key, cycle[key] ?? ''])) as unknown as Planning;
}

export function CyclePlanningPanel({
  cycle,
  isOwner,
  onSave,
}: {
  cycle: Cycle;
  isOwner: boolean;
  onSave: (planning: Planning) => Promise<void>;
}) {
  const [values, setValues] = useState<Planning>(() => valuesFrom(cycle));
  const saveStatus = useAsyncStatus();
  const { t } = useTranslation();

  useEffect(() => setValues(valuesFrom(cycle)), [cycle]);

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('dashboard.planning.title')}</h2>
          <p className={styles.subtitle}>
            {t('dashboard.planning.subtitle')}
          </p>
        </div>
        {isOwner && <StatusBadge status={saveStatus.status} error={saveStatus.error} />}
      </div>
      <div className={styles.grid}>
        {fields.map(({ key }) => (
          <label key={key} className={`${styles.field} ${key === 'notes' ? styles.wide : ''}`}>
            <span className={styles.label}>{t(`dashboard.planning.${key}`)}</span>
            <textarea
              ref={(element) => {
                if (element) autoResizeTextarea(element);
              }}
              rows={1}
              value={values[key]}
              placeholder={t(`dashboard.planning.${key}Placeholder`)}
              readOnly={!isOwner}
              onChange={(event) => {
                autoResizeTextarea(event.currentTarget);
                setValues((current) => ({ ...current, [key]: event.target.value }));
              }}
              onBlur={() => {
                if (isOwner) saveStatus.run(() => onSave(values));
              }}
              className={styles.textarea}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
