import { useMemo, useState } from 'react'
import type { WeightCondition, WeightEntry } from './api'

type Range = 30 | 90 | 0

type Props = {
  /** The server's date, so a phone with a wrong clock cannot shift the window. */
  today: string
  weights: WeightEntry[]
}

const RANGES: { value: Range; label: string }[] = [
  { value: 30, label: '30 יום' },
  { value: 90, label: '90 יום' },
  { value: 0, label: 'הכל' },
]

const CONDITION_LABELS: Record<WeightCondition, string> = {
  before: 'לפני שירותים',
  after: 'אחרי שירותים',
}

const DAY_MS = 86_400_000

/* Chart geometry. The y-axis labels sit on the right because the card around them is
   right-to-left, while time still runs left-to-right the way every weight graph does. */
const W = 320
const H = 196
const LEFT = 8
const RIGHT = 266
const TOP = 14
const BOTTOM = 162

function toDay(iso: string) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
}

function format(value: number) {
  return value.toFixed(1)
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' }).format(
    new Date(`${iso}T00:00:00`),
  )
}

/** Just the signed number — the unit is rendered outside the isolate, because a bidi isolate
 *  containing both a number and Hebrew resolves right-to-left and swaps them. */
function formatDelta(value: number) {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : '−'}${format(Math.abs(rounded))}`
}

/** Gridlines land on values people actually think in, rather than whatever an even
 *  division of the range happens to produce. */
function niceStep(span: number) {
  const raw = span / 4
  return [0.25, 0.5, 1, 2, 2.5, 5, 10, 20].find((step) => step >= raw) ?? 50
}

/**
 * Trailing seven-day average.
 *
 * A single morning reading moves by most of a kilo for reasons that have nothing to do with
 * body fat — salt, water, what you ate last night. Plotting only the raw dots invites reading
 * that noise as progress, so the average is drawn as the trend and the dots are demoted to
 * context. It is trailing rather than centred so a point never depends on days that hadn't
 * happened yet when you read it.
 */
function trailingAverage(points: { day: number; kg: number }[]) {
  return points.map((point, index) => {
    let sum = 0
    let count = 0
    for (let i = index; i >= 0; i -= 1) {
      if (point.day - points[i].day > 6) break
      sum += points[i].kg
      count += 1
    }
    return { day: point.day, kg: sum / count }
  })
}

export function WeightChart({ today, weights }: Props) {
  const [chosen, setChosen] = useState<Range | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  /**
   * Which window to open on before the user picks one.
   *
   * Defaulting to 30 days would greet anyone coming back from a break with an empty panel
   * even though their history is right there, so the opening view is the narrowest window
   * that actually has something to draw.
   */
  const autoRange = useMemo<Range>(() => {
    const todayDay = toDay(today)
    const within = (days: number) =>
      weights.reduce((count, entry) => (todayDay - toDay(entry.measuredOn) < days ? count + 1 : count), 0)
    if (within(30) >= 2) return 30
    if (within(90) >= 2) return 90
    return 0
  }, [weights, today])

  const range = chosen ?? autoRange

  const model = useMemo(() => {
    const sorted = [...weights].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn))
    const todayDay = toDay(today)
    const visible =
      range === 0 ? sorted : sorted.filter((entry) => todayDay - toDay(entry.measuredOn) < range)
    if (visible.length < 2) return { visible, points: null }

    const points = visible.map((entry) => ({ ...entry, day: toDay(entry.measuredOn) }))
    const average = trailingAverage(points)

    const minDay = points[0].day
    const maxDay = points[points.length - 1].day
    const daySpan = Math.max(maxDay - minDay, 1)

    const values = [...points.map((p) => p.kg), ...average.map((p) => p.kg)]
    let lo = Math.min(...values)
    let hi = Math.max(...values)
    // A flat fortnight would otherwise be stretched until 200g of noise looked like a cliff.
    const MIN_SPAN = 2
    if (hi - lo < MIN_SPAN) {
      const middle = (hi + lo) / 2
      lo = middle - MIN_SPAN / 2
      hi = middle + MIN_SPAN / 2
    }
    const padding = (hi - lo) * 0.08
    lo -= padding
    hi += padding

    const step = niceStep(hi - lo)
    const gridlines: number[] = []
    for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
      gridlines.push(Math.round(value * 100) / 100)
    }

    const x = (day: number) => LEFT + ((day - minDay) / daySpan) * (RIGHT - LEFT)
    const y = (kg: number) => BOTTOM - ((kg - lo) / (hi - lo)) * (BOTTOM - TOP)

    return {
      visible,
      points: {
        dots: points.map((point) => ({ ...point, cx: x(point.day), cy: y(point.kg) })),
        averageLine: average.map((point) => `${x(point.day)},${y(point.kg)}`).join(' '),
        gridlines: gridlines.map((value) => ({ value, y: y(value) })),
        change: average[average.length - 1].kg - average[0].kg,
        first: visible[0],
        last: visible[visible.length - 1],
        span: daySpan,
      },
    }
  }, [weights, today, range])

  const selectedEntry = model.visible.find((entry) => entry.measuredOn === selected) ?? null
  const hasBoth =
    model.visible.some((entry) => entry.condition === 'before') &&
    model.visible.some((entry) => entry.condition === 'after')

  return (
    <section className="weight-chart-card">
      <div className="weight-chart-head">
        <h2>משקל לאורך זמן</h2>
        <div className="weight-range" role="group" aria-label="טווח תצוגה">
          {RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={range === option.value ? 'active' : undefined}
              aria-pressed={range === option.value}
              onClick={() => {
                setChosen(option.value)
                setSelected(null)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {model.points === null ? (
        <p className="weight-chart-empty">
          {model.visible.length === 0
            ? 'אין עדיין שקילות בטווח הזה.'
            : 'צריך לפחות שתי שקילות בטווח הזה כדי לצייר גרף.'}
        </p>
      ) : (
        <>
          <div className="weight-chart-summary">
            {selectedEntry ? (
              <>
                <strong>{format(selectedEntry.kg)} ק״ג</strong>
                <span>{formatDate(selectedEntry.measuredOn)}</span>
                {selectedEntry.condition && (
                  <span className="weight-tag">{CONDITION_LABELS[selectedEntry.condition]}</span>
                )}
                <button type="button" className="weight-chart-clear" onClick={() => setSelected(null)}>
                  נקה
                </button>
              </>
            ) : (
              <>
                {Math.round(model.points.change * 10) / 10 === 0 ? (
                  <strong>ללא שינוי</strong>
                ) : (
                  <strong>
                    <bdi>{formatDelta(model.points.change)}</bdi> ק״ג
                  </strong>
                )}
                <span>
                  במגמה, מ־{formatDate(model.points.first.measuredOn)} עד{' '}
                  {formatDate(model.points.last.measuredOn)}
                </span>
              </>
            )}
          </div>

          <svg
            className="weight-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`גרף משקל, ${model.visible.length} שקילות, מ־${format(
              model.points.first.kg,
            )} ל־${format(model.points.last.kg)} קילוגרם`}
          >
            {model.points.gridlines.map((line) => (
              <g key={line.value}>
                <line className="weight-grid" x1={LEFT} x2={RIGHT} y1={line.y} y2={line.y} />
                <text className="weight-axis" x={RIGHT + 9} y={line.y + 3.5}>
                  {format(line.value)}
                </text>
              </g>
            ))}

            <polyline className="weight-trend-line" points={model.points.averageLine} />

            {model.points.dots.map((dot) => (
              <circle
                key={dot.measuredOn}
                className={[
                  'weight-dot',
                  dot.condition === 'after' ? 'after' : '',
                  dot.measuredOn === selected ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                cx={dot.cx}
                cy={dot.cy}
                r={dot.measuredOn === selected ? 4.5 : 2.6}
              />
            ))}

            {/* Generous invisible targets, because a 2.6px dot is not tappable on a phone. */}
            {model.points.dots.map((dot) => (
              <circle
                key={`hit-${dot.measuredOn}`}
                className="weight-hit"
                cx={dot.cx}
                cy={dot.cy}
                r={11}
                onClick={() => setSelected(dot.measuredOn === selected ? null : dot.measuredOn)}
              >
                <title>{`${formatDate(dot.measuredOn)} · ${format(dot.kg)} ק״ג`}</title>
              </circle>
            ))}

            <text className="weight-axis" x={LEFT} y={H - 6} textAnchor="start">
              {formatDate(model.points.first.measuredOn)}
            </text>
            <text className="weight-axis" x={RIGHT} y={H - 6} textAnchor="end">
              {formatDate(model.points.last.measuredOn)}
            </text>
          </svg>

          <div className="weight-chart-legend">
            <span className="legend-trend">ממוצע 7 ימים</span>
            {hasBoth ? (
              <>
                <span className="legend-dot">{CONDITION_LABELS.before}</span>
                <span className="legend-dot after">{CONDITION_LABELS.after}</span>
              </>
            ) : (
              <span className="legend-dot">שקילה יומית</span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
