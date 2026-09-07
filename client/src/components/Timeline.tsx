import type { WeekScore } from '../lib/types';
import { formatScore, TARGET_SCORE } from '../lib/scoring';
import styles from './Timeline.module.css';
import { useTranslation } from '../i18n';

const WIDTH = 640;
const HEIGHT = 200;
const PAD_X = 24;
const PAD_Y = 20;

function xForWeek(week: number): number {
  return PAD_X + ((week - 1) / 11) * (WIDTH - PAD_X * 2);
}

function yForScore(score: number): number {
  return PAD_Y + (1 - score / 100) * (HEIGHT - PAD_Y * 2);
}

export function Timeline({
  weekScores,
  average,
  viewedWeek,
  currentWeek,
  onSelectWeek,
}: {
  weekScores: WeekScore[];
  average: number | null;
  viewedWeek: number;
  currentWeek: number;
  onSelectWeek: (week: number) => void;
}) {
  const { t } = useTranslation();
  // Split around the placeholder so the number can stay inside a <strong> while each
  // language keeps its own word order around it.
  const currentWeekLabel = t('week.timeline.current').split('{week}');
  const averageLabel = t('week.timeline.average').split('{score}');
  const scoredPoints = weekScores.filter((w) => w.score !== null) as (WeekScore & { score: number })[];
  const path = scoredPoints
    .map((w, i) => `${i === 0 ? 'M' : 'L'} ${xForWeek(w.week)} ${yForScore(w.score)}`)
    .join(' ');
  const targetY = yForScore(TARGET_SCORE);

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>{t('week.timeline.title')}</h3>
          <p className={styles.currentWeekLabel}>
            {currentWeekLabel[0]}<strong>{currentWeek}</strong>{currentWeekLabel[1]}
          </p>
        </div>
        <div className={styles.avg}>
          {average !== null ? (
            <>
              {averageLabel[0]}<strong>{formatScore(average)}</strong>{averageLabel[1]}
            </>
          ) : (
            t('week.timeline.noAverage')
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('week.timeline.chart')} className={styles.svg}>
        <line x1={PAD_X} y1={targetY} x2={WIDTH - PAD_X} y2={targetY} className={styles.targetLine} />
        <text x={WIDTH - PAD_X} y={targetY - 6} textAnchor="end" className={styles.targetLabel}>
          {t('week.timeline.target')}
        </text>
        {path && <path d={path} className={styles.trendPath} fill="none" />}
        {weekScores.map((w) => {
          const gold = w.score !== null && w.score >= TARGET_SCORE;
          const cx = xForWeek(w.week);
          const cy = w.score === null ? HEIGHT - PAD_Y : yForScore(w.score);
          const isSelected = viewedWeek === w.week;
          return (
            <g key={w.week}>
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 8 : 6}
                className={`${styles.point} ${gold ? styles.gold : ''} ${w.score === null ? styles.empty : ''} ${
                  isSelected ? styles.selected : ''
                }`}
                onClick={() => onSelectWeek(w.week)}
                role="button"
                tabIndex={0}
                aria-label={t('week.timeline.point', {
                  week: w.week,
                  score: w.score !== null
                    ? t('week.timeline.pointScore', { score: formatScore(w.score) })
                    : t('week.timeline.pointEmpty'),
                })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectWeek(w.week);
                }}
              />
              <text x={cx} y={HEIGHT - 2} textAnchor="middle" className={styles.weekLabel}>
                {w.week}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
