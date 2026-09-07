-- V1 direct-pairing model: replaces the invitation/acceptance flow with immediate mutual
-- pairing between two already-registered, authenticated users (no email invite, no pending
-- state). Every partnership row that exists from here on is, by construction, an accepted
-- pairing between exactly two distinct users.
--
-- `invitee_email` and `status`/`responded_at` no longer have any meaning (there is nothing
-- to invite by email, and every row is implicitly "accepted") and are dropped. Existing
-- already-accepted (mutual) partnerships are preserved as-is; pending/unconfirmed
-- invitations have no equivalent in the new model and are not carried over (any WAMs that
-- only ever existed under a still-pending relationship are cleaned up via the existing
-- ON DELETE CASCADE from wams.partnership_id).

PRAGMA foreign_keys = OFF;

CREATE TABLE partnerships_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (initiator_id <> invitee_id)
);

INSERT INTO partnerships_new (id, initiator_id, invitee_id, created_at)
SELECT id, initiator_id, invitee_id, created_at
FROM partnerships
WHERE status = 'accepted' AND invitee_id IS NOT NULL;

-- Dropping the old table also drops its indexes (which shared these same names), so the
-- new indexes below must be created only after this point to avoid a name collision.
DROP TABLE partnerships;
ALTER TABLE partnerships_new RENAME TO partnerships;

-- Defense-in-depth against the exact same ordered pair being inserted twice. The "one
-- partner per user" and "no reversed-order duplicate" invariants are enforced by the
-- application inside a transaction (see routes/partnerships.ts), which is safe here since
-- better-sqlite3 is fully synchronous and Node serializes request handling.
CREATE UNIQUE INDEX idx_partnerships_pair ON partnerships(initiator_id, invitee_id);
CREATE INDEX idx_partnerships_initiator ON partnerships(initiator_id);
CREATE INDEX idx_partnerships_invitee ON partnerships(invitee_id);

PRAGMA foreign_keys = ON;
