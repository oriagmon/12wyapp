/**
 * Talks to the gym API on the 12-week dashboard server.
 *
 * The tracker is served from that same origin, so the session cookie rides along on every
 * request automatically and there is no second login to manage. The trade-off is that a
 * signed-out visitor gets a 401 from every call, which `NotSignedInError` turns into
 * something the UI can show a "sign in" link for instead of a generic failure.
 */

export type WeightCondition = 'before' | 'after'

export type WeightEntry = {
  measuredOn: string
  kg: number
  /** Before or after the first trip to the bathroom, when it was recorded. */
  condition: WeightCondition | null
  recordedAt: string
}

export type RemoteState<T> = {
  data: T
  updatedAt: string | null
  weights: WeightEntry[]
  /**
   * Today according to the server. The tracker uses this rather than the device clock to
   * decide whether you have already weighed in, so a phone left on the wrong timezone
   * cannot log a reading against yesterday.
   */
  today: string
}

export class NotSignedInError extends Error {
  constructor() {
    super('not signed in')
    this.name = 'NotSignedInError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/gym${path}`, init)
  } catch {
    throw new Error('אין חיבור לשרת')
  }

  if (response.status === 401) throw new NotSignedInError()

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `הבקשה נכשלה (${response.status})`)
  }

  return (await response.json()) as T
}

function jsonBody(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

export function fetchState<T>(): Promise<RemoteState<T>> {
  return request<RemoteState<T>>('/state')
}

export function saveState<T extends { sessions: unknown[]; active: unknown }>(
  data: T,
): Promise<{ updatedAt: string }> {
  return request<{ updatedAt: string }>('/state', {
    ...jsonBody(data),
    method: 'PUT',
  })
}

export function saveWeight(
  measuredOn: string,
  kg: number,
  condition: WeightCondition | null,
): Promise<{ weights: WeightEntry[] }> {
  return request<{ weights: WeightEntry[] }>('/weights', jsonBody({ measuredOn, kg, condition }))
}

export function deleteWeight(measuredOn: string): Promise<{ weights: WeightEntry[] }> {
  return request<{ weights: WeightEntry[] }>(`/weights/${measuredOn}`, { method: 'DELETE' })
}
