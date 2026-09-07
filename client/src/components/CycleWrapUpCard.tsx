import type { WeekScore } from '../lib/types';
import { TARGET_SCORE } from '../lib/scoring';
import styles from './CycleWrapUpCard.module.css';
import { useTranslation, type Translator } from '../i18n';

/** From which week the wrap-up starts appearing. The last WAM of a cycle is the moment this
 *  is actually read, and that meeting happens during week 11 or 12 — not after the cycle has
 *  already been archived, when nobody opens the app for a fortnight anyway. */
const WRAP_UP_FROM_WEEK = 11;

export interface CycleWrapUpCardProps {
  currentWeek: number;
  weekScores: WeekScore[];
}

interface WrapUp {
  scored: (WeekScore & { score: number })[];
  average: number;
  onTarget: number;
  best: WeekScore & { score: number };
  completed: number;
  scheduled: number;
  firstHalf: number | null;
  secondHalf: number | null;
}

function summarize(weekScores: WeekScore[]): WrapUp | null {
  const scored = weekScores.filter((w): w is WeekScore & { score: number } => w.score !== null);
  if (scored.length === 0) return null;
  const mean = (items: (WeekScore & { score: number })[]) =>
    Math.round(items.reduce((sum, w) => sum + w.score, 0) / items.length);
  const firstHalfWeeks = scored.filter((w) => w.week <= 6);
  const secondHalfWeeks = scored.filter((w) => w.week > 6);
  return {
    scored,
    average: mean(scored),
    onTarget: scored.filter((w) => w.score >= TARGET_SCORE).length,
    best: scored.reduce((best, w) => (w.score > best.score ? w : best)),
    completed: weekScores.reduce((sum, w) => sum + w.completed, 0),
    scheduled: weekScores.reduce((sum, w) => sum + w.scheduled, 0),
    firstHalf: firstHalfWeeks.length > 0 ? mean(firstHalfWeeks) : null,
    secondHalf: secondHalfWeeks.length > 0 ? mean(secondHalfWeeks) : null,
  };
}

function trendLine(wrap: WrapUp, t: Translator): string | null {
  if (wrap.firstHalf === null || wrap.secondHalf === null) return null;
  const params = { first: wrap.firstHalf, second: wrap.secondHalf };
  const delta = wrap.secondHalf - wrap.firstHalf;
  if (delta >= 5) return t('dashboard.wrap.trendStronger', params);
  if (delta <= -5) return t('dashboard.wrap.trendWeaker', params);
  return t('dashboard.wrap.trendSteady', params);
}

/**
 * The closing summary of a 12 week cycle. Everything here is derived from the week scores the
 * dashboard already loaded, so it costs no extra request and stores nothing new.
 */
export function CycleWrapUpCard({ currentWeek, weekScores }: CycleWrapUpCardProps) {
  const { t } = useTranslation();
  if (currentWeek < WRAP_UP_FROM_WEEK) return null;
  const wrap = summarize(weekScores);
  if (!wrap) return null;

  const trend = trendLine(wrap, t);
  const finished = currentWeek >= 12;

  return (
    <section className={`card ${styles.card}`} aria-labelledby="cycle-wrap-up-title">
      <div className={styles.header}>
        <h2 id="cycle-wrap-up-title" className={styles.title}>
          {finished ? t('dashboard.wrap.titleDone') : t('dashboard.wrap.titleSoon')}
        </h2>
        <p className={styles.subtitle}>
          {finished
            ? t('dashboard.wrap.subtitleDone')
            : t('dashboard.wrap.subtitleSoon', { count: 12 - currentWeek + 1 })}
        </p>
      </div>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>{t('dashboard.wrap.average')}</dt>
          <dd className={styles.statValue}>
            {wrap.average}<span className={styles.unit}>%</span>
          </dd>
          <p className={styles.statCaption}>
            {wrap.average >= TARGET_SCORE
              ? t('dashboard.wrap.aboveTarget', { target: TARGET_SCORE })
              : t('dashboard.wrap.belowTarget', { gap: TARGET_SCORE - wrap.average })}
          </p>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>{t('dashboard.wrap.weeksAbove')}</dt>
          <dd className={styles.statValue}>
            {wrap.onTarget}<span className={styles.unit}>/{wrap.scored.length}</span>
          </dd>
          <p className={styles.statCaption}>{t('dashboard.wrap.weeksMeasured')}</p>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>{t('dashboard.wrap.bestWeek')}</dt>
          <dd className={styles.statValue}>
            {wrap.best.score}<span className={styles.unit}>%</span>
          </dd>
          <p className={styles.statCaption}>{t('dashboard.wrap.bestWeekCaption', { week: wrap.best.week })}</p>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>{t('dashboard.wrap.tacticsDone')}</dt>
          <dd className={styles.statValue}>
            {wrap.completed}<span className={styles.unit}>/{wrap.scheduled}</span>
          </dd>
          <p className={styles.statCaption}>{t('dashboard.wrap.tacticsCaption')}</p>
        </div>
      </dl>

      {trend && <p className={styles.trend}>{trend}</p>}
    </section>
  );
}
