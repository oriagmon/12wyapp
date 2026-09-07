-- V1 multi-cycle history support:
--   1. Cycles are never deleted on "reset" (see application code) — they're archived via
--      is_active=0 and remain forever as immutable, read-only history. No schema change is
--      needed for `cycles` itself; `current_week` naturally freezes once a cycle is archived
--      because only the active cycle can be mutated by the app.
--   2. Weekly Accountability Meetings (WAMs) must be tied to the specific cycle generation
--      each partner was on when the meeting was started, so that reviewing week N after
--      either partner has since reset their cycle doesn't collide with — or silently
--      reinterpret — an older meeting that used the same week number in a prior cycle.
--
-- SQLite can't ALTER an inline UNIQUE/table constraint, so we rebuild `wams` with the two
-- new nullable cycle-reference columns and the new (partnership_id, week, cycle refs)
-- uniqueness. Existing rows (from local development only, pre-V1) are preserved by id so
-- wam_reviews/wam_commitments foreign keys remain valid; their cycle references are set to
-- NULL since no historical linkage was recorded before this migration.

PRAGMA foreign_keys = OFF;

CREATE TABLE wams_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partnership_id INTEGER NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  wins TEXT NOT NULL DEFAULT '',
  misses TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  lessons_learned TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  adjustment_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  -- The specific cycle each partnership member had active when this meeting was started.
  -- Frozen forever at creation time so historical meetings keep reviewing the cycle that
  -- was actually current then, even after that cycle is later archived.
  initiator_cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  invitee_cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  UNIQUE (partnership_id, week, initiator_cycle_id, invitee_cycle_id)
);

INSERT INTO wams_new (
  id, partnership_id, week, status, wins, misses, blockers, lessons_learned, notes,
  adjustment_notes, created_at, updated_at, completed_at, initiator_cycle_id, invitee_cycle_id
)
SELECT
  id, partnership_id, week, status, wins, misses, blockers, lessons_learned, notes,
  adjustment_notes, created_at, updated_at, completed_at, NULL, NULL
FROM wams;

DROP TABLE wams;
ALTER TABLE wams_new RENAME TO wams;

CREATE INDEX IF NOT EXISTS idx_wams_partnership ON wams(partnership_id);

PRAGMA foreign_keys = ON;
