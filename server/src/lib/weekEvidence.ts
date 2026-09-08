import type Database from 'better-sqlite3';
import { z } from 'zod';
import { resolveAccess } from './access.js';
import { MAX_LINK_LENGTH, MAX_NOTE_LENGTH, serializeTacticEvidence, type TacticEvidenceRow } from './tacticEvidence.js';

export interface WeekEvidenceRow extends Omit<TacticEvidenceRow, 'tactic_id'> {
  tactic_id: number | null;
  cycle_id: number | null;
  resolved_cycle_id: number;
  tactic_title: string | null;
  goal_title: string | null;
}

export const weekEvidenceMetadata = z.object({
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional().transform((value) => value || null),
  link: z.string().trim().max(MAX_LINK_LENGTH).optional().transform((value) => value || null)
    .refine((value) => {
      if (value === null) return true;
      try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
    }, 'errors.validation.linkMustBeUrl'),
});

export function weekEvidenceAccess(db: Database.Database, viewerId: number, cycleId: number, write = false):
  | { ok: true; access: 'owner' | 'partner' }
  | { ok: false; status: 403 | 404; error: string } {
  const cycle = db.prepare('SELECT user_id FROM cycles WHERE id = ?').get(cycleId) as { user_id: number } | undefined;
  if (!cycle) return { ok: false, status: 404, error: 'api.weekEvidence.cycleNotFound' };
  const access = resolveAccess(db, viewerId, cycle.user_id);
  if (access === 'none' || (write && access !== 'owner')) {
    return { ok: false, status: 403, error: write ? 'api.weekEvidence.onlyOwnerCanEdit' : 'api.weekEvidence.forbidden' };
  }
  return { ok: true, access };
}

const albumSelect = `SELECT e.*, COALESCE(e.cycle_id, g.cycle_id) AS resolved_cycle_id,
  t.title AS tactic_title, g.title AS goal_title
  FROM tactic_evidence e
  LEFT JOIN tactics t ON t.id = e.tactic_id
  LEFT JOIN goals g ON g.id = t.goal_id
  WHERE (e.cycle_id = @cycleId OR (e.cycle_id IS NULL AND g.cycle_id = @cycleId))`;

export function listWeekEvidence(db: Database.Database, cycleId: number, week?: number): WeekEvidenceRow[] {
  return db.prepare(`${albumSelect}${week === undefined ? '' : ' AND e.week = @week'} ORDER BY e.week, e.id`)
    .all(week === undefined ? { cycleId } : { cycleId, week }) as WeekEvidenceRow[];
}

export function findWeekEvidence(db: Database.Database, cycleId: number, week: number, id: number): WeekEvidenceRow | undefined {
  return db.prepare(`${albumSelect} AND e.week = @week AND e.id = @id`).get({ cycleId, week, id }) as WeekEvidenceRow | undefined;
}

export function serializeWeekEvidence(row: WeekEvidenceRow) {
  return {
    ...serializeTacticEvidence(row),
    id: row.id,
    cycleId: row.resolved_cycle_id,
    scope: row.tactic_id === null ? 'week' : row.weekday === -1 ? 'tactic-week' : 'tactic-day',
    tacticTitle: row.tactic_title,
    goalTitle: row.goal_title,
  };
}

export function createWeekEvidence(
  db: Database.Database, cycleId: number, week: number,
  input: { note?: string | null; link?: string | null; fileOriginalName?: string | null; fileStoredName?: string; fileMime?: string; fileSize?: number },
): WeekEvidenceRow {
  const result = db.prepare(`INSERT INTO tactic_evidence
    (cycle_id, week, weekday, note, link, file_original_name, file_stored_name, file_mime, file_size)
    VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?)`).run(
    cycleId, week, input.note ?? null, input.link ?? null, input.fileOriginalName ?? null,
    input.fileStoredName ?? null, input.fileMime ?? null, input.fileSize ?? null,
  );
  return findWeekEvidence(db, cycleId, week, Number(result.lastInsertRowid))!;
}

export function updateWeekEvidenceMetadata(db: Database.Database, row: WeekEvidenceRow, input: { note: string | null; link: string | null }): void {
  db.prepare(`UPDATE tactic_evidence SET note = ?, link = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(input.note, input.link, row.id);
}

/** The caller has scoped this row and checked owner access; only its file is detached. */
export function removeWeekEvidence(db: Database.Database, row: WeekEvidenceRow, fileOnly = false): string | null {
  if (!fileOnly || (row.note === null && row.link === null)) {
    db.prepare('DELETE FROM tactic_evidence WHERE id = ?').run(row.id);
  } else {
    db.prepare(`UPDATE tactic_evidence SET file_original_name = NULL, file_stored_name = NULL,
      file_mime = NULL, file_size = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(row.id);
  }
  return row.file_stored_name;
}
