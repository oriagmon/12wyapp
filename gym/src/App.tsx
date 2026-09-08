import { useEffect, useRef, useState } from 'react'
import './App.css'
import { NotSignedInError, fetchState, saveState, saveWeight, type WeightEntry } from './api'
import { WeightChart } from './WeightChart'
import { WeightPanel } from './WeightPanel'

type WorkoutId = 'A' | 'B' | 'C'
type Tab = 'workout' | 'weight' | 'history'

type Exercise = {
  id: string
  name: string
  englishName: string
  sets: number
  repMin: number
  repMax: number
  targetRir: number
  restSeconds: number
  weightStep: number
  initialWeight?: number
  perHand?: boolean
}

type Workout = {
  id: WorkoutId
  label: string
  focus: string
  exercises: Exercise[]
  trackingSteps: {
    exerciseId: string
    restAfterSeconds: number
  }[]
}

type WorkoutStep = {
  exercise: Exercise
  setNumber: number
  restAfterSeconds: number
}

type LoggedSet = {
  id: string
  exerciseId: string
  setNumber: number
  weight: number
  reps: number
  rir: number
  completedAt: string
}

type ActiveSession = {
  id: string
  workoutId: WorkoutId
  startedAt: string
  sets: LoggedSet[]
}

type CompletedSession = ActiveSession & {
  completedAt: string
}

type AppData = {
  sessions: CompletedSession[]
  active: ActiveSession | null
}

type SetDraft = {
  token: string
  weight: number
  reps: number
  rir: number
}

const STORAGE_KEY = 'gym-tracker-v1'
const LEGACY_STORAGE_KEYS = ['ori-gym-tracker-v1']
const WORKOUT_ORDER: WorkoutId[] = ['A', 'B', 'C']

const WORKOUTS: Record<WorkoutId, Workout> = {
  A: {
    id: 'A',
    label: 'אימון A',
    focus: 'חזה אופקי + גב',
    trackingSteps: [
      { exerciseId: 'bench-press', restAfterSeconds: 0 },
      { exerciseId: 'bench-press', restAfterSeconds: 0 },
      { exerciseId: 'bench-press', restAfterSeconds: 0 },
      { exerciseId: 'cable-fly', restAfterSeconds: 0 },
      { exerciseId: 'cable-fly', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
    ],
    exercises: [
      {
        id: 'bench-press',
        name: 'לחיצת חזה במוט',
        englishName: 'Bench Press',
        sets: 3,
        repMin: 6,
        repMax: 8,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 2.5,
        initialWeight: 55,
      },
      {
        id: 'chest-supported-row',
        name: 'חתירה עם תמיכת חזה',
        englishName: 'Chest-Supported Row',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 2.5,
      },
      {
        id: 'lat-pulldown',
        name: 'משיכת פולי עליון',
        englishName: 'Lat Pulldown',
        sets: 2,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 75,
        weightStep: 5,
        initialWeight: 45,
      },
      {
        id: 'cable-fly',
        name: 'פרפר בכבלים',
        englishName: 'Cable Fly',
        sets: 2,
        repMin: 10,
        repMax: 15,
        targetRir: 2,
        restSeconds: 75,
        weightStep: 2.5,
      },
      {
        id: 'incline-dumbbell-curl',
        name: 'כפיפת דו־ראשי בשיפוע עם דאמבלים',
        englishName: 'Incline Dumbbell Curl',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 1,
        restSeconds: 60,
        weightStep: 1,
        initialWeight: 14,
        perHand: true,
      },
      {
        id: 'lateral-raise',
        name: 'הרחקת כתפיים',
        englishName: 'Lateral Raise',
        sets: 3,
        repMin: 12,
        repMax: 20,
        targetRir: 1,
        restSeconds: 60,
        weightStep: 1,
        initialWeight: 6,
        perHand: true,
      },
    ],
  },
  B: {
    id: 'B',
    label: 'אימון B',
    focus: 'תמיכה קצרה ליום טנ״ש',
    trackingSteps: [
      { exerciseId: 'leg-press', restAfterSeconds: 0 },
      { exerciseId: 'leg-press', restAfterSeconds: 0 },
      { exerciseId: 'seated-cable-row', restAfterSeconds: 0 },
      { exerciseId: 'seated-cable-row', restAfterSeconds: 0 },
      { exerciseId: 'seated-cable-row', restAfterSeconds: 0 },
      { exerciseId: 'reverse-pec-deck', restAfterSeconds: 0 },
      { exerciseId: 'reverse-pec-deck', restAfterSeconds: 0 },
      { exerciseId: 'reverse-pec-deck', restAfterSeconds: 0 },
    ],
    exercises: [
      {
        id: 'seated-cable-row',
        name: 'חתירה בישיבה בכבל',
        englishName: 'Seated Cable Row',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 5,
      },
      {
        id: 'leg-press',
        name: 'לחיצת רגליים',
        englishName: 'Leg Press',
        sets: 2,
        repMin: 8,
        repMax: 12,
        targetRir: 3,
        restSeconds: 105,
        weightStep: 5,
      },
      {
        id: 'reverse-pec-deck',
        name: 'פרפר הפוך במכונה',
        englishName: 'Reverse Pec Deck',
        sets: 3,
        repMin: 12,
        repMax: 20,
        targetRir: 2,
        restSeconds: 60,
        weightStep: 5,
      },
      {
        id: 'overhead-triceps',
        name: 'פשיטת מרפק מעל הראש בכבל',
        englishName: 'Overhead Cable Extension',
        sets: 3,
        repMin: 10,
        repMax: 15,
        targetRir: 2,
        restSeconds: 60,
        weightStep: 2.5,
      },
    ],
  },
  C: {
    id: 'C',
    label: 'אימון C',
    focus: 'חזה בשיפוע + תמיכה',
    trackingSteps: [
      { exerciseId: 'incline-dumbbell-press', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-press', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-press', restAfterSeconds: 0 },
      { exerciseId: 'machine-chest-press', restAfterSeconds: 0 },
      { exerciseId: 'machine-chest-press', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
      { exerciseId: 'incline-dumbbell-curl', restAfterSeconds: 0 },
    ],
    exercises: [
      {
        id: 'incline-dumbbell-press',
        name: 'לחיצה בשיפוע 30° עם דאמבלים',
        englishName: 'Incline Dumbbell Press',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 1,
        initialWeight: 18,
        perHand: true,
      },
      {
        id: 'neutral-lat-pulldown',
        name: 'פולי עליון באחיזה ניטרלית',
        englishName: 'Neutral-Grip Pulldown',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 5,
        initialWeight: 45,
      },
      {
        id: 'machine-chest-press',
        name: 'לחיצת חזה במכונה',
        englishName: 'Machine Chest Press',
        sets: 2,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        restSeconds: 90,
        weightStep: 5,
      },
      {
        id: 'back-extension',
        name: 'פשיטת גב על ספסל 45°',
        englishName: 'Back Extension',
        sets: 2,
        repMin: 10,
        repMax: 15,
        targetRir: 2,
        restSeconds: 60,
        weightStep: 2.5,
        initialWeight: 10,
      },
      {
        id: 'incline-dumbbell-curl',
        name: 'כפיפת דו־ראשי בשיפוע עם דאמבלים',
        englishName: 'Incline Dumbbell Curl',
        sets: 3,
        repMin: 8,
        repMax: 12,
        targetRir: 1,
        restSeconds: 60,
        weightStep: 1,
        initialWeight: 14,
        perHand: true,
      },
      {
        id: 'lateral-raise',
        name: 'הרחקת כתפיים',
        englishName: 'Lateral Raise',
        sets: 3,
        repMin: 12,
        repMax: 20,
        targetRir: 1,
        restSeconds: 60,
        weightStep: 1,
        initialWeight: 6,
        perHand: true,
      },
    ],
  },
}

const EMPTY_DATA: AppData = { sessions: [], active: null }

function totalSets(workout: Workout) {
  return workout.trackingSteps.length
}

function getWorkoutExercise(workout: Workout, exerciseId: string) {
  const exercise = workout.exercises.find((item) => item.id === exerciseId)
  if (!exercise) {
    throw new Error(`Missing exercise "${exerciseId}" in workout ${workout.id}`)
  }
  return exercise
}

function trackedExercises(workout: Workout) {
  const exerciseIds = [...new Set(workout.trackingSteps.map((step) => step.exerciseId))]
  return exerciseIds.map((exerciseId) => getWorkoutExercise(workout, exerciseId))
}

function workoutSequence(workout: Workout): WorkoutStep[] {
  const setCounts = new Map<string, number>()
  return workout.trackingSteps.map((step) => {
    const setNumber = (setCounts.get(step.exerciseId) ?? 0) + 1
    setCounts.set(step.exerciseId, setNumber)
    return {
      exercise: getWorkoutExercise(workout, step.exerciseId),
      setNumber,
      restAfterSeconds: step.restAfterSeconds,
    }
  })
}

function nextWorkoutId(current?: WorkoutId): WorkoutId {
  if (!current) return 'A'
  return WORKOUT_ORDER[(WORKOUT_ORDER.indexOf(current) + 1) % WORKOUT_ORDER.length]
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

type ParsedStore =
  | { ok: true; data: AppData }
  | { ok: false; reason: 'unreadable' | 'malformed' }

function parseStoredData(raw: string): ParsedStore {
  let parsed: Partial<AppData>
  try {
    parsed = JSON.parse(raw) as Partial<AppData>
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!Array.isArray(parsed.sessions) || !('active' in parsed)) {
    return { ok: false, reason: 'malformed' }
  }
  return {
    ok: true,
    data: {
      sessions: parsed.sessions as CompletedSession[],
      active: (parsed.active as ActiveSession | null) ?? null,
    },
  }
}

function readStoredData(): { data: AppData; error: string | null } {
  const currentRaw = localStorage.getItem(STORAGE_KEY)
  const current = currentRaw === null ? null : parseStoredData(currentRaw)

  // Refuse to touch a current log we cannot read rather than quietly starting a new one
  // on top of it: `persistenceEnabled` goes false off the back of this, so the bytes stay
  // on disk and can still be exported by hand.
  if (current && !current.ok) {
    return {
      data: EMPTY_DATA,
      error:
        current.reason === 'malformed'
          ? 'המידע המקומי לא בפורמט תקין. אפשר לייצא אותו ידנית או להתחיל מחדש.'
          : 'לא הצלחתי לקרוא את המידע המקומי. שום דבר לא נמחק אוטומטית.',
    }
  }

  // The old key is MERGED in, not just used when the current one is missing. Simply
  // opening this app writes a current key, so a plain fallback would be shadowed by that
  // empty record and the older history would never be seen again — and on a phone that
  // history is frequently the only copy there is. Merging makes adoption independent of
  // the order the two keys happened to appear in. Nothing is deleted here; the old key is
  // left in place as a backup until the user explicitly resets.
  let data = current?.ok ? current.data : EMPTY_DATA
  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    const legacy = parseStoredData(raw)
    if (legacy.ok) data = mergeLogs(data, legacy.data)
  }

  return { data, error: null }
}

function formatDuration(startedAt: string, completedAt?: string) {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const minutes = Math.max(1, Math.round((end - new Date(startedAt).getTime()) / 60_000))
  return `${minutes} דק׳`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(value))
}

function formatTimer(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function getExerciseName(exerciseId: string) {
  for (const workout of Object.values(WORKOUTS)) {
    const match = workout.exercises.find((exercise) => exercise.id === exerciseId)
    if (match) return match.name
  }
  return exerciseId
}

function getLastExerciseSets(sessions: CompletedSession[], exerciseId: string) {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const sets = sessions[index].sets.filter((set) => set.exerciseId === exerciseId)
    if (sets.length > 0) return sets
  }
  return []
}

/**
 * Combines the log held on this device with the one the server has.
 *
 * Replacing one with the other is what loses a training history: whichever device happens to
 * sync second wins, so opening the tracker on a laptop that has never seen a workout would
 * push an empty log up and overwrite months of real sessions. Sessions carry stable ids, so
 * the union of both sides is well defined and nothing is dropped. Where the same id exists on
 * both, this device wins, because that is where the most recent edit was made.
 *
 * The cost of this choice is that deleting a session on one device can see it restored from
 * another until both have synced. Resurrecting one unwanted workout is a far smaller harm
 * than silently destroying a log that only ever existed in one browser.
 */
function mergeLogs(local: AppData, remote: Partial<AppData> | null | undefined): AppData {
  const remoteSessions = Array.isArray(remote?.sessions) ? remote.sessions : []
  const byId = new Map<string, CompletedSession>()
  for (const session of [...remoteSessions, ...local.sessions]) {
    if (session && typeof session.id === 'string') byId.set(session.id, session)
  }
  const sessions = [...byId.values()].sort((a, b) =>
    String(a.completedAt ?? '').localeCompare(String(b.completedAt ?? '')),
  )

  // A workout in progress belongs to whichever device started one most recently; the other
  // is a stale leftover from a session that was abandoned rather than finished.
  const remoteActive = remote?.active ?? null
  const active =
    local.active && remoteActive
      ? String(local.active.startedAt) >= String(remoteActive.startedAt)
        ? local.active
        : remoteActive
      : (local.active ?? remoteActive)

  return { sessions, active }
}

function App() {
  const [initial] = useState(() => readStoredData())
  const [data, setData] = useState<AppData>(initial.data)
  const [persistenceEnabled, setPersistenceEnabled] = useState(!initial.error)
  const [storageError, setStorageError] = useState<string | null>(initial.error)
  const lastSession = data.sessions.at(-1)
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutId>(
    data.active?.workoutId ?? nextWorkoutId(lastSession?.workoutId),
  )
  const [tab, setTab] = useState<Tab>('workout')
  const [draft, setDraft] = useState<SetDraft>({
    token: '',
    weight: 0,
    reps: 0,
    rir: 2,
  })
  const [restUntil, setRestUntil] = useState<number | null>(null)
  const [clock, setClock] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  // Server sync. Local storage stays in place as a cache so a dropped connection mid-workout
  // never costs you a set, but the server is what actually survives a new phone.
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10))
  const [syncState, setSyncState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>(
    'loading',
  )
  const [syncError, setSyncError] = useState<string | null>(null)
  const [savingWeight, setSavingWeight] = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!persistenceEnabled) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      queueMicrotask(() => {
        setStorageError('הדפדפן חסם שמירה מקומית. האימון הנוכחי לא יישמר אחרי סגירת העמוד.')
      })
    }
  }, [data, persistenceEnabled])

  /**
   * Pull everything down once on open and fold it into whatever this browser already had,
   * so a history that until now only ever existed on one phone is adopted rather than
   * replaced by an empty server-side log (or vice versa).
   */
  useEffect(() => {
    let cancelled = false

    fetchState<AppData>()
      .then((remote) => {
        if (cancelled) return
        // Defensive: a blank screen is the worst possible failure for a tool you open at
        // 6am, so a response missing these fields degrades to "no readings yet" rather
        // than throwing out of render.
        setWeights(Array.isArray(remote?.weights) ? remote.weights : [])
        if (typeof remote?.today === 'string' && remote.today !== '') setToday(remote.today)

        setData((local) => mergeLogs(local, remote?.data))

        hydrated.current = true
        setSyncState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof NotSignedInError) {
          setSyncState('signed-out')
          return
        }
        setSyncState('error')
        setSyncError(error instanceof Error ? error.message : 'שגיאת סנכרון')
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Push the log up shortly after it stops changing. Logging a set fires several state
   * updates in a row, and a short debounce collapses those into one request instead of
   * writing the whole history to the database on every tap.
   */
  useEffect(() => {
    if (!hydrated.current || syncState !== 'ready') return

    const timeout = window.setTimeout(() => {
      saveState(data).catch(() => {
        // The local copy is still intact and the next change retries, so a failed sync is
        // not worth interrupting a workout for.
      })
    }, 800)

    return () => window.clearTimeout(timeout)
  }, [data, syncState])

  async function handleSaveWeight(
    measuredOn: string,
    kg: number,
    condition: 'before' | 'after' | null,
  ): Promise<boolean> {
    setSavingWeight(true)
    setSyncError(null)
    try {
      const result = await saveWeight(measuredOn, kg, condition)
      setWeights(Array.isArray(result?.weights) ? result.weights : [])
      return true
    } catch (error: unknown) {
      setSyncError(
        error instanceof NotSignedInError
          ? 'צריך להתחבר כדי לשמור'
          : error instanceof Error
            ? error.message
            : 'השמירה נכשלה',
      )
      return false
    } finally {
      setSavingWeight(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!restUntil) return
    const interval = window.setInterval(() => {
      const currentTime = Date.now()
      setClock(currentTime)
      if (currentTime >= restUntil) {
        setRestUntil(null)
        navigator.vibrate?.([100, 80, 100])
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [restUntil])

  const activeWorkout = data.active ? WORKOUTS[data.active.workoutId] : null
  const activeSetCount = data.active?.sets.length ?? 0
  const activeSequence = activeWorkout ? workoutSequence(activeWorkout) : []
  const currentStep = data.active ? activeSequence[activeSetCount] ?? null : null
  const currentExercise = currentStep?.exercise ?? null

  const currentExerciseSets =
    data.active && currentExercise
      ? data.active.sets.filter((set) => set.exerciseId === currentExercise.id)
      : []
  const currentSetNumber = currentStep?.setNumber ?? 1
  const currentToken = data.active && currentExercise
    ? `${data.active.id}:${currentExercise.id}:${currentSetNumber}`
    : ''

  let effectiveDraft = draft
  if (currentExercise && data.active && draft.token !== currentToken) {
    const previousCurrentSet = currentExerciseSets.at(-1)
    const historicalSets = getLastExerciseSets(data.sessions, currentExercise.id)
    const historicalMatch =
      historicalSets[currentSetNumber - 1] ?? historicalSets.at(-1)

    effectiveDraft = {
      token: currentToken,
      weight:
        previousCurrentSet?.weight ??
        historicalMatch?.weight ??
        currentExercise.initialWeight ??
        0,
      reps:
        historicalMatch?.reps ??
        previousCurrentSet?.reps ??
        currentExercise.repMin,
      rir: currentExercise.targetRir,
    }
  }

  const draftWeight = effectiveDraft.weight
  const draftReps = effectiveDraft.reps
  const draftRir = effectiveDraft.rir

  function updateDraft(update: Partial<Omit<SetDraft, 'token'>>) {
    setDraft({ ...effectiveDraft, ...update, token: currentToken })
  }

  function startWorkout() {
    setData((current) => ({
      ...current,
      active: {
        id: createId(),
        workoutId: selectedWorkout,
        startedAt: new Date().toISOString(),
        sets: [],
      },
    }))
    setNotice(null)
    navigator.vibrate?.(30)
  }

  function completeSet() {
    if (
      !data.active ||
      !activeWorkout ||
      !currentExercise ||
      !currentStep ||
      draftWeight <= 0
    ) return

    const loggedSet: LoggedSet = {
      id: createId(),
      exerciseId: currentExercise.id,
      setNumber: currentSetNumber,
      weight: draftWeight,
      reps: draftReps,
      rir: draftRir,
      completedAt: new Date().toISOString(),
    }
    const updatedSets = [...data.active.sets, loggedSet]
    const workoutIsComplete = updatedSets.length === totalSets(activeWorkout)

    if (workoutIsComplete) {
      const completedSession: CompletedSession = {
        ...data.active,
        sets: updatedSets,
        completedAt: loggedSet.completedAt,
      }
      setData((current) => ({
        sessions: [...current.sessions, completedSession],
        active: null,
      }))
      setSelectedWorkout(nextWorkoutId(activeWorkout.id))
      setRestUntil(null)
      setTab('workout')
      setNotice(`${activeWorkout.label} נשמר. האימון הבא כבר מוכן.`)
      navigator.vibrate?.([80, 60, 160])
      return
    }

    setData((current) => ({
      ...current,
      active: current.active ? { ...current.active, sets: updatedSets } : null,
    }))
    if (currentStep.restAfterSeconds > 0) {
      const completedAtMs = new Date(loggedSet.completedAt).getTime()
      setRestUntil(completedAtMs + currentStep.restAfterSeconds * 1000)
      setClock(completedAtMs)
    } else {
      setRestUntil(null)
    }
    navigator.vibrate?.(35)
  }

  function undoLastSet() {
    if (!data.active || data.active.sets.length === 0) return
    setData((current) => ({
      ...current,
      active: current.active
        ? { ...current.active, sets: current.active.sets.slice(0, -1) }
        : null,
    }))
    setRestUntil(null)
  }

  function cancelWorkout() {
    if (!data.active) return
    if (!window.confirm('לבטל את האימון הנוכחי? הסטים שלו לא יישמרו.')) return
    setData((current) => ({ ...current, active: null }))
    setRestUntil(null)
  }

  function restoreLastCompletedSet() {
    const completedSession = data.sessions.at(-1)
    if (!completedSession) return
    const remainingSets = completedSession.sets.slice(0, -1)
    setData((current) => ({
      sessions: current.sessions.slice(0, -1),
      active: {
        id: completedSession.id,
        workoutId: completedSession.workoutId,
        startedAt: completedSession.startedAt,
        sets: remainingSets,
      },
    }))
    setSelectedWorkout(completedSession.workoutId)
    setNotice('הסט האחרון בוטל והאימון נפתח מחדש.')
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `gym-tracker-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function resetCorruptedData() {
    localStorage.removeItem(STORAGE_KEY)
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
    setData(EMPTY_DATA)
    setSelectedWorkout('A')
    setStorageError(null)
    setPersistenceEnabled(true)
  }

  if (data.active && activeWorkout && currentExercise && currentStep) {
    const priorSets = getLastExerciseSets(data.sessions, currentExercise.id)
    const priorSummary = priorSets.length
      ? priorSets.map((set) => `${set.weight}×${set.reps}`).join(' · ')
      : 'אין עדיין תיעוד קודם'
    const remainingRest = restUntil ? Math.max(0, restUntil - clock) : 0

    return (
      <main className="app-shell active-shell" dir="rtl">
        <header className="active-header">
          <div>
            <span className="eyebrow">{activeWorkout.label}</span>
            <strong>{activeSetCount}/{totalSets(activeWorkout)} סטים</strong>
          </div>
          <button className="text-button danger-text" type="button" onClick={cancelWorkout}>
            ביטול
          </button>
        </header>

        <div className="progress-track" aria-label="התקדמות באימון">
          <span
            style={{ width: `${(activeSetCount / totalSets(activeWorkout)) * 100}%` }}
          />
        </div>

        {restUntil && (
          <aside className="rest-timer" aria-live="polite">
            <span>מנוחה</span>
            <strong>{formatTimer(remainingRest)}</strong>
          </aside>
        )}

        <section className="exercise-card">
          <div className="exercise-position">
            מעקב {trackedExercises(activeWorkout).indexOf(currentExercise) + 1} מתוך{' '}
            {trackedExercises(activeWorkout).length}
          </div>
          <h1>{currentExercise.name}</h1>
          <p className="english-name">{currentExercise.englishName}</p>

          <div className="set-dots" aria-label="סטים בתרגיל">
            {Array.from({ length: currentExercise.sets }, (_, index) => (
              <span
                key={index}
                className={index < currentExerciseSets.length ? 'done' : undefined}
              >
                {index < currentExerciseSets.length ? '✓' : index + 1}
              </span>
            ))}
          </div>

          <p className="target-line">
            סט {currentSetNumber}/{currentExercise.sets} · יעד {currentExercise.repMin}–
            {currentExercise.repMax} חזרות · {currentExercise.targetRir} RIR
          </p>
          <p className="previous-line">קודם: {priorSummary}</p>

          <div className="control-grid">
            <div className="number-control">
              <span className="control-label">
                משקל {currentExercise.perHand ? 'לכל יד' : ''}
              </span>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="הפחת משקל"
                  onClick={() =>
                    updateDraft({
                      weight: Math.max(
                        0,
                        Number((draftWeight - currentExercise.weightStep).toFixed(2)),
                      ),
                    })
                  }
                >
                  −
                </button>
                <label>
                  <input
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step={currentExercise.weightStep}
                    value={draftWeight || ''}
                    placeholder="הכנס"
                    onChange={(event) =>
                      updateDraft({ weight: Number(event.target.value) })
                    }
                  />
                  <small>ק״ג</small>
                </label>
                <button
                  type="button"
                  aria-label="הוסף משקל"
                  onClick={() =>
                    updateDraft({
                      weight: Number(
                        (draftWeight + currentExercise.weightStep).toFixed(2),
                      ),
                    })
                  }
                >
                  +
                </button>
              </div>
            </div>

            <div className="number-control">
              <span className="control-label">חזרות בפועל</span>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="הפחת חזרה"
                  onClick={() => updateDraft({ reps: Math.max(1, draftReps - 1) })}
                >
                  −
                </button>
                <label>
                  <input
                    inputMode="numeric"
                    type="number"
                    min="1"
                    value={draftReps}
                    onChange={(event) =>
                      updateDraft({ reps: Number(event.target.value) })
                    }
                  />
                  <small>חזרות</small>
                </label>
                <button
                  type="button"
                  aria-label="הוסף חזרה"
                  onClick={() => updateDraft({ reps: draftReps + 1 })}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <button
            className="rir-toggle"
            type="button"
            onClick={() => updateDraft({ rir: (draftRir + 1) % 4 })}
          >
            נשארו בפועל <strong>{draftRir} חזרות</strong> לפני כשל · לחץ לשינוי
          </button>

          <button
            className="complete-set-button"
            type="button"
            disabled={draftWeight <= 0 || draftReps <= 0}
            onClick={completeSet}
          >
            <span>סיימתי סט</span>
            <strong>
              <bdi>{draftWeight || '—'}</bdi> ק״ג × <bdi>{draftReps}</bdi>
            </strong>
          </button>
          {draftWeight <= 0 && (
            <p className="input-hint">צריך להזין משקל רק בפעם הראשונה.</p>
          )}
        </section>

        <div className="active-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={activeSetCount === 0}
            onClick={undoLastSet}
          >
            בטל סט אחרון
          </button>
          <span>{formatDuration(data.active.startedAt)}</span>
        </div>

        <details className="workout-outline">
          <summary>התרגילים שבמעקב</summary>
          {trackedExercises(activeWorkout).map((exercise) => {
            const completed = data.active?.sets.filter(
              (set) => set.exerciseId === exercise.id,
            ).length
            return (
              <div key={exercise.id}>
                <span>{exercise.name}</span>
                <strong>{completed}/{exercise.sets}</strong>
              </div>
            )
          })}
        </details>
      </main>
    )
  }

  const selectedPlan = WORKOUTS[selectedWorkout]

  return (
    <main className="app-shell" dir="rtl">
      <header className="home-header">
        <div>
          <span className="eyebrow">GYM LOG</span>
          <h1>האימון שלך</h1>
        </div>
        <span className="local-badge">
          {syncState === 'ready'
            ? 'נשמר בענן'
            : syncState === 'signed-out'
              ? 'לא מחובר'
              : syncState === 'error'
                ? 'נשמר במכשיר'
                : 'מסנכרן…'}
        </span>
      </header>

      {syncState === 'signed-out' && (
        <section className="error-banner" role="alert">
          <p>לא מחובר — האימונים נשמרים במכשיר הזה בלבד ולא מגובים.</p>
          <a className="signin-link" href="/">
            התחברות
          </a>
        </section>
      )}

      {storageError && (
        <section className="error-banner" role="alert">
          <p>{storageError}</p>
          {!persistenceEnabled && (
            <button type="button" onClick={resetCorruptedData}>
              התחל מחדש
            </button>
          )}
        </section>
      )}

      {notice && (
        <section className="success-banner" role="status">
          <span>✓</span>
          <p>{notice}</p>
          <button type="button" onClick={restoreLastCompletedSet}>
            בטל סט אחרון
          </button>
        </section>
      )}

      {tab === 'weight' ? (
        <>
          <WeightPanel
            today={today}
            weights={weights}
            saving={savingWeight}
            error={syncError}
            onSave={handleSaveWeight}
          />
          <WeightChart today={today} weights={weights} />
        </>
      ) : tab === 'workout' ? (
        <>
          {syncState === 'ready' && !weights.some((entry) => entry.measuredOn === today) && (
            <WeightPanel
              today={today}
              weights={weights}
              saving={savingWeight}
              error={syncError}
              onSave={handleSaveWeight}
            />
          )}
          <section className="next-workout-card">
            <div className="next-label">האימון הבא</div>
            <div className="workout-title-row">
              <div>
                <h2>{selectedPlan.label}</h2>
                <p>{selectedPlan.focus}</p>
              </div>
              <div className="workout-meta">
                <strong>{totalSets(selectedPlan)}</strong>
                <span>סטים במעקב</span>
              </div>
            </div>

            <div className="workout-picker" aria-label="בחירת אימון">
              {WORKOUT_ORDER.map((workoutId) => (
                <button
                  key={workoutId}
                  className={selectedWorkout === workoutId ? 'selected' : undefined}
                  type="button"
                  onClick={() => setSelectedWorkout(workoutId)}
                >
                  {workoutId}
                </button>
              ))}
            </div>

            <button className="start-button" type="button" onClick={startWorkout}>
              התחל {selectedPlan.label}
              <span>כל הנתונים הקודמים כבר בפנים</span>
            </button>
          </section>

          <section className="exercise-preview">
            <h3>מה מתעדים היום</h3>
            <p className="tracking-note">רק 3 תרגילים. סדר ומנוחות לפי ה־PDF; כאן רק מתעדים.</p>
            {trackedExercises(selectedPlan).map((exercise) => {
              const previous = getLastExerciseSets(data.sessions, exercise.id)
              const lastLoad = previous.at(-1)?.weight
              return (
                <div className="preview-row" key={exercise.id}>
                  <div>
                    <strong>{exercise.name}</strong>
                    <span>
                      {exercise.sets}×{exercise.repMin}–{exercise.repMax}
                    </span>
                  </div>
                  <span className="last-load">
                    {lastLoad ? `${lastLoad} ק״ג` : exercise.initialWeight ? `${exercise.initialWeight} ק״ג` : 'פעם ראשונה'}
                  </span>
                </div>
              )
            })}
          </section>

          {lastSession && (
            <section className="last-workout">
              <span>אימון אחרון</span>
              <strong>
                {WORKOUTS[lastSession.workoutId].label} · {formatDate(lastSession.completedAt)}
              </strong>
              <small>{formatDuration(lastSession.startedAt, lastSession.completedAt)}</small>
            </section>
          )}
        </>
      ) : (
        <section className="history-section">
          <div className="history-header">
            <div>
              <h2>היסטוריה</h2>
              <p>{data.sessions.length} אימונים נשמרו</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={data.sessions.length === 0}
              onClick={exportData}
            >
              ייצוא
            </button>
          </div>

          {data.sessions.length === 0 ? (
            <div className="empty-state">
              <strong>עוד אין אימונים</strong>
              <p>האימון הראשון יופיע כאן אוטומטית.</p>
            </div>
          ) : (
            [...data.sessions].reverse().map((session) => {
              const workout = WORKOUTS[session.workoutId]
              return (
                <details className="history-card" key={session.id}>
                  <summary>
                    <div>
                      <strong>{workout.label}</strong>
                      <span>{formatDate(session.completedAt)}</span>
                    </div>
                    <div className="history-meta">
                      <strong>{session.sets.length} סטים</strong>
                      <span>{formatDuration(session.startedAt, session.completedAt)}</span>
                    </div>
                  </summary>
                  <div className="history-details">
                    {trackedExercises(workout).map((exercise) => {
                      const sets = session.sets.filter(
                        (set) => set.exerciseId === exercise.id,
                      )
                      if (sets.length === 0) return null
                      return (
                        <div key={exercise.id}>
                          <strong>{getExerciseName(exercise.id)}</strong>
                          <span>
                            {sets.map((set) => `${set.weight}×${set.reps}`).join(' · ')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )
            })
          )}
        </section>
      )}

      <nav className="bottom-nav" aria-label="ניווט">
        <button
          className={tab === 'workout' ? 'active' : undefined}
          type="button"
          onClick={() => setTab('workout')}
        >
          <span>●</span>
          אימון
        </button>
        <button
          className={tab === 'weight' ? 'active' : undefined}
          type="button"
          onClick={() => setTab('weight')}
        >
          <span>◷</span>
          משקל
        </button>
        <button
          className={tab === 'history' ? 'active' : undefined}
          type="button"
          onClick={() => setTab('history')}
        >
          <span>≡</span>
          היסטוריה
        </button>
      </nav>
    </main>
  )
}

export default App
