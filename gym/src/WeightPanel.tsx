import { useMemo, useState } from 'react'
import type { WeightCondition, WeightEntry } from './api'

type Props = {
  today: string
  weights: WeightEntry[]
  saving: boolean
  error: string | null
  onSave: (
    measuredOn: string,
    kg: number,
    condition: WeightCondition | null,
  ) => Promise<boolean>
}

const MIN_KG = 20
const MAX_KG = 400

/** Remembering the last choice is what keeps logging to a single tap: the toggle is almost
 *  always already on the option you use every morning. */
const CONDITION_KEY = 'gym-weight-condition'

const CONDITION_LABELS: Record<WeightCondition, string> = {
  before: 'לפני שירותים',
  after: 'אחרי שירותים',
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

function format(value: number) {
  return value.toFixed(1)
}

function formatDelta(value: number) {
  const rounded = round(value)
  if (rounded === 0) return 'ללא שינוי'
  return `${rounded > 0 ? '+' : '−'}${format(Math.abs(rounded))}`
}

function formatDay(iso: string) {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' }).format(
    new Date(`${iso}T00:00:00`),
  )
}

/** A bare polyline over the recent readings. Enough to see a direction, small enough to sit
 *  above the fold on a phone without becoming a chart you have to interpret. */
function Sparkline({ entries }: { entries: WeightEntry[] }) {
  if (entries.length < 2) return null

  const values = entries.map((entry) => entry.kg)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 100
  const height = 28

  const points = entries
    .map((entry, index) => {
      const x = (index / (entries.length - 1)) * width
      const y = height - ((entry.kg - min) / span) * height
      return `${round(x)},${round(y)}`
    })
    .join(' ')

  return (
    <svg className="weight-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * Morning weigh-in.
 *
 * The whole design goal is that logging is one tap. Your weight tomorrow is nearly always
 * within a few hundred grams of your weight today, so the field arrives pre-filled with the
 * last reading and the primary button states the value it is about to save. Unchanged is the
 * common case and costs a single tap; a correction costs one tap per 100g.
 *
 * Once the day is logged the panel collapses to a summary, because there is nothing left to
 * do and it should not sit there asking again.
 */
export function WeightPanel({ today, weights, saving, error, onSave }: Props) {
  const todayEntry = useMemo(
    () => weights.find((entry) => entry.measuredOn === today) ?? null,
    [weights, today],
  )
  const previous = useMemo(() => {
    const earlier = weights.filter((entry) => entry.measuredOn !== today)
    return earlier.at(-1) ?? null
  }, [weights, today])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [manual, setManual] = useState('')
  const [condition, setCondition] = useState<WeightCondition | null>(() => {
    try {
      const stored = localStorage.getItem(CONDITION_KEY)
      return stored === 'before' || stored === 'after' ? stored : null
    } catch {
      return null
    }
  })

  /**
   * What today's number should actually be compared against.
   *
   * Comparing a "before" reading against an "after" one invents a few hundred grams of
   * change that never happened, so when we know how today was measured we look back for the
   * most recent reading taken the same way. Only if there isn't one do we fall back to the
   * previous reading regardless.
   */
  const comparable = useMemo(() => {
    const earlier = weights.filter((entry) => entry.measuredOn !== today)
    const target = todayEntry?.condition ?? condition
    if (target) {
      const sameCondition = earlier.filter((entry) => entry.condition === target).at(-1)
      if (sameCondition) return sameCondition
    }
    return earlier.at(-1) ?? null
  }, [weights, today, todayEntry?.condition, condition])

  const seed = todayEntry?.kg ?? previous?.kg ?? null
  const value = draft ?? seed

  const recent = useMemo(() => weights.slice(-30), [weights])
  const weekAverage = useMemo(() => {
    const lastSeven = weights.slice(-7)
    if (lastSeven.length === 0) return null
    return lastSeven.reduce((sum, entry) => sum + entry.kg, 0) / lastSeven.length
  }, [weights])

  function adjust(delta: number) {
    if (value === null) return
    setDraft(Math.min(MAX_KG, Math.max(MIN_KG, round(value + delta))))
  }

  function chooseCondition(next: WeightCondition) {
    const value = condition === next ? null : next
    setCondition(value)
    try {
      if (value) localStorage.setItem(CONDITION_KEY, value)
      else localStorage.removeItem(CONDITION_KEY)
    } catch {
      // Not remembering the choice is a small annoyance, not a failure worth reporting.
    }
  }

  /**
   * Only a confirmed save may drop the local draft. If the request failed the number the
   * user typed is the only copy of it, so it stays on screen for them to retry.
   */
  async function submit() {
    if (value === null || saving) return
    if (await onSave(today, value, condition)) {
      setDraft(null)
      setEditing(false)
    }
  }

  async function submitManual() {
    const parsed = Number.parseFloat(manual.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < MIN_KG || parsed > MAX_KG) return
    if (await onSave(today, round(parsed), condition)) {
      setManual('')
      setDraft(null)
      setEditing(false)
    }
  }

  const showForm = !todayEntry || editing

  return (
    <section className="weight-card">
      <div className="weight-head">
        <h2>שקילת בוקר</h2>
        {todayEntry && !editing && (
          <button
            type="button"
            className="weight-edit"
            onClick={() => {
              setEditing(true)
              if (todayEntry.condition) setCondition(todayEntry.condition)
            }}
          >
            עדכון
          </button>
        )}
      </div>

      {error && <p className="weight-error" role="alert">{error}</p>}

      {todayEntry && !editing && (
        <div className="weight-done">
          <strong>{format(todayEntry.kg)}</strong>
          <span className="weight-unit">ק״ג</span>
          {todayEntry.condition && (
            <span className="weight-tag">{CONDITION_LABELS[todayEntry.condition]}</span>
          )}
          {comparable && (
            <span className="weight-delta">
              <bdi>{formatDelta(todayEntry.kg - comparable.kg)}</bdi> מהשקילה הקודמת
            </span>
          )}
        </div>
      )}

      {showForm && value !== null && (
        <>
          <div className="weight-stepper">
            <button type="button" onClick={() => adjust(-0.1)} aria-label="פחות 100 גרם">
              −
            </button>
            <div className="weight-value">
              <strong>{format(value)}</strong>
              <span className="weight-unit">ק״ג</span>
            </div>
            <button type="button" onClick={() => adjust(0.1)} aria-label="עוד 100 גרם">
              +
            </button>
          </div>

          <div className="weight-jumps">
            <button type="button" onClick={() => adjust(-0.5)}>
              −0.5
            </button>
            <button type="button" onClick={() => adjust(0.5)}>
              +0.5
            </button>
          </div>

          <div className="weight-conditions" role="group" aria-label="תנאי השקילה">
            {(['before', 'after'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={condition === option ? 'active' : undefined}
                aria-pressed={condition === option}
                onClick={() => chooseCondition(option)}
              >
                {CONDITION_LABELS[option]}
              </button>
            ))}
          </div>

          <button type="button" className="weight-save" onClick={submit} disabled={saving}>
            {saving ? 'שומר…' : `שמור ${format(value)} ק״ג`}
          </button>

          {previous && (
            <p className="weight-hint">
              בשקילה הקודמת ({formatDay(previous.measuredOn)}): {format(previous.kg)} ק״ג
            </p>
          )}
        </>
      )}

      {showForm && value === null && (
        <div className="weight-first">
          <p className="weight-hint">זו השקילה הראשונה — מה המשקל שלך הבוקר?</p>
          <div className="weight-manual">
            <input
              inputMode="decimal"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="82.4"
              aria-label="משקל בקילוגרמים"
            />
            <button type="button" onClick={submitManual} disabled={saving || manual.trim() === ''}>
              שמור
            </button>
          </div>
        </div>
      )}

      {recent.length >= 2 && (
        <div className="weight-trend">
          <Sparkline entries={recent} />
          <div className="weight-stats">
            {weekAverage !== null && <span>ממוצע שבוע: {format(weekAverage)} ק״ג</span>}
            <span>{recent.length} שקילות אחרונות</span>
          </div>
        </div>
      )}
    </section>
  )
}
