-- Immutable in-database backups: one row per successfully completed Weekly Accountability
-- Meeting (WAM), each containing a deterministic, versioned, table-structured snapshot of
-- ALL users' safe application data at that moment (see server/src/lib/wamCompletionBackup.ts
-- for the exact allowlist, security exclusions, and construction logic).
--
-- This is a defense-in-depth safety net, not a replacement for real external backups (see
-- README) — it lives in the very same SQLite file it is protecting, so a lost/corrupted DB
-- file loses these snapshots along with everything else.
--
-- Table named exactly `backup` per spec. Rows are never updated or deleted by the app (no
-- API surface at all exists for this table — see server/src/lib/wamCompletionBackup.ts and
-- routes/wams.ts) and the schema enforces immutability at the data-integrity level:
--   - `triggering_wam_id` is a *plain* integer, deliberately NOT a foreign key. A backup is a
--     durable historical record that must survive even if the triggering WAM (or its
--     partnership) is later deleted, or if some future migration ever rebuilds the `wams`
--     table (SQLite's ALTER TABLE limitations have already required exactly that once, for
--     `wams` itself, in migration 003) and reassigns ids. A foreign key with ON DELETE
--     CASCADE or SET NULL would either delete this row or erase its linkage the moment that
--     happens; a bare integer plus the frozen scalar metadata below keeps the record intact
--     and self-describing regardless of what later happens to the `wams` table.
--   - `triggering_wam_week` and `wam_completed_at` are frozen, at backup-creation time,
--     directly from the just-completed WAM row — so this identifying/contextual metadata
--     remains readable even if the `wams` row itself is later deleted.
--   - UNIQUE(triggering_wam_id) enforces at most one backup per WAM (both NOT NULL now, so
--     this is a straightforward one-to-one constraint with no NULL-handling subtlety).
--   - snapshot_json is CHECK'd as valid JSON via the bundled JSON1 extension.
CREATE TABLE IF NOT EXISTS backup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggering_wam_id INTEGER NOT NULL,
  triggering_wam_week INTEGER NOT NULL,
  wam_completed_at TEXT NOT NULL,
  -- Version of the snapshot_json *shape* produced by buildAppDataSnapshot() at the time this
  -- row was written (BACKUP_SNAPSHOT_SCHEMA_VERSION) — lets any future restore/inspection
  -- tooling know how to interpret older rows if the shape ever changes.
  schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_triggering_wam ON backup(triggering_wam_id);
