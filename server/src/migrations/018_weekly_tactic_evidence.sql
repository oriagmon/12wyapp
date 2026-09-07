-- Weekly evidence occupies its own slot (-1); 0..6 remain untouched legacy daily slots.
-- runMigrations executes this whole copy/swap transactionally. No rows are merged, no
-- files are moved/deleted, and existing ids, timestamps and the autoincrement high-water
-- mark are retained. All existing file cleanup/backup queries still use the same table.
CREATE TABLE tactic_evidence_weekly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tactic_id INTEGER NOT NULL REFERENCES tactics(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week >= 1 AND week <= 12),
  weekday INTEGER NOT NULL CHECK (weekday >= -1 AND weekday <= 6),
  note TEXT,
  link TEXT,
  file_original_name TEXT,
  file_stored_name TEXT,
  file_mime TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tactic_id, week, weekday),
  CHECK (note IS NOT NULL OR link IS NOT NULL OR file_stored_name IS NOT NULL)
);

INSERT INTO tactic_evidence_weekly
  (id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name,
   file_mime, file_size, created_at, updated_at)
SELECT id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name,
       file_mime, file_size, created_at, updated_at
FROM tactic_evidence;

UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tactic_evidence'), 0))
WHERE name = 'tactic_evidence_weekly';

DROP TABLE tactic_evidence;
ALTER TABLE tactic_evidence_weekly RENAME TO tactic_evidence;
CREATE INDEX idx_tactic_evidence_tactic_week ON tactic_evidence(tactic_id, week);
CREATE INDEX idx_tactic_evidence_tactic ON tactic_evidence(tactic_id);
