import type { AsyncStatus } from '../hooks/useAsyncStatus';

/**
 * Tiny module-level pub/sub so the top status row can show a single global
 * "saving/saved/error" indicator that reflects the most recent mutation from
 * anywhere in the dashboard (goal rename, tactic edit, completion toggle,
 * cycle update, etc.) without threading state through every component.
 */
type Listener = (status: AsyncStatus, error: string | null) => void;

const listeners = new Set<Listener>();
let current: AsyncStatus = 'idle';
let currentError: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function publishSaveStatus(status: AsyncStatus, error: string | null = null): void {
  current = status;
  currentError = error;
  if (idleTimer) clearTimeout(idleTimer);
  if (status === 'saved') {
    idleTimer = setTimeout(() => publishSaveStatus('idle'), 1800);
  }
  listeners.forEach((l) => l(current, currentError));
}

export function subscribeSaveStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(current, currentError);
  return () => listeners.delete(listener);
}
