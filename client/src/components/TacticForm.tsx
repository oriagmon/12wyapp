import { useState } from 'react';
import { WeekdayPicker } from './WeekdayPicker';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import type { Tactic } from '../lib/types';
import styles from './TacticForm.module.css';
import { useTranslation } from '../i18n';

export interface TacticFormValues {
  title: string;
  weekdays: number[];
  startWeek: number;
  endWeek: number;
  scope?: 'nextWeek' | 'restOfCycle';
}

export function TacticForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  currentWeek,
}: {
  initial?: Tactic;
  onSubmit: (values: TacticFormValues) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
  currentWeek: number;
}) {
  const { t } = useTranslation();
  const nextWeek = currentWeek + 1;
  const upcomingOverride = initial?.overrides?.find((override) => override.week === nextWeek);
  const [title, setTitle] = useState(upcomingOverride?.title ?? initial?.title ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(
    upcomingOverride?.weekdays ?? initial?.weekdays ?? []
  );
  const [startWeek, setStartWeek] = useState(initial?.startWeek ?? 1);
  const [endWeek, setEndWeek] = useState(initial?.endWeek ?? 12);
  const [nextWeekOnly, setNextWeekOnly] = useState(true);
  const status = useAsyncStatus();

  const weekOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const rangeInvalid = endWeek < startWeek;
  const hasFutureWeek = !initial || (nextWeek <= 12 && nextWeek <= initial.endWeek);
  const canSubmit =
    title.trim().length > 0 && weekdays.length > 0 && !rangeInvalid && hasFutureWeek;

  const submit = async () => {
    if (!canSubmit) return;
    await status.run(async () => {
      await onSubmit({
        title: title.trim(),
        weekdays,
        startWeek,
        endWeek,
        scope: initial ? (nextWeekOnly ? 'nextWeek' : 'restOfCycle') : undefined,
      });
      onCancel();
    });
  };

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <input
          type="text"
          placeholder={t('goals.form.name')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={t('goals.form.name')}
        />
      </div>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      {initial ? (
        <label className={styles.scopeChoice}>
          <input
            type="checkbox"
            checked={nextWeekOnly}
            onChange={(event) => setNextWeekOnly(event.target.checked)}
            disabled={!hasFutureWeek}
          />
          <span>
            <strong>{t('goals.form.nextWeekOnly')}</strong>
            <small>
              {hasFutureWeek
                ? nextWeekOnly
                  ? t('goals.form.nextWeekOnlyHint', { week: nextWeek })
                  : t('goals.form.everyWeekHint', { week: nextWeek })
                : t('goals.form.noFutureWeek')}
            </small>
          </span>
        </label>
      ) : (
        <div className={styles.weekRange}>
          <label>
            {t('goals.form.fromWeek')}
            <select value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))}>
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('goals.form.toWeek')}
            <select value={endWeek} onChange={(e) => setEndWeek(Number(e.target.value))}>
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {rangeInvalid && <p className={styles.error}>{t('goals.form.rangeInvalid')}</p>}
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('goals.form.cancel')}
        </button>
        <StatusBadge status={status.status} error={status.error} />
      </div>
    </div>
  );
}
