import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { translateActive } from '../i18n';

export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface Reminder {
  id: number;
  title: string;
  body: string;
  /** UTC ISO timestamp. */
  scheduledFor: string;
  /** Israel-local `YYYY-MM-DDTHH:mm`, ready to prefill a datetime-local input. */
  scheduledForIsraelWallTime: string;
  status: ReminderStatus;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  recipient: { id: number; email: string; isSelf: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  title: string;
  body?: string;
  /** Israel wall-clock `YYYY-MM-DDTHH:mm` — never a pre-converted UTC value; the server is
   *  the authoritative converter/validator. */
  scheduledFor: string;
  recipientUserId: number;
}

export interface ReminderBatchInput extends Omit<ReminderInput, 'recipientUserId'> {
  recipientUserIds: number[];
}

export type ReminderLoadStatus = 'loading' | 'ready' | 'error';

/** Matches the server's own list ordering (see GET /api/reminders): actionable
 *  (pending/failed) reminders first, then everything else, each by scheduled time — so a
 *  locally-applied optimistic update never visibly reorders the list out of sync with what a
 *  full reload would show. */
function sortReminders(list: Reminder[]): Reminder[] {
  const rank = (r: Reminder) => (r.status === 'pending' || r.status === 'failed' ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.scheduledFor.localeCompare(b.scheduledFor));
}

/** Loads and mutates the current user's own *created* scheduled email reminders (never
 *  another creator's, and never ones merely addressed to this user by someone else). */
export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [loadStatus, setLoadStatus] = useState<ReminderLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Only the very first fetch should show the full-page "loading" state — later reloads (and
  // especially the local optimistic updates below) must never make the whole list vanish
  // behind a loading message, so any visible status badge on an in-flight mutation stays put.
  const hasDataRef = useRef(false);

  const reload = useCallback(async () => {
    if (!hasDataRef.current) {
      setLoadStatus('loading');
    }
    try {
      const data = await api.get<{ reminders: Reminder[] }>('/reminders');
      setReminders(data.reminders);
      hasDataRef.current = true;
      setLoadStatus('ready');
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.reminders'));
      setLoadStatus('error');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Applies the server's freshly-returned reminders directly into local state (insert or
   *  replace by id) instead of doing a full reload — no network round-trip, no loading flash,
   *  and the mutating control's own status badge remains visible throughout. */
  const upsertLocal = useCallback((updates: Reminder | Reminder[]) => {
    const incoming = Array.isArray(updates) ? updates : [updates];
    hasDataRef.current = true;
    setReminders((prev) => {
      const next = new Map((prev ?? []).map((reminder) => [reminder.id, reminder]));
      for (const reminder of incoming) next.set(reminder.id, reminder);
      return sortReminders([...next.values()]);
    });
    setLoadStatus('ready');
  }, []);

  const createReminder = useCallback(
    async (input: ReminderInput) => {
      const reminder = await api.post<Reminder>('/reminders', input);
      upsertLocal(reminder);
      return reminder;
    },
    [upsertLocal]
  );

  const createReminders = useCallback(
    async (input: ReminderBatchInput) => {
      const data = await api.post<{ reminders: Reminder[] }>('/reminders', input);
      upsertLocal(data.reminders);
      return data.reminders;
    },
    [upsertLocal]
  );

  const updateReminder = useCallback(
    async (id: number, patch: Partial<ReminderInput>) => {
      const reminder = await api.patch<Reminder>(`/reminders/${id}`, patch);
      upsertLocal(reminder);
      return reminder;
    },
    [upsertLocal]
  );

  const cancelReminder = useCallback(
    async (id: number) => {
      const reminder = await api.post<Reminder>(`/reminders/${id}/cancel`);
      upsertLocal(reminder);
      return reminder;
    },
    [upsertLocal]
  );

  return { reminders, loadStatus, loadError, reload, createReminder, createReminders, updateReminder, cancelReminder };
}
