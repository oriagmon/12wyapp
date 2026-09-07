import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * Immutable in-database backup snapshots (see migration 012_wam_completion_backups.sql and
 * routes/wams.ts's POST /:id/complete). This module owns the *only* place in the codebase
 * that decides exactly which tables/columns are safe to include in a full-app-data snapshot.
 *
 * ## The allowlist is explicit and audited — never `SELECT *`, never "every table"
 *
 * `SNAPSHOT_TABLES` below is a hand-maintained, explicit list. A snapshot is built by running
 * exactly the SQL each entry specifies — nothing more. This is deliberate: a blanket
 * `sqlite_master`-driven "snapshot every table" approach would silently start including any
 * future table (and any future *sensitive* column added to an existing table) the moment it's
 * created, with no review step. Instead:
 *
 *   **Every future migration that adds a new table or column containing user application data
 *   MUST add/update an entry in `SNAPSHOT_TABLES` below in the same change**, consciously
 *   deciding what's safe to include (and how, e.g. redacting free-text error columns to a
 *   boolean presence flag). Forgetting this is a silent, permanent gap in the safety net, not
 *   a runtime error — there is no way to detect "a table exists that this file doesn't know
 *   about" without maintaining a second list of intentional exclusions, which would be just
 *   as easy to forget to update. The loud-failure guard below only catches the *opposite*
 *   mistake (an allowlisted table unexpectedly missing), not this one.
 *
 * ## What's covered as of migration 016 (WAM punishments)
 *
 * Included, one entry per table below: `users` (profile-safe fields only, migration 017),
 * `user_settings`, `partnerships`, `cycles`, `goals`, `tactics`, `tactic_week_overrides`,
 * `completions`, `wams`, `wam_reviews`, `wam_commitments`, `wam_email_reminders` (007),
 * `wam_calendar_invitations` (008), `weekly_planning_rituals` (009), `scheduled_email_reminders`
 * (010), `execution_recovery_plans` (013 — added after migration 012 shipped this backup
 * table itself, hence BACKUP_SNAPSHOT_SCHEMA_VERSION bumping to 2; nothing on it is
 * error-like/secret, so every column is included as-is), `partner_broosts` (014 — bumps
 * BACKUP_SNAPSHOT_SCHEMA_VERSION again to 3; the rendered message snapshot is genuine user
 * app data and is included in full, only the raw email delivery error text is redacted to a
 * boolean, exactly like every other delivery-status table here), `tactic_evidence` (015 —
 * bumps BACKUP_SNAPSHOT_SCHEMA_VERSION again to 4; the note/link/original filename/mime/size
 * are genuine user app data and are included in full — `file_stored_name`, the random
 * on-disk filename, is excluded as an operational implementation detail, and the file's raw
 * bytes are never in SQLite at all, so there was never anything to snapshot there),
 * `wam_punishments` (016 — bumps BACKUP_SNAPSHOT_SCHEMA_VERSION again to 5; every column is
 * genuine user application data — the punishment's label, its author/assignee/due-binding,
 * and its done/completed_at history — and is included in full, exactly like
 * `wam_commitments`).
 *
 * Explicitly EXCLUDED, and why:
 *   - `sessions` — session tokens are bearer credentials; never persisted anywhere else either.
 *   - `password_reset_tokens` (011) — even though only a SHA-256 hash is stored, it's still a
 *     security-sensitive credential-adjacent table with no legitimate restore/audit use here.
 *   - `backup` (this table, 012) — recursively snapshotting backups would let every snapshot
 *     grow to contain every prior one; explicitly out of scope.
 *   - `schema_migrations` and any SQLite-internal table (`sqlite_*`) — migration bookkeeping,
 *     not application data.
 *   - `users.password_hash` — never included, even hashed.
 *   - `users.avatar_data` (017) — raw image bytes are never included; only safe metadata
 *     (`avatar_mime`, `avatar_version`, and a computed `hasAvatar` boolean) is kept.
 *   - Any `error`/`last_error` free-text column (`wam_email_reminders.error`,
 *     `wam_calendar_invitations.error`, `scheduled_email_reminders.last_error`) — these can
 *     contain raw provider/internal error text, so only a computed boolean presence flag
 *     (`hasError`) is kept; status/timestamps are otherwise included in full.
 *   - `tactic_evidence.file_stored_name` (015) — the random on-disk filename is an
 *     operational detail (where a file happens to live on disk right now), not user content;
 *     a computed `hasFile` boolean is kept instead. The evidence file's actual bytes live
 *     entirely outside SQLite (see config.ts's `EVIDENCE_DIR`) and are never part of any
 *     snapshot regardless.
 *
 * ## Schema-drift enforcement (catches *future* new tables/columns automatically)
 *
 * The paragraph above only helps a human remember to update this file — it does nothing to
 * stop a future migration from silently shipping without that update. `auditSnapshotSchema()`
 * closes that gap at runtime (called on every `buildAppDataSnapshot()`, i.e. on every WAM
 * completion, and directly in tests): it inspects `sqlite_master` and `PRAGMA table_info(...)`
 * for the live database and throws loudly if:
 *   - any real (non `sqlite_*`-internal) table exists that is neither in `SNAPSHOT_TABLES`
 *     (allowlisted) nor in `INTENTIONALLY_EXCLUDED_TABLES` below — this is what catches a
 *     brand-new table (e.g. a future migration's table) that nobody has reviewed yet;
 *   - any allowlisted table has a column that is neither directly selected by one of its
 *     `columns` entries nor listed in that entry's `excludedColumns` — this is what catches a
 *     new column on an *existing* table (e.g. a hypothetical `users.phone`) that nobody has
 *     consciously included or excluded yet;
 *   - an allowlisted table is missing entirely (e.g. a partial/out-of-order migration state).
 *
 * A snapshot is never produced in any of these situations — better an outright failure (and a
 * loud server log) than a silently incomplete or silently-leaking backup.
 */
export const BACKUP_SNAPSHOT_SCHEMA_VERSION = 7;

/** Tables that are real (non-`sqlite_*`-internal) but deliberately never part of a snapshot —
 *  see the module doc comment above for why each one is excluded. `auditSnapshotSchema()`
 *  treats any other unlisted, non-allowlisted table as an unreviewed schema-drift error. */
export const INTENTIONALLY_EXCLUDED_TABLES = new Set<string>([
  'sessions',
  'password_reset_tokens',
  'backup',
  'schema_migrations',
]);

function isSqliteInternalTable(name: string): boolean {
  return name.startsWith('sqlite_');
}

interface SnapshotColumn {
  /** Key this value appears under in the output JSON for this table. */
  as: string;
  /** SQL expression selected for this column — usually just the raw column name, but may be
   *  a safe computed expression (e.g. `avatar_mime IS NOT NULL`) when the underlying raw
   *  value must never appear in the snapshot at all. */
  expr: string;
}

interface SnapshotTableSpec {
  table: string;
  /** ORDER BY clause (primary key, or composite key for tables without a single-column PK)
   *  — every snapshot of the same data must serialize identically, so row order can never be
   *  left to SQLite's unspecified default. */
  orderBy: string;
  columns: SnapshotColumn[];
  /** Raw column names on this table that are consciously never included (directly or via a
   *  computed expression) — e.g. a secret, a raw BLOB, or free-text error detail. Any column
   *  reported by `PRAGMA table_info` for this table that is neither one of `columns[].expr`
   *  (an exact, directly-selected column name) nor listed here is treated as unreviewed
   *  schema drift by `auditSnapshotSchema()` and fails the build loudly. */
  excludedColumns?: string[];
}

const SNAPSHOT_TABLES: SnapshotTableSpec[] = [
  {
    table: 'users',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'email', expr: 'email' },
      { as: 'displayName', expr: 'display_name' },
      { as: 'bio', expr: 'bio' },
      { as: 'hasAvatar', expr: 'avatar_mime IS NOT NULL' },
      { as: 'avatarMime', expr: 'avatar_mime' },
      { as: 'avatarVersion', expr: 'avatar_version' },
      { as: 'locale', expr: 'locale' },
      { as: 'createdAt', expr: 'created_at' },
    ],
    // password_hash (secret), avatar_data (raw bytes) — never selected, directly or computed.
    excludedColumns: ['password_hash', 'avatar_data'],
  },
  {
    table: 'user_settings',
    orderBy: 'user_id',
    columns: [
      { as: 'userId', expr: 'user_id' },
      { as: 'theme', expr: 'theme' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'partnerships',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'initiatorId', expr: 'initiator_id' },
      { as: 'inviteeId', expr: 'invitee_id' },
      { as: 'createdAt', expr: 'created_at' },
    ],
  },
  {
    table: 'cycles',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'userId', expr: 'user_id' },
      { as: 'name', expr: 'name' },
      { as: 'currentWeek', expr: 'current_week' },
      { as: 'isActive', expr: 'is_active' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
      { as: 'vision', expr: 'vision' },
      { as: 'successDefinition', expr: 'success_definition' },
      { as: 'whyItMatters', expr: 'why_it_matters' },
      { as: 'blockers', expr: 'blockers' },
      { as: 'risks', expr: 'risks' },
      { as: 'lagMeasures', expr: 'lag_measures' },
      { as: 'leadMeasures', expr: 'lead_measures' },
      { as: 'notes', expr: 'notes' },
    ],
  },
  {
    table: 'goals',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'cycleId', expr: 'cycle_id' },
      { as: 'title', expr: 'title' },
      { as: 'color', expr: 'color' },
      { as: 'sortOrder', expr: 'sort_order' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'tactics',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'goalId', expr: 'goal_id' },
      { as: 'title', expr: 'title' },
      { as: 'weekdays', expr: 'weekdays' },
      { as: 'startWeek', expr: 'start_week' },
      { as: 'endWeek', expr: 'end_week' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'tactic_week_overrides',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'tacticId', expr: 'tactic_id' },
      { as: 'week', expr: 'week' },
      { as: 'title', expr: 'title' },
      { as: 'weekdays', expr: 'weekdays' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'completions',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'tacticId', expr: 'tactic_id' },
      { as: 'week', expr: 'week' },
      { as: 'weekday', expr: 'weekday' },
      { as: 'done', expr: 'done' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'wams',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'partnershipId', expr: 'partnership_id' },
      { as: 'week', expr: 'week' },
      { as: 'status', expr: 'status' },
      { as: 'wins', expr: 'wins' },
      { as: 'misses', expr: 'misses' },
      { as: 'blockers', expr: 'blockers' },
      { as: 'lessonsLearned', expr: 'lessons_learned' },
      { as: 'notes', expr: 'notes' },
      { as: 'adjustmentNotes', expr: 'adjustment_notes' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
      { as: 'completedAt', expr: 'completed_at' },
      { as: 'initiatorCycleId', expr: 'initiator_cycle_id' },
      { as: 'inviteeCycleId', expr: 'invitee_cycle_id' },
      { as: 'nextWamAt', expr: 'next_wam_at' },
      { as: 'nextWamDurationMinutes', expr: 'next_wam_duration_minutes' },
      { as: 'calendarEventUid', expr: 'calendar_event_uid' },
      { as: 'calendarEventSequence', expr: 'calendar_event_sequence' },
    ],
  },
  {
    table: 'wam_reviews',
    orderBy: 'wam_id, user_id',
    columns: [
      { as: 'wamId', expr: 'wam_id' },
      { as: 'userId', expr: 'user_id' },
      { as: 'rating', expr: 'rating' },
      { as: 'scoreSnapshot', expr: 'score_snapshot' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'wam_commitments',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'wamId', expr: 'wam_id' },
      { as: 'scope', expr: 'scope' },
      { as: 'label', expr: 'label' },
      { as: 'done', expr: 'done' },
      { as: 'sortOrder', expr: 'sort_order' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'wam_email_reminders',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'isoWeek', expr: 'iso_week' },
      { as: 'partnershipId', expr: 'partnership_id' },
      { as: 'recipientUserId', expr: 'recipient_user_id' },
      { as: 'status', expr: 'status' },
      { as: 'hasError', expr: 'error IS NOT NULL' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
    // error may contain raw provider/internal error text — never selected, directly or
    // computed (only its boolean presence, hasError, is included above).
    excludedColumns: ['error'],
  },
  {
    table: 'wam_calendar_invitations',
    orderBy: 'wam_id, recipient_user_id',
    columns: [
      { as: 'wamId', expr: 'wam_id' },
      { as: 'recipientUserId', expr: 'recipient_user_id' },
      { as: 'eventSequence', expr: 'event_sequence' },
      { as: 'status', expr: 'status' },
      { as: 'hasError', expr: 'error IS NOT NULL' },
      { as: 'sentAt', expr: 'sent_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
    excludedColumns: ['error'],
  },
  {
    table: 'weekly_planning_rituals',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'cycleId', expr: 'cycle_id' },
      { as: 'targetWeek', expr: 'target_week' },
      { as: 'workedWell', expr: 'worked_well' },
      { as: 'improveNext', expr: 'improve_next' },
      { as: 'tacticsReviewed', expr: 'tactics_reviewed' },
      { as: 'weeklyFocus', expr: 'weekly_focus' },
      { as: 'commitment', expr: 'commitment' },
      { as: 'status', expr: 'status' },
      { as: 'completedAt', expr: 'completed_at' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
  },
  {
    table: 'scheduled_email_reminders',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'creatorUserId', expr: 'creator_user_id' },
      { as: 'recipientUserId', expr: 'recipient_user_id' },
      { as: 'title', expr: 'title' },
      { as: 'body', expr: 'body' },
      { as: 'scheduledFor', expr: 'scheduled_for' },
      { as: 'status', expr: 'status' },
      { as: 'attemptCount', expr: 'attempt_count' },
      { as: 'hasError', expr: 'last_error IS NOT NULL' },
      { as: 'nextAttemptAt', expr: 'next_attempt_at' },
      { as: 'claimedAt', expr: 'claimed_at' },
      { as: 'sentAt', expr: 'sent_at' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
    excludedColumns: ['last_error'],
  },
  {
    table: 'execution_recovery_plans',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'cycleId', expr: 'cycle_id' },
      { as: 'week', expr: 'week' },
      { as: 'strategy', expr: 'strategy' },
      { as: 'note', expr: 'note' },
      { as: 'status', expr: 'status' },
      { as: 'adjustmentJson', expr: 'adjustment_json' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
      { as: 'resolvedAt', expr: 'resolved_at' },
    ],
    // Nothing on this table is error-like/secret — the owner's own free-text note and the
    // structured before/after tactic-reduction snapshot are both included in full.
  },
  {
    table: 'partner_broosts',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'senderId', expr: 'sender_id' },
      { as: 'recipientId', expr: 'recipient_id' },
      { as: 'partnershipId', expr: 'partnership_id' },
      { as: 'presetKey', expr: 'preset_key' },
      { as: 'message', expr: 'message' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'readAt', expr: 'read_at' },
      { as: 'emailStatus', expr: 'email_status' },
      { as: 'emailAttemptCount', expr: 'email_attempt_count' },
      { as: 'hasEmailError', expr: 'email_last_error IS NOT NULL' },
      { as: 'emailNextAttemptAt', expr: 'email_next_attempt_at' },
      { as: 'emailClaimedAt', expr: 'email_claimed_at' },
      { as: 'emailSentAt', expr: 'email_sent_at' },
    ],
    // The rendered message snapshot is included in full — it's user application data (the
    // whole point of this feature), not a secret. Only email_last_error is redacted (may
    // contain raw provider/internal error text) to a boolean hasEmailError, exactly like every
    // other delivery-status table in this allowlist.
    excludedColumns: ['email_last_error'],
  },
  {
    table: 'tactic_evidence',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'tacticId', expr: 'tactic_id' },
      { as: 'cycleId', expr: 'cycle_id' },
      { as: 'week', expr: 'week' },
      { as: 'weekday', expr: 'weekday' },
      { as: 'note', expr: 'note' },
      { as: 'link', expr: 'link' },
      { as: 'fileOriginalName', expr: 'file_original_name' },
      { as: 'fileMime', expr: 'file_mime' },
      { as: 'fileSize', expr: 'file_size' },
      { as: 'hasFile', expr: 'file_stored_name IS NOT NULL' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
    // note/link/original filename/mime/size are genuine user application data and are
    // included in full. file_stored_name (the random on-disk filename) is deliberately
    // redacted to a computed hasFile boolean — it's an operational implementation detail
    // (where a file happens to live on disk right now), not user content, and the file's
    // actual bytes are never in SQLite at all (see config.ts's EVIDENCE_DIR), so there was
    // never anything to snapshot there regardless.
    excludedColumns: ['file_stored_name'],
  },
  {
    table: 'wam_punishments',
    orderBy: 'id',
    columns: [
      { as: 'id', expr: 'id' },
      { as: 'sourceWamId', expr: 'source_wam_id' },
      { as: 'dueWamId', expr: 'due_wam_id' },
      { as: 'authorUserId', expr: 'author_user_id' },
      { as: 'assignedUserId', expr: 'assigned_user_id' },
      { as: 'label', expr: 'label' },
      { as: 'done', expr: 'done' },
      { as: 'completedAt', expr: 'completed_at' },
      { as: 'createdAt', expr: 'created_at' },
      { as: 'updatedAt', expr: 'updated_at' },
    ],
    // Nothing on this table is error-like/secret — the punishment's own free-text label and
    // its full author/assignee/due-binding/done history are all genuine user application
    // data and are included in full, exactly like wam_commitments.
  },
  // password_reset_tokens (011) and sessions (001) are intentionally never listed here — see
  // INTENTIONALLY_EXCLUDED_TABLES and the module doc comment above.
];

export interface AppDataSnapshot {
  schemaVersion: number;
  generatedAt: string;
  /** A stable identifier derived purely from the *shape* of `SNAPSHOT_TABLES` (table names +
   *  ordered output column keys per table) — never from actual row data. Any change to the
   *  allowlist (a table or column added/removed/renamed) changes this value, giving an
   *  objective, mechanical way to detect "the snapshot shape changed" independent of whether
   *  `schemaVersion` was remembered to be bumped. See `computeSnapshotShapeId()` /
   *  `describeSnapshotShape()` and the golden test pinning both in the test suite. */
  shapeId: string;
  /** Every migration filename recorded as applied at snapshot time, sorted for determinism
   *  (the underlying read order from `schema_migrations` is not itself guaranteed). This is
   *  metadata *about* the snapshot, not application data — it is never one of the `tables`
   *  entries below, and `schema_migrations` itself is one of the INTENTIONALLY_EXCLUDED_TABLES. */
  appliedMigrations: string[];
  tables: Record<string, unknown[]>;
}

/** The exact table/column shape `buildAppDataSnapshot()` currently produces — table names and
 *  their ordered output keys, with no data involved — used both to compute `shapeId` and as
 *  the literal structure a golden test pins so any future allowlist change requires touching
 *  that test (and, deliberately, thinking about whether BACKUP_SNAPSHOT_SCHEMA_VERSION should
 *  bump too). */
export function describeSnapshotShape(): { table: string; columns: string[] }[] {
  return SNAPSHOT_TABLES.map((spec) => ({ table: spec.table, columns: spec.columns.map((c) => c.as) }));
}

/** SHA-256 (hex) of the canonical JSON of `describeSnapshotShape()` — a compact, mechanical
 *  fingerprint of the snapshot shape suitable for storing/comparing without needing the full
 *  descriptor. Purely a function of `SNAPSHOT_TABLES`, never of database content. */
export function computeSnapshotShapeId(): string {
  return crypto.createHash('sha256').update(JSON.stringify(describeSnapshotShape())).digest('hex');
}

/**
 * Schema-drift enforcement — see the module doc comment's "Schema-drift enforcement" section
 * for the full rationale. Throws loudly (never returns an error value) the moment any of the
 * following is detected against the live database:
 *   1. An allowlisted table is missing entirely.
 *   2. A real, non-`sqlite_*`-internal table exists that is neither allowlisted nor in
 *      `INTENTIONALLY_EXCLUDED_TABLES` (an unreviewed new table).
 *   3. An allowlisted table has a column that is neither directly selected by one of its
 *      `columns` entries nor listed in that entry's `excludedColumns` (an unreviewed new
 *      column on an existing, already-allowlisted table).
 */
export function auditSnapshotSchema(db: Database.Database): void {
  const allTableNames = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  ).map((r) => r.name);
  const allTableSet = new Set(allTableNames);
  const allowlistedNames = new Set(SNAPSHOT_TABLES.map((s) => s.table));

  for (const name of allTableNames) {
    if (isSqliteInternalTable(name)) continue;
    if (allowlistedNames.has(name) || INTENTIONALLY_EXCLUDED_TABLES.has(name)) continue;
    throw new Error(
      `auditSnapshotSchema: table "${name}" is neither allowlisted in SNAPSHOT_TABLES nor in ` +
        'INTENTIONALLY_EXCLUDED_TABLES — a new table must be consciously reviewed and added to ' +
        'one list or the other in server/src/lib/wamCompletionBackup.ts before a backup can be built'
    );
  }

  for (const spec of SNAPSHOT_TABLES) {
    if (!allTableSet.has(spec.table)) {
      throw new Error(
        `auditSnapshotSchema: allowlisted table "${spec.table}" is missing from the database — refusing to produce an incomplete backup snapshot`
      );
    }
    const liveColumns = db.prepare(`PRAGMA table_info("${spec.table}")`).all() as { name: string }[];
    const directlySelected = new Set(spec.columns.map((c) => c.expr));
    const excluded = new Set(spec.excludedColumns ?? []);
    for (const col of liveColumns) {
      if (directlySelected.has(col.name) || excluded.has(col.name)) continue;
      throw new Error(
        `auditSnapshotSchema: table "${spec.table}" has column "${col.name}" that is neither ` +
          'selected nor listed in excludedColumns — a new column must be consciously included ' +
          '(add a columns entry) or excluded (add to excludedColumns) in ' +
          'server/src/lib/wamCompletionBackup.ts before a backup can be built'
      );
    }
  }
}

/**
 * Builds the deterministic, versioned, table-structured snapshot described in the module doc
 * comment above. `auditSnapshotSchema()` runs first — see its own doc comment — so a snapshot
 * is never produced against a database whose schema has drifted from this file's allowlist
 * without conscious review, whether that's a missing table, an unreviewed new table, or an
 * unreviewed new column on an existing table.
 */
export function buildAppDataSnapshot(db: Database.Database): AppDataSnapshot {
  auditSnapshotSchema(db);

  const tables: Record<string, unknown[]> = {};
  for (const spec of SNAPSHOT_TABLES) {
    const selectSql = `SELECT ${spec.columns
      .map((c) => `${c.expr} AS "${c.as}"`)
      .join(', ')} FROM ${spec.table} ORDER BY ${spec.orderBy}`;
    tables[spec.table] = db.prepare(selectSql).all();
  }

  const appliedMigrations = (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[])
    .map((r) => r.name)
    .sort();

  return {
    schemaVersion: BACKUP_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    shapeId: computeSnapshotShapeId(),
    appliedMigrations,
    tables,
  };
}

/**
 * Inserts the one-and-only immutable backup row for a just-completed WAM, as part of the
 * caller's own transaction (see routes/wams.ts POST /:id/complete) — this function issues no
 * BEGIN/COMMIT of its own, so it must always be called from inside an existing
 * `db.transaction()` closure, *after* the WAM's status/score-snapshot updates have already
 * run in that same transaction, so the snapshot captures the just-completed state. The
 * caller must pass the just-completed WAM's own id/week/completedAt explicitly (read back
 * from the row after updating it) — these are frozen into the backup row as plain scalars
 * (see migration 012) so they remain readable even if the `wams` row itself is later deleted.
 *
 * Idempotent by construction: if a backup already exists for this WAM (e.g. it was reopened
 * and re-completed, or two near-simultaneous completion requests both reached this point),
 * this is a no-op — the original backup is preserved forever, satisfying the "exactly one
 * immutable backup per WAM" invariant. The table's own UNIQUE(triggering_wam_id) index is a
 * hard backstop against ever inserting a second row for the same WAM even if this check were
 * somehow bypassed.
 */
export function insertWamCompletionBackupIfAbsent(
  db: Database.Database,
  wam: { id: number; week: number; completedAt: string }
): void {
  const existing = db.prepare('SELECT id FROM backup WHERE triggering_wam_id = ?').get(wam.id);
  if (existing) return;

  const snapshot = buildAppDataSnapshot(db);
  db.prepare(
    `INSERT INTO backup (triggering_wam_id, triggering_wam_week, wam_completed_at, schema_version, snapshot_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(wam.id, wam.week, wam.completedAt, snapshot.schemaVersion, JSON.stringify(snapshot));
}
