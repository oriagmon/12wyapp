-- Weekly Accountability Meetings (WAMs): exactly one shared meeting per accepted
-- partnership per week (1-12). Both partners can edit shared content; each has an
-- independent, self-only rating and a frozen score snapshot captured on completion.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wams (
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
  UNIQUE (partnership_id, week)
);
CREATE INDEX IF NOT EXISTS idx_wams_partnership ON wams(partnership_id);

-- One row per (wam, user): the user's own self-rating (1-10, self-editable only)
-- and their frozen weekly execution score snapshot (set only when the WAM is
-- completed; recomputed fresh — never derived from this table — while in draft).
CREATE TABLE IF NOT EXISTS wam_reviews (
  wam_id INTEGER NOT NULL REFERENCES wams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 10),
  score_snapshot INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (wam_id, user_id)
);

-- Commitments checklist for the upcoming week. `scope` labels who it belongs to:
-- 'a' = the partnership's initiator, 'b' = the invitee, 'shared' = both. Either
-- partner may create/edit/toggle any item regardless of its scope label.
CREATE TABLE IF NOT EXISTS wam_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wam_id INTEGER NOT NULL REFERENCES wams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('a', 'b', 'shared')),
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_wam_commitments_wam ON wam_commitments(wam_id);
