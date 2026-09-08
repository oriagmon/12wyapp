import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  MAX_ACTIVE_REMINDERS_PER_CREATOR,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  casCancelReminder,
  casUpdateReminder,
  countActiveReminders,
  resolveAllowedRecipient,
  serializeReminder,
  validateScheduledFor,
  type ScheduledEmailReminderRow,
} from '../lib/scheduledReminders.js';
import { tReq } from '../lib/i18n/index.js';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const createSchema = z.object({
  title: z.string().trim().min(1, 'errors.validation.reminderTitleEmpty').max(MAX_TITLE_LENGTH, 'errors.validation.reminderTitleTooLong'),
  body: z.string().trim().max(MAX_BODY_LENGTH, 'errors.validation.reminderBodyTooLong').optional(),
  // Israel wall-clock "YYYY-MM-DDTHH:mm" as produced by a datetime-local input — never a
  // pre-converted UTC value; the server is the sole authority converting/validating it.
  scheduledFor: z.string().min(1, 'errors.validation.scheduledForRequired'),
  recipientUserId: z.number().int().positive().optional(),
  recipientUserIds: z.array(z.number().int().positive()).min(1).max(2)
    .refine((ids) => new Set(ids).size === ids.length, 'errors.validation.duplicateRecipient')
    .optional(),
}).refine(
  (data) => (data.recipientUserId !== undefined) !== (data.recipientUserIds !== undefined),
  'errors.validation.exactlyOneRecipient'
);

const updateSchema = z.object({
  title: z.string().trim().min(1, 'errors.validation.reminderTitleEmpty').max(MAX_TITLE_LENGTH, 'errors.validation.reminderTitleTooLong').optional(),
  body: z.string().trim().max(MAX_BODY_LENGTH, 'errors.validation.reminderBodyTooLong').optional(),
  scheduledFor: z.string().min(1).optional(),
  recipientUserId: z.number().int().positive().optional(),
  recipientUserIds: z.never().optional(),
});

function loadOwnReminder(db: ReturnType<typeof getDb>, id: number, creatorUserId: number): ScheduledEmailReminderRow | undefined {
  return db
    .prepare('SELECT * FROM scheduled_email_reminders WHERE id = ? AND creator_user_id = ?')
    .get(id, creatorUserId) as ScheduledEmailReminderRow | undefined;
}

function recipientOf(db: ReturnType<typeof getDb>, userId: number): { id: number; email: string } {
  return db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as { id: number; email: string };
}

/** GET / — only reminders this user created (never another creator's, and never reminders
 *  merely addressed to this user by someone else — this API is creator-scoped only). Upcoming
 *  actionable reminders (pending/failed) surface first, then sent/cancelled ones. */
remindersRouter.get('/', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM scheduled_email_reminders
       WHERE creator_user_id = ?
       ORDER BY CASE WHEN status IN ('pending', 'failed') THEN 0 ELSE 1 END, scheduled_for ASC`
    )
    .all(req.user!.id) as ScheduledEmailReminderRow[];
  const reminders = rows.map((row) => serializeReminder(row, recipientOf(db, row.recipient_user_id)));
  res.json({ reminders });
});

remindersRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const creatorUserId = req.user!.id;
  const input = parsed.data;
  const recipientUserIds = input.recipientUserIds ?? [input.recipientUserId!];

  // Lock before checking recipients/capacity; either every recipient gets a separate row
  // or none do. Worker delivery and subsequent edits/cancellation remain per row.
  const result = db.transaction(() => {
    const recipients: { id: number; email: string }[] = [];
    for (const recipientUserId of recipientUserIds) {
      const recipient = resolveAllowedRecipient(db, creatorUserId, recipientUserId);
      if (!recipient) {
        return { ok: false, status: 400, error: 'api.reminders.recipientNotAllowed' } as const;
      }
      recipients.push(recipient);
    }

    if (countActiveReminders(db, creatorUserId) + recipients.length > MAX_ACTIVE_REMINDERS_PER_CREATOR) {
      return { ok: false, status: 429, error: 'api.reminders.tooManyActive' } as const;
    }

    const scheduled = validateScheduledFor(input.scheduledFor);
    if (!scheduled.ok) {
      return { ok: false, status: 400, error: scheduled.error } as const;
    }

    const insert = db.prepare(
      `INSERT INTO scheduled_email_reminders
         (creator_user_id, recipient_user_id, title, body, scheduled_for, status, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    );
    const reminders = recipients.map((recipient) => {
      const info = insert.run(creatorUserId, recipient.id, input.title, input.body ?? '', scheduled.iso, scheduled.iso);
      const row = db.prepare('SELECT * FROM scheduled_email_reminders WHERE id = ?').get(info.lastInsertRowid) as ScheduledEmailReminderRow;
      return serializeReminder(row, recipient);
    });
    return { ok: true, reminders } as const;
  }).immediate();

  if (!result.ok) {
    res.status(result.status).json({ error: tReq(req, result.error) });
    return;
  }
  res.status(201).json(input.recipientUserIds ? { reminders: result.reminders } : result.reminders[0]);
});

/** PATCH /:id — owner-only. Any edit is applied via an atomic compare-and-swap that only
 *  succeeds while the reminder is still `pending`/`failed` at the moment of the write itself
 *  (never `sent`/`sending`/`cancelled`) — this uniformly covers both the ordinary case (it was
 *  already resolved by the time of this request) and the narrower race where the delivery
 *  worker claims/sends the very same row between this handler reading it and writing to it,
 *  returning 409 Conflict either way rather than silently overwriting worker-owned state. A
 *  successful edit always resets the reminder to a fresh 'pending' state (clearing any prior
 *  failure/attempt history), acting as an explicit manual retry too. */
remindersRouter.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: tReq(req, 'api.reminders.invalidId') });
    return;
  }
  const existing = loadOwnReminder(db, id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: tReq(req, 'api.reminders.notFound') });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }

  const recipientUserId = parsed.data.recipientUserId ?? existing.recipient_user_id;
  const recipient = resolveAllowedRecipient(db, req.user!.id, recipientUserId);
  if (!recipient) {
    res.status(400).json({ error: tReq(req, 'api.reminders.recipientNotAllowed') });
    return;
  }

  const scheduledForWallTime = parsed.data.scheduledFor;
  const scheduled = scheduledForWallTime
    ? validateScheduledFor(scheduledForWallTime)
    : ({ ok: true, iso: existing.scheduled_for } as const);
  if (!scheduled.ok) {
    res.status(400).json({ error: tReq(req, scheduled.error) });
    return;
  }
  // Even an unchanged existing schedule must still be in the future to keep editing it.
  if (new Date(scheduled.iso).getTime() <= Date.now()) {
    res.status(400).json({ error: tReq(req, 'api.reminders.mustBeFuture') });
    return;
  }

  const title = parsed.data.title ?? existing.title;
  const body = parsed.data.body ?? existing.body;

  const casResult = casUpdateReminder(db, id, {
    title,
    body,
    scheduledFor: scheduled.iso,
    recipientUserId: recipient.id,
  });
  if (casResult === 'conflict') {
    res.status(409).json({
      error: tReq(req, 'api.reminders.updateConflict'),
    });
    return;
  }

  const row = db.prepare('SELECT * FROM scheduled_email_reminders WHERE id = ?').get(id) as ScheduledEmailReminderRow;
  res.json(serializeReminder(row, recipient));
});

/** POST /:id/cancel — owner-only. Same atomic compare-and-swap guarantee as PATCH above
 *  (only applies while still `pending`/`failed` at write time; 409 Conflict otherwise).
 *  Cancellation is terminal (no reopen) — creating a new reminder is the way back. */
remindersRouter.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: tReq(req, 'api.reminders.invalidId') });
    return;
  }
  const existing = loadOwnReminder(db, id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: tReq(req, 'api.reminders.notFound') });
    return;
  }

  const casResult = casCancelReminder(db, id);
  if (casResult === 'conflict') {
    res.status(409).json({
      error: tReq(req, 'api.reminders.cancelConflict'),
    });
    return;
  }

  const row = db.prepare('SELECT * FROM scheduled_email_reminders WHERE id = ?').get(id) as ScheduledEmailReminderRow;
  res.json(serializeReminder(row, recipientOf(db, row.recipient_user_id)));
});
