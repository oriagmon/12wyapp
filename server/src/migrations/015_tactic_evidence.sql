-- Tactic evidence: an optional note, validated http(s) link, and/or a single small file
-- (image/PDF/DOCX/TXT) proving or complementing one completed tactic occurrence
-- (tactic_id, week, weekday). At most one evidence record per occurrence — re-saving the
-- same occurrence upserts the existing row rather than creating a second one.
--
-- File bytes deliberately live OUTSIDE this SQLite database, on disk under EVIDENCE_DIR (see
-- server/src/config.ts / server/src/lib/tacticEvidence.ts) — only file *metadata* is stored
-- here: the original filename (display/Content-Disposition only, never trusted as a path),
-- a random server-generated stored filename (the only thing ever used to locate the file on
-- disk), the sniffed (never client-declared) MIME type, and the byte size. `file_stored_name`
-- is intentionally excluded from the WAM completion backup snapshot (see
-- wamCompletionBackup.ts) since it's an operational on-disk implementation detail, not user
-- content — the note/link/original filename/mime/size are genuine user data and are included.
--
-- `tactic_id` cascades on tactic deletion (consistent with every other per-tactic table, e.g.
-- completions/tactic_week_overrides) — deleting a tactic removes its evidence rows too; the
-- application is responsible for also deleting the corresponding on-disk file(s) in the same
-- code path (see routes/tacticEvidence.ts and any tactic-delete route) since SQLite's own
-- CASCADE has no way to touch the filesystem.
--
-- The CHECK below is a defense-in-depth backstop (mirroring the application-layer validation
-- in lib/tacticEvidence.ts) against ever persisting a fully-empty row: a record must always
-- carry at least one of note/link/file. Emptying every field is only ever reachable by
-- deleting the whole row, never by an UPDATE that leaves it in this state.
CREATE TABLE IF NOT EXISTS tactic_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tactic_id INTEGER NOT NULL REFERENCES tactics(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week >= 1 AND week <= 12),
  weekday INTEGER NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
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

-- Backs "does this occurrence have evidence" lookups embedded into the weekly grid/list, and
-- the per-tactic/per-week gallery grouping.
CREATE INDEX IF NOT EXISTS idx_tactic_evidence_tactic_week ON tactic_evidence(tactic_id, week);
-- Backs the whole-cycle evidence gallery, which loads every evidence row for every tactic
-- belonging to a cycle in one pass (see routes/tacticEvidence.ts's GET /cycle/:cycleId).
CREATE INDEX IF NOT EXISTS idx_tactic_evidence_tactic ON tactic_evidence(tactic_id);
