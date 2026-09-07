-- Optional "next WAM" calendar scheduling. When completing a non-historical draft WAM, the
-- user may pick a future date/time for the *next* WAM; if they do, we send both partners a
-- real RFC 5545 calendar invitation (METHOD:REQUEST) via Azure Communication Services Email.
--
-- next_wam_at / next_wam_duration_minutes hold the currently scheduled next-meeting time (both
-- NULL if none is scheduled). calendar_event_uid is generated once, the first time a WAM is
-- ever scheduled, and never changes afterwards — it is what lets calendar clients recognize a
-- later invite as an *update* to the same event rather than a new one. calendar_event_sequence
-- starts at 0 and is incremented only when an already-scheduled time/duration is changed,
-- mirroring iCalendar SEQUENCE semantics.
ALTER TABLE wams ADD COLUMN next_wam_at TEXT;
ALTER TABLE wams ADD COLUMN next_wam_duration_minutes INTEGER;
ALTER TABLE wams ADD COLUMN calendar_event_uid TEXT;
ALTER TABLE wams ADD COLUMN calendar_event_sequence INTEGER NOT NULL DEFAULT 0;

-- One row per (wam, recipient): the delivery outcome for the *current* calendar_event_sequence
-- of that WAM. The PRIMARY KEY (not including event_sequence) means a later attempt for a new
-- sequence overwrites the row for that recipient — callers must always compare the stored
-- event_sequence against the WAM's current calendar_event_sequence before trusting `status`,
-- exactly like wam_email_reminders' UNIQUE(iso_week, recipient_user_id) idempotency key (see
-- server/src/lib/wamReminders.ts) but scoped by event generation instead of calendar week.
CREATE TABLE IF NOT EXISTS wam_calendar_invitations (
  wam_id INTEGER NOT NULL REFERENCES wams(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (wam_id, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS idx_wam_calendar_invitations_wam ON wam_calendar_invitations(wam_id);
