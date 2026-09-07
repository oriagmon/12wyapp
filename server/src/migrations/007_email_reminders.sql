-- Tracks the weekly "did you schedule your WAM time?" reminder email sent to both members
-- of every active direct partnership. One row per (iso_week, recipient_user_id): the unique
-- index is what makes the reminder CLI idempotent across retries — a recipient already
-- recorded as 'sent' for a given ISO week is never re-sent, while a 'failed' row is retried
-- on the next invocation (see server/src/lib/wamReminders.ts).

CREATE TABLE IF NOT EXISTS wam_email_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_week TEXT NOT NULL, -- ISO-8601 week identifier, e.g. '2026-W36' (Asia/Jerusalem calendar date)
  partnership_id INTEGER NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (iso_week, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS idx_wam_email_reminders_week ON wam_email_reminders(iso_week);
CREATE INDEX IF NOT EXISTS idx_wam_email_reminders_partnership ON wam_email_reminders(partnership_id);
