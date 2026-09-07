-- Keep every legacy row/identifier/file reference unchanged. New album entries belong
-- directly to a cycle/week, not a tactic. NULL tactic ids allow multiple weekly items.
-- Retaining the table and file columns keeps existing file backups/cleanup compatible.
CREATE TABLE tactic_evidence_album (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tactic_id INTEGER REFERENCES tactics(id) ON DELETE CASCADE,
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 12),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN -1 AND 6),
  note TEXT,
  link TEXT,
  file_original_name TEXT,
  file_stored_name TEXT,
  file_mime TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tactic_id, week, weekday),
  CHECK (
    (tactic_id IS NOT NULL AND cycle_id IS NULL) OR
    (tactic_id IS NULL AND cycle_id IS NOT NULL AND weekday = -1)
  ),
  CHECK (note IS NOT NULL OR link IS NOT NULL OR file_stored_name IS NOT NULL)
);
INSERT INTO tactic_evidence_album
  (id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name,
   file_mime, file_size, created_at, updated_at)
SELECT id, tactic_id, week, weekday, note, link, file_original_name, file_stored_name,
       file_mime, file_size, created_at, updated_at
FROM tactic_evidence;
INSERT INTO sqlite_sequence (name, seq)
SELECT 'tactic_evidence_album', 0
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tactic_evidence_album');
UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tactic_evidence'), 0))
WHERE name = 'tactic_evidence_album';
DROP TABLE tactic_evidence;
ALTER TABLE tactic_evidence_album RENAME TO tactic_evidence;
CREATE INDEX idx_tactic_evidence_tactic_week ON tactic_evidence(tactic_id, week);
CREATE INDEX idx_tactic_evidence_tactic ON tactic_evidence(tactic_id);
CREATE INDEX idx_tactic_evidence_cycle_week ON tactic_evidence(cycle_id, week);
