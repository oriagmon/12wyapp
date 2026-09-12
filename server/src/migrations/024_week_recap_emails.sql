-- The end-of-week scoreboard email.
--
-- Why this exists
-- ---------------
-- The weekly meeting is held on a Friday or Saturday morning, before the week is actually
-- finished, so at that moment nobody has hit their target yet and there is no satisfying
-- scoreboard to show. Migration 023 fixed the *recorded* score, but the celebration moment
-- was still landing at the wrong time. This email delivers it at the only point where the
-- numbers are genuinely settled: once the week is over.
--
-- What counts as "the week"
-- -------------------------
-- Two different clocks are involved and both matter:
--
--   * The *calendar* week decides WHEN to send. It is Israel-local Sunday..Saturday, matching
--     the 0=Sunday..6=Saturday weekday grid that tactics and completions use everywhere. The
--     recap goes out as soon as a calendar week closes.
--   * The *cycle* week decides WHAT to report. A cycle has no dates and `current_week` is
--     advanced by hand, so a cycle week is only finished once the owner has moved past it.
--     The table therefore reports weeks strictly below `cycles.current_week` and never the
--     one still in progress.
--
-- `week_key` is the Israel-local Sunday `YYYY-MM-DD` of the calendar week being recapped —
-- the one that just ended, not the one now starting. Being calendar-anchored means the send
-- self-resets every week with no dependence on anyone remembering to advance anything.
--
-- One row per person per week, not per partnership: each partner gets their own recap
-- addressed to them, and one of them being unpaired or inactive must not suppress the other's.
CREATE TABLE IF NOT EXISTS week_recap_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Who this recap is about and addressed to.
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Israel-local Sunday `YYYY-MM-DD` of the calendar week that just closed.
  week_key TEXT NOT NULL,
  -- The cycle this recap describes, so a recap is never silently re-attributed to a cycle
  -- started later. Nullable only so ending a cycle cannot delete delivery history.
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  -- The scoreboard, frozen at election time: a JSON array of { week, score } for every
  -- finished cycle week, plus the rounded average across them. Frozen rather than recomputed
  -- at send time for the same reason the phrasing is frozen below — a retry must never send a
  -- different scoreboard than the one this row was created to report.
  scores_json TEXT NOT NULL,
  average_score INTEGER NOT NULL,
  -- Highest finished cycle week included above; the headline week of this recap.
  latest_week INTEGER NOT NULL,
  -- Which of the rotating phrasings this email uses (0-based). Chosen once at insert and
  -- frozen, stored as an index so the copy is still rendered in the recipient's own language
  -- at send time and a typo fix never requires rewriting stored rows.
  phrase_variant INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Delivery bookkeeping, identical in shape and semantics to week_milestone_emails (022),
  -- partner_broosts (014) and scheduled_email_reminders (010). See lib/weekRecap.ts.
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  email_attempt_count INTEGER NOT NULL DEFAULT 0,
  email_last_error TEXT,
  email_next_attempt_at TEXT,
  email_claimed_at TEXT,
  email_sent_at TEXT,
  -- Send exactly one recap per person per calendar week. Like 022's election, this uniqueness
  -- constraint IS the guard: the worker inserts and lets the database reject a duplicate,
  -- rather than reading first and racing between the read and the write.
  UNIQUE (user_id, week_key),
  CHECK (average_score BETWEEN 0 AND 100),
  CHECK (latest_week BETWEEN 1 AND 12)
);

-- Backs the delivery worker's "find due" query.
CREATE INDEX IF NOT EXISTS idx_week_recap_emails_due
  ON week_recap_emails(email_next_attempt_at, email_status);
