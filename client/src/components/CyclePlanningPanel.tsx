import { useEffect, useState } from 'react';
import type { Cycle } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import styles from './CyclePlanningPanel.module.css';

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

const fields: { key: keyof Planning; label: string; placeholder: string }[] = [
  { key: 'vision', label: 'חזון המחזור', placeholder: 'לאן אני רוצה להגיע ב־12 השבועות?' },
  { key: 'successDefinition', label: 'איך נראית הצלחה', placeholder: 'תוצאה ברורה שאדע לזהות בסוף המחזור' },
  { key: 'whyItMatters', label: 'למה זה חשוב לי', placeholder: 'הסיבה שתעזור לי להמשיך גם כשקשה' },
  { key: 'blockers', label: 'מה עלול לעכב אותי', placeholder: 'חסמים צפויים ואיך אתמודד איתם' },
  { key: 'risks', label: 'סיכונים והנחות', placeholder: 'מה צריך לבדוק או לעקוב אחריו' },
  { key: 'lagMeasures', label: 'מדדי תוצאה (Lag)', placeholder: 'מדד תוצאה אחד בכל שורה' },
  { key: 'leadMeasures', label: 'מדדי ביצוע (Lead)', placeholder: 'פעולת ביצוע מדידה אחת בכל שורה' },
  { key: 'notes', label: 'הערות', placeholder: 'מחשבות, החלטות ותזכורות למחזור' },
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

  useEffect(() => setValues(valuesFrom(cycle)), [cycle]);

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>תכנון המחזור</h2>
          <p className={styles.subtitle}>
            המפה שלכם ל־12 השבועות. השדות נשמרים ביציאה מהם.
          </p>
        </div>
        {isOwner && <StatusBadge status={saveStatus.status} error={saveStatus.error} />}
      </div>
      <div className={styles.grid}>
        {fields.map(({ key, label, placeholder }) => (
          <label key={key} className={`${styles.field} ${key === 'notes' ? styles.wide : ''}`}>
            <span className={styles.label}>{label}</span>
            <textarea
              ref={(element) => {
                if (element) autoResizeTextarea(element);
              }}
              rows={1}
              value={values[key]}
              placeholder={placeholder}
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
