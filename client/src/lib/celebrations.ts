export type SuccessKind = 'completion' | 'milestone' | 'broost' | 'wam';
import { translateActive } from '../i18n';

/** Emit only after the server confirms a meaningful mutation, never from a GET or render. */
export interface SuccessEvent {
  accountId: number;
  kind: SuccessKind;
  occurrenceId: string;
  owner: boolean;
  success: boolean;
  completed: boolean;
  firstStep?: boolean;
}

export interface CelebrationSession {
  seen: string[];
  count: number;
  lastAt: number | null;
}

export interface CelebrationChoice {
  title: string;
  detail: string;
  symbol: string;
  fireworks?: boolean;
}

export const CELEBRATION_COOLDOWN_MS = 90_000;
export const emptyCelebrationSession = (): CelebrationSession => ({ seen: [], count: 0, lastAt: null });
const MAX_SEEN = 512;
const SESSION_LIMIT = 4;
const listeners = new Set<(event: SuccessEvent) => void>();

export function publishSuccess(event: SuccessEvent) {
  for (const listener of listeners) listener(event);
}

export function subscribeSuccess(listener: (event: SuccessEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const celebration = (kind: string, symbol: string): CelebrationChoice => ({
  title: translateActive(`dashboard.celebration.${kind}Title`),
  detail: translateActive(`dashboard.celebration.${kind}Detail`),
  symbol,
});

export function selectCelebration(
  event: SuccessEvent,
  state: CelebrationSession,
  options: { accountId: number; now: number; random: number; visible: boolean },
): { state: CelebrationSession; choice: CelebrationChoice | null } {
  const unchanged = { state, choice: null };
  if (
    event.accountId !== options.accountId || !event.owner || !event.success || !event.completed ||
    !event.occurrenceId || event.occurrenceId.length > 160 ||
    !['completion', 'milestone', 'broost', 'wam'].includes(event.kind)
  ) return unchanged;

  // Deliberately independent of kind: a milestone and a completion for one save cannot replay it.
  const key = event.occurrenceId;
  if (state.seen.includes(key) || (state.seen.length >= MAX_SEEN && event.kind !== 'milestone')) return unchanged;
  const next = { ...state, seen: [...state.seen, key].slice(-MAX_SEEN) };
  if (!options.visible) return { state: next, choice: null };
  // Reaching 85% is guaranteed feedback, not one of the rate-limited surprise bonuses.
  if (event.kind === 'milestone') return {
    state: next,
    choice: {
      title: translateActive('dashboard.celebration.milestoneTitle'),
      detail: translateActive('dashboard.celebration.milestoneDetail'),
      symbol: '🏆',
      fireworks: true,
    },
  };
  if (
    state.count >= SESSION_LIMIT ||
    (state.lastAt !== null && options.now - state.lastAt < CELEBRATION_COOLDOWN_MS) ||
    !Number.isFinite(options.random) || options.random < 0 || options.random >= 0.16
  ) return { state: next, choice: null };

  const choice: CelebrationChoice = event.firstStep
    ? celebration('firstStep', '✦')
    : event.kind === 'broost'
        ? celebration('broost', '↗')
        : event.kind === 'wam'
          ? celebration('wam', '✦')
          : celebration('step', '✦');
  return { state: { ...next, lastAt: options.now, count: state.count + 1 }, choice };
}

const sessionKey = (accountId: number) => `12-week:celebrations:v1:${accountId}`;
const memorySessions = new Map<number, CelebrationSession>();

export function readCelebrationSession(accountId: number): CelebrationSession {
  if (memorySessions.has(accountId)) return memorySessions.get(accountId)!;
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(sessionKey(accountId)) ?? 'null');
    if (stored && typeof stored === 'object') {
      const value = stored as CelebrationSession;
      if (
        Array.isArray(value.seen) && value.seen.length <= MAX_SEEN &&
        value.seen.every((key) => typeof key === 'string' && key.length <= 160) &&
        Number.isInteger(value.count) && value.count >= 0 && value.count <= SESSION_LIMIT &&
        (value.lastAt === null || (typeof value.lastAt === 'number' && Number.isFinite(value.lastAt)))
      ) return value;
    }
  } catch { /* Storage can be unavailable in private browsing; the in-memory session still deduplicates. */ }
  return emptyCelebrationSession();
}

export function writeCelebrationSession(accountId: number, state: CelebrationSession) {
  memorySessions.set(accountId, state);
  try { sessionStorage.setItem(sessionKey(accountId), JSON.stringify(state)); } catch { /* Optional persistence. */ }
}
