-- BROOST ("Bro" + "Boost"): a short, supportive/playful message one partner sends the other.
-- The recipient gets an in-app notification/badge plus a branded email (best-effort — a
-- failed email never rolls back the in-app BROOST, which already exists the moment this row
-- is inserted).
--
-- Immutability: `sender_id`, `recipient_id`, `partnership_id`, `preset_key`, and `message`
-- are never updated by the application after insert (no route ever issues an UPDATE touching
-- them) — only `read_at` and the `email_*` delivery bookkeeping columns are ever mutated.
-- `message` is a fully rendered, immutable snapshot of the preset's copy (or the sender's
-- custom text) at send time, so a future edit to a preset's wording never rewrites history.
--
-- `partnership_id` is frozen at creation time (which partnership authorized this send) but
-- uses ON DELETE SET NULL, not CASCADE: if the partnership is later removed (the two users
-- unpair), the BROOST itself must remain — visible forever to the two original participants
-- — only its live partnership link is cleared. `sender_id`/`recipient_id` cascade on user
-- deletion (consistent with every other per-user table in this app); a deleted user's BROOSTs
-- disappear along with every other row of theirs.
CREATE TABLE IF NOT EXISTS partner_broosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partnership_id INTEGER REFERENCES partnerships(id) ON DELETE SET NULL,
  -- NULL for a fully custom message (no preset selected).
  preset_key TEXT,
  -- Rendered, immutable message snapshot — see the immutability note above.
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- NULL until the recipient marks it read; recipient-only to set (see routes/broosts.ts).
  read_at TEXT,
  -- Mirrors scheduled_email_reminders' delivery bookkeeping shape/semantics exactly (migration
  -- 010) — see lib/broosts.ts for the shared claim/retry/backoff worker logic reused by both
  -- the immediate post-insert send attempt and the periodic delivery worker.
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  email_attempt_count INTEGER NOT NULL DEFAULT 0,
  email_last_error TEXT,
  email_next_attempt_at TEXT,
  email_claimed_at TEXT,
  email_sent_at TEXT,
  CHECK (sender_id <> recipient_id)
);

-- Recipient's unread badge/notification count and recent-unread lookups.
CREATE INDEX IF NOT EXISTS idx_partner_broosts_recipient_unread ON partner_broosts(recipient_id, read_at);
-- Combined sent+received history for one user, newest first.
CREATE INDEX IF NOT EXISTS idx_partner_broosts_sender_history ON partner_broosts(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_partner_broosts_recipient_history ON partner_broosts(recipient_id, created_at);
-- Backs the anti-spam rolling-24h-count and 60s-cooldown checks for one sender/recipient pair.
CREATE INDEX IF NOT EXISTS idx_partner_broosts_sender_recipient_created ON partner_broosts(sender_id, recipient_id, created_at);
-- Backs the delivery worker's "find due" query.
CREATE INDEX IF NOT EXISTS idx_partner_broosts_email_due ON partner_broosts(email_next_attempt_at, email_status);
