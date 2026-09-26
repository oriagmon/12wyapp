import { useMemo, useState } from 'react'
import { estimatedOneRepMax, strongestPerformanceSet } from './progress'

type Range = 30 | 90 | 0
type Metric = 'estimatedMax' | 'weight' | 'reps'

type Exercise = {
  id: string
  name: string
}

type ExerciseSet = {
  exerciseId: string
  weight: number
  reps: number
}

type Session = {
  id: string
  completedAt: string
  sets: ExerciseSet[]
}

type Props = {
  today: string
  exercises: Exercise[]
  sessions: Session[]
}

const RANGES: { value: Range; label: string }[] = [
  { value: 30, label: '30 יום' },
  { value: 90, label: '90 יום' },
  { value: 0, label: 'הכל' },
]

const METRICS: { value: Metric; label: string; summary: string; unit: string }[] = [
  {
    value: 'estimatedMax',
    label: 'כוח משוער',
    summary: 'כוח משוער (משקל + חזרות)',
    unit: 'ק״ג',
  },
  { value: 'weight', label: 'משקל בפועל', summary: 'משקל בפועל', unit: 'ק״ג' },
  { value: 'reps', label: 'חזרות', summary: 'מספר חזרות', unit: 'חזרות' },
]

const DAY_MS = 86_400_000
const W = 320
const H = 196
const LEFT = 8
const RIGHT = 266
const TOP = 14
const BOTTOM = 162

function toDay(value: string) {
  return Math.floor(Date.parse(value) / DAY_MS)
}

function format(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' }).format(
    new Date(value),
  )
}

function niceStep(span: number) {
  const raw = span / 4
  return [0.5, 1, 2, 2.5, 5, 10, 20, 50].find((step) => step >= raw) ?? 100
}

export function ExerciseWeightChart({ today, exercises, sessions }: Props) {
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? '')
  const [chosenRange, setChosenRange] = useState<Range | null>(null)
  const [metric, setMetric] = useState<Metric>('estimatedMax')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const selectedExercise =
    exercises.find((exercise) => exercise.id === exerciseId) ?? exercises[0]

  const allPoints = useMemo(() => {
    if (!selectedExercise) return []
    return sessions
      .flatMap((session) => {
        const strongest = strongestPerformanceSet(
          session.sets.filter((set) => set.exerciseId === selectedExercise.id),
        )
        if (!strongest) return []
        return [
          {
            sessionId: session.id,
            completedAt: session.completedAt,
            day: toDay(session.completedAt),
            weight: strongest.weight,
            reps: strongest.reps,
            estimatedMax: estimatedOneRepMax(strongest),
          },
        ]
      })
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
  }, [sessions, selectedExercise])

  const autoRange = useMemo<Range>(() => {
    const todayDay = toDay(`${today}T00:00:00Z`)
    const within = (days: number) =>
      allPoints.filter((point) => todayDay - point.day < days).length
    if (within(30) >= 2) return 30
    if (within(90) >= 2) return 90
    return 0
  }, [allPoints, today])

  const range = chosenRange ?? autoRange
  const metricConfig = METRICS.find((option) => option.value === metric)!
  const model = useMemo(() => {
    const todayDay = toDay(`${today}T00:00:00Z`)
    const visible =
      range === 0
        ? allPoints
        : allPoints.filter((point) => todayDay - point.day < range)
    if (visible.length < 2) return { visible, chart: null }

    const minDay = visible[0].day
    const maxDay = visible[visible.length - 1].day
    const daySpan = Math.max(maxDay - minDay, 1)
    let lo = Math.min(...visible.map((point) => point[metric]))
    let hi = Math.max(...visible.map((point) => point[metric]))
    const minimumSpan = metric === 'reps' ? 2 : 5
    if (hi - lo < minimumSpan) {
      const middle = (hi + lo) / 2
      lo = middle - minimumSpan / 2
      hi = middle + minimumSpan / 2
    }
    const padding = (hi - lo) * 0.08
    lo -= padding
    hi += padding

    const step = metric === 'reps' ? Math.max(1, niceStep(hi - lo)) : niceStep(hi - lo)
    const gridlines: number[] = []
    for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
      gridlines.push(Math.round(value * 10) / 10)
    }

    const x = (day: number) => LEFT + ((day - minDay) / daySpan) * (RIGHT - LEFT)
    const y = (value: number) => BOTTOM - ((value - lo) / (hi - lo)) * (BOTTOM - TOP)
    const dots = visible.map((point) => ({
      ...point,
      cx: x(point.day),
      cy: y(point[metric]),
    }))

    return {
      visible,
      chart: {
        dots,
        line: dots.map((point) => `${point.cx},${point.cy}`).join(' '),
        gridlines: gridlines.map((value) => ({ value, y: y(value) })),
        change: visible.at(-1)![metric] - visible[0][metric],
        first: visible[0],
        last: visible.at(-1)!,
      },
    }
  }, [allPoints, metric, range, today])

  if (!selectedExercise) return null

  const selectedPoint =
    model.visible.find((point) => point.sessionId === selectedSessionId) ?? null

  return (
    <section className="exercise-weight-chart-card">
      <div className="exercise-chart-head">
        <div>
          <h3>משקלי חדר כושר לאורך זמן</h3>
          <p>בכל אימון נבחר הסט עם הכוח המשוער הגבוה ביותר. אפשר לבחור איזה נתון ממנו להשוות.</p>
        </div>
        <div className="weight-range" role="group" aria-label="טווח גרף משקלי חדר כושר">
          {RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={range === option.value ? 'active' : undefined}
              aria-pressed={range === option.value}
              onClick={() => {
                setChosenRange(option.value)
                setSelectedSessionId(null)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="exercise-chart-picker" role="group" aria-label="בחירת תרגיל לגרף">
        {exercises.map((exercise) => (
          <button
            key={exercise.id}
            type="button"
            className={selectedExercise.id === exercise.id ? 'active' : undefined}
            aria-pressed={selectedExercise.id === exercise.id}
            onClick={() => {
              setExerciseId(exercise.id)
              setChosenRange(null)
              setSelectedSessionId(null)
            }}
          >
            {exercise.name}
          </button>
        ))}
      </div>

      <div className="exercise-chart-controls">
        <span>מה להשוות:</span>
        <div className="exercise-chart-picker" role="group" aria-label="בחירת נתון להשוואה">
          {METRICS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={metric === option.value ? 'active' : undefined}
              aria-pressed={metric === option.value}
              onClick={() => setMetric(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="exercise-chart-summary">
        {selectedPoint ? (
          <>
            <strong>
              <bdi>{format(selectedPoint[metric])} {metricConfig.unit}</bdi>
            </strong>
            <span>{formatDate(selectedPoint.completedAt)}</span>
            <span>
              הסט שנבחר: <bdi>{format(selectedPoint.weight)} ק״ג × {selectedPoint.reps} חזרות</bdi>
            </span>
            <span>כוח משוער: {format(selectedPoint.estimatedMax)} ק״ג</span>
          </>
        ) : model.chart ? (
          <>
            <strong>
              {Math.abs(model.chart.change) < 0.05
                ? 'ללא שינוי'
                : `${model.chart.change > 0 ? '+' : '−'}${format(Math.abs(model.chart.change))} ${metricConfig.unit}`}
            </strong>
            <span>שינוי ב{metricConfig.summary} מהאימון הראשון לאחרון · {selectedExercise.name}</span>
          </>
        ) : (
          <strong>{selectedExercise.name}</strong>
        )}
      </div>

      {model.chart ? (
        <>
          <svg
            className="exercise-weight-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`גרף ${metricConfig.summary} לתרגיל ${selectedExercise.name}, ${model.visible.length} אימונים`}
          >
            {model.chart.gridlines.map((line) => (
              <g key={line.value}>
                <line className="weight-grid" x1={LEFT} x2={RIGHT} y1={line.y} y2={line.y} />
                <text className="weight-axis" x={RIGHT + 9} y={line.y + 3.5}>
                  {format(line.value)}
                </text>
              </g>
            ))}
            <polyline className="exercise-progress-line" points={model.chart.line} />
            {model.chart.dots.map((dot) => (
              <circle
                key={dot.sessionId}
                className={dot.sessionId === selectedSessionId ? 'exercise-dot selected' : 'exercise-dot'}
                cx={dot.cx}
                cy={dot.cy}
                r={dot.sessionId === selectedSessionId ? 4.5 : 3}
              />
            ))}
            {model.chart.dots.map((dot) => (
              <circle
                key={`hit-${dot.sessionId}`}
                className="weight-hit"
                cx={dot.cx}
                cy={dot.cy}
                r={11}
                onClick={() =>
                  setSelectedSessionId(
                    dot.sessionId === selectedSessionId ? null : dot.sessionId,
                  )
                }
              >
                <title>{`${formatDate(dot.completedAt)} · ${metricConfig.summary}: ${format(dot[metric])} ${metricConfig.unit} · סט: ${format(dot.weight)} ק״ג × ${dot.reps} חזרות`}</title>
              </circle>
            ))}
            <text className="weight-axis" x={LEFT} y={H - 6} textAnchor="start">
              {formatDate(model.chart.first.completedAt)}
            </text>
            <text className="weight-axis" x={RIGHT} y={H - 6} textAnchor="end">
              {formatDate(model.chart.last.completedAt)}
            </text>
          </svg>
          <p className="exercise-chart-legend">
            הסט החזק נקבע לפי 1RM משוער: משקל × (1 + חזרות ÷ 30). כרגע הקו מציג {metricConfig.summary}.
          </p>
        </>
      ) : (
        <p className="weight-chart-empty">
          {model.visible.length === 0
            ? 'אין עדיין אימונים מתועדים לתרגיל הזה.'
            : 'צריך עוד אימון אחד כדי לצייר גרף.'}
        </p>
      )}
    </section>
  )
}
