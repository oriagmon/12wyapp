-- Scheduled one-time email reminders. A user (the "creator") schedules an email to be sent
-- at a specific future moment to either themself or their current accepted partner.
--
-- This intentionally does NOT reference any column added by later migrations (e.g. 017's
-- users.display_name/bio/avatar_*) — only users(id), which has existed since 001_init.sql —
-- so this file is safe to apply either before 017 (on a brand-new database, where migrations
-- run in filename order: ...009, 010, 017, ...) or after 017 (on an already-upgraded database
-- that never had this feature yet — the migration runner applies any not-yet-recorded file
-- regardless of its position relative to already-applied ones).
CREATE TABLE IF NOT EXISTS scheduled_email_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- UTC ISO timestamp, always derived server-side from an explicit Israel wall-clock
  -- date+time at input (see server/src/lib/israelTime.ts) — never trusted pre-converted.
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  -- When this row next becomes eligible for the delivery worker to claim. Set to
  -- scheduled_for on creation/edit; advanced on a retryable failure (bounded exponential
  -- backoff); set to NULL once sent, cancelled, or permanently failed (max attempts reached)
  -- so it drops out of the worker's "due" query entirely.
  next_attempt_at TEXT,
  -- Lease timestamp set when a worker claims this row (status -> 'sending'). A row whose
  -- lease is older than the worker's stale-lease threshold is treated as claimable again,
  -- so a crashed/killed worker process can never leave a row stuck in 'sending' forever.
  claimed_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_reminders_creator
  ON scheduled_email_reminders(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_email_reminders_recipient
  ON scheduled_email_reminders(recipient_user_id);
-- The delivery worker's "find due reminders to claim" query filters/orders on these columns;
-- this composite index keeps that scan efficient regardless of table size.
CREATE INDEX IF NOT EXISTS idx_scheduled_email_reminders_due
  ON scheduled_email_reminders(next_attempt_at, status);
