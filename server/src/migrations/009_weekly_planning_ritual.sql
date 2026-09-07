CREATE TABLE IF NOT EXISTS weekly_planning_rituals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  target_week INTEGER NOT NULL CHECK (target_week BETWEEN 2 AND 12),
  worked_well TEXT NOT NULL DEFAULT '',
  improve_next TEXT NOT NULL DEFAULT '',
  tactics_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (tactics_reviewed IN (0, 1)),
  weekly_focus TEXT NOT NULL DEFAULT '',
  commitment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (cycle_id, target_week)
);

CREATE INDEX IF NOT EXISTS idx_weekly_planning_rituals_cycle
  ON weekly_planning_rituals(cycle_id);
