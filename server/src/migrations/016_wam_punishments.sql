-- WAM Punishments: each partner may write a punishment for themself or the other partner
-- during a Weekly Accountability Meeting (the "source" WAM). A punishment is a durable,
-- normalized checklist item that becomes due in the *next* WAM ever created for the same
-- partnership after the source one — never a naive "week + 1" (see routes/wams.ts's WAM
-- creation handler for the exact ID-based binding logic; WAM ids are monotonic per
-- partnership and there is no WAM delete API, so creation order is a durable sequence).
--
-- `source_wam_id` is where the punishment was written and is immutable — cascades on the
-- source WAM's own deletion (a punishment can never outlive the meeting that created it).
-- `due_wam_id` is nullable (a brand-new punishment has no "next" WAM yet — it's bound the
-- moment one is created, or immediately if a later WAM already exists) and uses
-- ON DELETE SET NULL rather than CASCADE: if the specific WAM it was bound to is ever removed
-- (there is no such route today, but the schema is defensive regardless), the punishment
-- itself — and its full source history — must never be silently erased just because its
-- current due-meeting binding disappeared.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wam_punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_wam_id INTEGER NOT NULL REFERENCES wams(id) ON DELETE CASCADE,
  due_wam_id INTEGER REFERENCES wams(id) ON DELETE SET NULL,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Author/assignee may be the same user (self-assignment is an explicit product
  -- requirement) or the other partnership member (partner-assignment) — never constrained
  -- to differ. Application code (routes/wams.ts) is responsible for validating that both are
  -- actually members of the source WAM's own partnership; SQLite CHECK constraints cannot
  -- express a cross-table join, so this table alone cannot enforce that invariant.
  CHECK (length(trim(label)) > 0 AND length(label) <= 300),
  -- done=false must never carry a stale completed_at, and done=true must always have one —
  -- kept in lockstep at the application layer (see the due-punishment toggle route) and
  -- backstopped here.
  CHECK ((done = 0 AND completed_at IS NULL) OR (done = 1 AND completed_at IS NOT NULL)),
  -- WAM ids are AUTOINCREMENT (strictly monotonically increasing) and a punishment's "next
  -- WAM" is always found via `id > source_wam_id` (see routes/wams.ts) — so a bound due WAM
  -- can never legitimately be the same as, or earlier than, its own source. This backstops
  -- that invariant directly in the schema.
  CHECK (due_wam_id IS NULL OR due_wam_id > source_wam_id)
);

-- Backs "list every punishment authored in this WAM" (the source WAM's own Punishments
-- section).
CREATE INDEX IF NOT EXISTS idx_wam_punishments_source ON wam_punishments(source_wam_id);
-- Backs "list every punishment due in this WAM" (the next WAM's Due Punishments checklist).
CREATE INDEX IF NOT EXISTS idx_wam_punishments_due ON wam_punishments(due_wam_id);
-- Backs "which of my own items are still unbound, waiting for the next WAM to appear" and any
-- future per-user punishment views.
CREATE INDEX IF NOT EXISTS idx_wam_punishments_assigned ON wam_punishments(assigned_user_id);

-- `source_wam_id` must never change after insert — it is the punishment's whole identity
-- (which meeting it was written in). Application code never attempts this, but the trigger
-- backstops it directly against any future bug or ad-hoc script.
CREATE TRIGGER IF NOT EXISTS trg_wam_punishments_immutable_source
BEFORE UPDATE OF source_wam_id ON wam_punishments
FOR EACH ROW WHEN NEW.source_wam_id != OLD.source_wam_id
BEGIN
  SELECT RAISE(ABORT, 'wam_punishments.source_wam_id is immutable');
END;

-- Once bound to a due WAM, a punishment may only ever be *unbound* (due_wam_id -> NULL, e.g.
-- via the ON DELETE SET NULL foreign key action on the due WAM's own removal) — it must never
-- be silently re-pointed from one already-bound due WAM directly to a different one, which
-- would rewrite which meeting's checklist/history it belongs to. This condition only fires
-- when both the old and new values are non-null and different, so it never blocks the
-- legitimate NULL -> some-id first-time binding, nor the ON DELETE SET NULL unbinding path
-- (whose new value is NULL, not another non-null id).
CREATE TRIGGER IF NOT EXISTS trg_wam_punishments_due_wam_no_direct_reassign
BEFORE UPDATE OF due_wam_id ON wam_punishments
FOR EACH ROW WHEN OLD.due_wam_id IS NOT NULL AND NEW.due_wam_id IS NOT NULL AND NEW.due_wam_id != OLD.due_wam_id
BEGIN
  SELECT RAISE(ABORT, 'wam_punishments.due_wam_id cannot change directly from one due WAM to another');
END;
