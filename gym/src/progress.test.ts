import { describe, expect, it } from 'vitest'
import { beatsPreviousSet, estimatedOneRepMax, isAllTimeHighWeight } from './progress'

describe('exercise progress', () => {
  it('counts more repetitions at the same weight as progress', () => {
    expect(beatsPreviousSet({ weight: 60, reps: 9 }, { weight: 60, reps: 8 })).toBe(true)
  })

  it('counts more weight at the same repetitions as progress', () => {
    expect(beatsPreviousSet({ weight: 62.5, reps: 8 }, { weight: 60, reps: 8 })).toBe(true)
  })

  it('uses estimated one-rep max when weight and repetitions move in opposite directions', () => {
    expect(estimatedOneRepMax({ weight: 65, reps: 7 })).toBeGreaterThan(
      estimatedOneRepMax({ weight: 60, reps: 8 }),
    )
    expect(beatsPreviousSet({ weight: 65, reps: 7 }, { weight: 60, reps: 8 })).toBe(true)
    expect(beatsPreviousSet({ weight: 62.5, reps: 6 }, { weight: 60, reps: 8 })).toBe(false)
  })

  it('does not celebrate an identical set', () => {
    expect(beatsPreviousSet({ weight: 60, reps: 8 }, { weight: 60, reps: 8 })).toBe(false)
  })
})

describe('body-weight records', () => {
  const readings = [
    { measuredOn: '2026-09-01', kg: 74.2 },
    { measuredOn: '2026-09-02', kg: 74.8 },
  ]

  it('requires a strictly higher reading than every other day', () => {
    expect(isAllTimeHighWeight(readings, '2026-09-03', 74.9)).toBe(true)
    expect(isAllTimeHighWeight(readings, '2026-09-03', 74.8)).toBe(false)
  })

  it('compares an edited day against the other days, not its old value', () => {
    expect(isAllTimeHighWeight(readings, '2026-09-02', 74.3)).toBe(true)
  })

  it('does not call the first reading a record', () => {
    expect(isAllTimeHighWeight([], '2026-09-01', 74.2)).toBe(false)
  })
})
