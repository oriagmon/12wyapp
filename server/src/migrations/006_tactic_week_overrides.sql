CREATE TABLE IF NOT EXISTS tactic_week_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tactic_id INTEGER NOT NULL REFERENCES tactics(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 12),
  title TEXT NOT NULL,
  weekdays TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tactic_id, week)
);

CREATE INDEX IF NOT EXISTS idx_tactic_week_overrides_tactic
  ON tactic_week_overrides(tactic_id);
