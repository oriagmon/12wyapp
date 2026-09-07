import type { Cycle } from '../lib/types';
import type { RitualLoadStatus, WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import styles from './WeeklyPlanningRitualHomeCard.module.css';
import { useTranslation } from '../i18n';

interface WeeklyPlanningRitualHomeCardProps {
  cycle: Cycle;
  isOwner: boolean;
  ritual: WeeklyPlanningRitual | null;
  loadStatus: RitualLoadStatus;
  onOpen: () => void;
}

/**
 * Compact Home surfacing of the weekly planning ritual status:
 * - Owner: always shown while the cycle has a valid next week to plan (weeks 1-11) — status +
 *   a CTA before completion, a positive completed status (not hidden) afterwards.
 * - Partner (read-only dashboard): only shown once the ritual is actually complete, as a
 *   read-only summary. No controls, and nothing rendered for an absent/draft ritual.
 */
export function WeeklyPlanningRitualHomeCard({ cycle, isOwner, ritual, loadStatus, onOpen }: WeeklyPlanningRitualHomeCardProps) {
  const { t } = useTranslation();
  const currentWeek = cycle.currentWeek;
  const targetWeek = currentWeek + 1;
  const cycleFinished = currentWeek >= 12;

  if (cycleFinished) {
    if (!isOwner) return null;
    return (
      <section className={`card ${styles.card}`}>
        <h3 className={styles.title}>{t('week.ritual.title')}</h3>
        <p className={styles.text}>
          {t('week.ritual.homeFinished')}
        </p>
      </section>
    );
  }

  const isComplete = ritual?.status === 'complete';

  if (!isOwner) {
    if (!isComplete) return null;
    return (
      <section className={`card ${styles.card}`}>
        <h3 className={styles.title}>{t('week.ritual.homeTitle', { week: targetWeek })}</h3>
        <p className={styles.completeText}>{t('week.ritual.partnerDone')}</p>
        {ritual?.weeklyFocus && <p className={styles.summary}>{t('week.ritual.focusSummary', { focus: ritual.weeklyFocus })}</p>}
      </section>
    );
  }

  if (loadStatus === 'loading' || loadStatus === 'idle') return null;

  return (
    <section className={`card ${styles.card}`}>
      <h3 className={styles.title}>{t('week.ritual.homeTitle', { week: targetWeek })}</h3>
      {isComplete ? (
        <>
          <p className={styles.completeText}>{t('week.ritual.completeBadge')}</p>
          {ritual?.weeklyFocus && <p className={styles.summary}>{t('week.ritual.focusSummary', { focus: ritual.weeklyFocus })}</p>}
        </>
      ) : (
        <p className={styles.pendingText}>{t('week.ritual.homePending')}</p>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
        {t('week.ritual.homeCta')}
      </button>
    </section>
  );
}
