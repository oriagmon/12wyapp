export type PerformanceSet = {
  weight: number
  reps: number
}

export type WeightReading = {
  measuredOn: string
  kg: number
}

/**
 * Epley's estimated one-rep max gives weight and repetitions one comparable score.
 * This handles mixed progress (for example, a heavier set with one fewer rep) without
 * pretending that raw volume is the same thing as strength.
 */
export function estimatedOneRepMax(set: PerformanceSet) {
  return set.weight * (1 + set.reps / 30)
}

export function beatsPreviousSet(current: PerformanceSet, previous: PerformanceSet) {
  return estimatedOneRepMax(current) > estimatedOneRepMax(previous) + 0.000_001
}

export function strongestPerformanceSet<T extends PerformanceSet>(sets: T[]) {
  return sets.reduce<T | null>(
    (strongest, set) =>
      strongest === null || estimatedOneRepMax(set) > estimatedOneRepMax(strongest)
        ? set
        : strongest,
    null,
  )
}

export function isAllTimeHighWeight(
  readings: WeightReading[],
  measuredOn: string,
  kg: number,
) {
  const previousReadings = readings.filter((entry) => entry.measuredOn !== measuredOn)
  return (
    previousReadings.length > 0 &&
    kg > Math.max(...previousReadings.map((entry) => entry.kg))
  )
}
