-- "First to 50%" — when one partner is the first of the two to reach half of their current
-- week's plan, the other one gets an email saying so. A friendly nudge, not a scoreboard:
-- there is exactly one of these per partnership per week, and only the person who did NOT
-- get there first ever receives it.
--
-- ## The UNIQUE constraint is the race
--
-- `UNIQUE (partnership_id, week_key)` is not merely an integrity guard — it *is* the
-- first-past-the-post election. Both partners can cross 50% within the same millisecond on
-- two concurrent requests; SQLite lets exactly one of the two INSERTs succeed and rejects the
-- other, so "who was first" is decided atomically by the database rather than by a
-- check-then-write in application code, which could declare both of them the winner. There is
-- deliberately no separate "did anyone win yet?" query anywhere in the send path.
--
-- ## week_key
--
-- The Israel-local `YYYY-MM-DD` of the **Sunday** that starts the week (see
-- lib/israelTime.ts's `israelWeekStart`), NOT an ISO-8601 week: this app counts weekdays as
-- 0=Sunday..6=Saturday, so a Monday-anchored key would roll over a day late and let Sunday —
-- the first day of a fresh week of work — still be governed by last week's winner.
--
-- Being calendar-anchored also means the race resets on its own every Sunday, with no
-- dependence on either partner remembering to advance `cycles.current_week` by hand.
--
-- ## Immutability
--
-- Nothing but the `email_*` delivery bookkeeping columns is ever updated after insert. In
-- particular `score` and `phrase_variant` are frozen snapshots of the moment of crossing, so
-- a later untick, tactic edit, or adaptation can never rewrite history or change the wording
-- of an email that may already have been delivered.
--
-- `partnership_id` uses ON DELETE SET NULL rather than CASCADE, matching partner_broosts: if
-- the two ever unpair, the record of who got there first that week still happened.
CREATE TABLE IF NOT EXISTS week_milestone_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Nullable only so an unpairing can clear it (see above); always set at insert time.
  partnership_id INTEGER REFERENCES partnerships(id) ON DELETE SET NULL,
  -- The partner who got to the threshold first, and the one being told about it.
  achiever_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Israel-local Sunday `YYYY-MM-DD` starting the week this race belongs to.
  week_key TEXT NOT NULL,
  -- The achiever's own cycle week (1-12) at the moment of crossing, for the email's copy.
  cycle_week INTEGER NOT NULL,
  -- The achiever's week score (0-100) at the moment of crossing — frozen, see above.
  score INTEGER NOT NULL,
  -- Which of the rotating congratulation phrasings this email uses (0-based index into
  -- lib/weekMilestones.ts's PHRASE_VARIANT_COUNT). Chosen randomly once, at insert, and then
  -- frozen: a retry must never silently reword an email that may already have been sent.
  -- Stored as an index rather than rendered text so the copy is still written in the
  -- *recipient's* language at send time, and so fixing a typo in a phrasing doesn't require
  -- rewriting stored rows.
  phrase_variant INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Mirrors partner_broosts' delivery bookkeeping shape/semantics exactly (migration 014),
  -- which in turn mirrors scheduled_email_reminders (migration 010) — see
  -- lib/weekMilestones.ts for the claim/retry/backoff logic shared by the immediate
  -- post-insert send attempt and the periodic delivery worker.
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  email_attempt_count INTEGER NOT NULL DEFAULT 0,
  email_last_error TEXT,
  email_next_attempt_at TEXT,
  email_claimed_at TEXT,
  email_sent_at TEXT,
  -- One winner per partnership per week. This is the election itself — see the note above.
  UNIQUE (partnership_id, week_key),
  CHECK (achiever_id <> recipient_id),
  CHECK (score BETWEEN 0 AND 100),
  CHECK (cycle_week BETWEEN 1 AND 12)
);

-- Backs the delivery worker's "find due" query.
CREATE INDEX IF NOT EXISTS idx_week_milestone_emails_due
  ON week_milestone_emails(email_next_attempt_at, email_status);
-- Backs "has this week already been won?" reads for the in-app badge.
CREATE INDEX IF NOT EXISTS idx_week_milestone_emails_week
  ON week_milestone_emails(week_key, partnership_id);
