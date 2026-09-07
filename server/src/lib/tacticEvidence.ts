import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

/**
 * Tactic evidence: file storage/validation primitives (see migration
 * 015_tactic_evidence.sql and routes/tacticEvidence.ts). File bytes never live in SQLite —
 * only metadata does. This module owns:
 *   - the allowed-format allowlist and content-signature sniffing (never trusting a client's
 *     declared Content-Type or filename for anything security-relevant);
 *   - random, server-generated stored filenames (never derived from user input);
 *   - safe read/write/delete against `config.evidenceDir`, with resolved-path containment as
 *     defense-in-depth against path traversal even though stored filenames are always
 *     server-generated;
 *   - private on-disk permissions (directory 0700, files 0600) via `ensureEvidenceDir()`;
 *   - a transactional re-check-then-upsert helper (`upsertEvidenceFileRecord`) that closes the
 *     TOCTOU window between writing a file to disk (async I/O) and recording it in SQLite
 *     (see routes/tacticEvidence.ts's file-upload handler for how it's used);
 *   - an orphan-file finder/remover for offline maintenance (see evidenceMaintenance.ts) —
 *     never run automatically, and never touches anything but generated-name regular files.
 *
 * No route/user deletion path exists in this app today for a `users` or `cycles` row itself
 * (only cycle *archiving*, which never deletes anything) — if one is ever added, it must
 * collect+schedule-delete evidence files for every affected tactic first, exactly like
 * routes/tactics.ts's and routes/goals.ts's own DELETE handlers already do, since SQL's own
 * `ON DELETE CASCADE` down to `tactic_evidence` has no way to also remove files from disk.
 */

/** Directory mode: owner-only rwx (0700) — no group/other access at all, since evidence files
 *  may contain sensitive personal photos/documents. */
const EVIDENCE_DIR_MODE = 0o700;
/** File mode: owner-only rw (0600) — matches the directory's own owner-only posture. */
const EVIDENCE_FILE_MODE = 0o600;

/**
 * Ensures `config.evidenceDir` exists and is private (owner-only), creating it if absent or
 * best-effort `chmod`-ing it to `0700` if it already exists with looser permissions. Called
 * once at server startup (see index.ts) and again, defensively, immediately before every file
 * write (see `writeEvidenceFile`) — the latter is what lets tests redirect `EVIDENCE_DIR` to a
 * fresh per-test temp directory without needing their own separate startup hook, since
 * `config.evidenceDir` itself is deliberately side-effect-free (see config.ts).
 *
 * Fails loudly (throws) rather than silently continuing if the directory cannot be created or
 * made usable at all (e.g. a permission error from a misconfigured `EVIDENCE_DIR`) — a
 * confusing later file-write failure would be a much worse failure mode than an explicit,
 * immediate one here. `chmod`/the final usability check are skipped on non-POSIX platforms
 * (`win32`), where POSIX permission bits don't apply the same way.
 */
export function ensureEvidenceDir(): void {
  const dir = config.evidenceDir;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: EVIDENCE_DIR_MODE });
  } catch (err) {
    throw new Error(`failed to create evidence directory: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, EVIDENCE_DIR_MODE);
    } catch (err) {
      throw new Error(`failed to secure evidence directory permissions: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    } catch (err) {
      throw new Error(`evidence directory is not accessible: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
}

export const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_NOTE_LENGTH = 2000;
export const MAX_LINK_LENGTH = 2048;
/** Storage-only slot; public weekly evidence has weekday: null, never a fake day. */
export const WEEKLY_EVIDENCE_SLOT = -1;

export function hasCompletedEvidenceScope(db: Database.Database, tacticId: number, week: number, weekday: number): boolean {
  const row = weekday === WEEKLY_EVIDENCE_SLOT
    ? db.prepare('SELECT 1 FROM completions WHERE tactic_id = ? AND week = ? AND done = 1 LIMIT 1').get(tacticId, week)
    : db.prepare('SELECT 1 FROM completions WHERE tactic_id = ? AND week = ? AND weekday = ? AND done = 1').get(tacticId, week, weekday);
  return row !== undefined;
}

export type EvidenceMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain';

/** The exact, fixed set of Content-Type header values the file-upload route accepts at the
 *  HTTP layer (mirrors profile.ts's AVATAR_MIME_TYPES pattern) — anything else never even
 *  reaches the raw-body parser, let alone the content-signature sniff below. */
export const EVIDENCE_ACCEPTED_CONTENT_TYPES: EvidenceMime[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

const EXT_BY_MIME: Record<EvidenceMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
};

function endsWithCaseInsensitive(name: string, suffix: string): boolean {
  return name.trim().toLowerCase().endsWith(suffix);
}

/** The declared original filename is only ever display metadata (Content-Disposition
 *  suggestion, DOCX/TXT extension check) — never a filesystem path — but is still bounded and
 *  cleaned at ingest so nothing absurdly long or control-character-laden ever reaches the DB
 *  or a header. */
export const MAX_ORIGINAL_FILENAME_CODEPOINTS = 255;

/**
 * Normalizes a client-declared original filename for safe storage/display: reduces it to just
 * the final path segment (a client should only ever send a bare filename, but a path-like
 * prefix — `/`, `\`, or both — is stripped defensively rather than trusted), strips NUL and
 * every other raw control character, trims whitespace, and bounds the result to
 * `MAX_ORIGINAL_FILENAME_CODEPOINTS` **Unicode code points** — iterating via `Array.from`
 * (which is code-point-aware) rather than a plain index/`slice`, so a surrogate pair (most
 * emoji, some CJK) is never split in half into two lone surrogates. Returns `''` for an empty
 * or all-stripped input — callers that need an extension (DOCX/TXT sniffing) already reject an
 * empty name naturally, since `''.endsWith('.docx')` is false.
 */
export function normalizeOriginalFilename(raw: string): string {
  if (!raw) return '';
  const lastSlash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  let base = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;

  const codepoints = Array.from(base).filter((ch) => {
    const code = ch.codePointAt(0)!;
    // Strip NUL and every other raw control character (0x00-0x1F, 0x7F) — never meaningful in
    // a filename and never safe to persist/display as one.
    return code !== 0 && code >= 0x20 && code !== 0x7f;
  });
  base = codepoints.join('').trim();

  const bounded = Array.from(base);
  if (bounded.length > MAX_ORIGINAL_FILENAME_CODEPOINTS) {
    base = bounded.slice(0, MAX_ORIGINAL_FILENAME_CODEPOINTS).join('').trim();
  }
  return base;
}

/** Strict UTF-8 (no lone surrogates/invalid sequences) and no NUL byte or other raw control
 *  character besides tab/LF/CR — a conservative content check standing in for TXT's lack of
 *  any magic-byte signature. Rejects anything that merely *decodes* as UTF-8 by accident
 *  (most binary files don't) while still allowing any real-world plain-text document. */
function isStrictUtf8PlainText(buffer: Buffer): boolean {
  if (buffer.includes(0x00)) return false;
  for (const byte of buffer) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return false;
  }
  return true;
}

export interface SniffedEvidenceFile {
  mime: EvidenceMime;
  ext: string;
}

/**
 * Determines the *real* format of `buffer` from its content alone — the only source of truth
 * used to accept or reject a file, regardless of whatever Content-Type header or filename the
 * client sent. Returns null for anything unrecognized (including SVG, HTML, and executables,
 * none of which match any branch below).
 *
 *   - PNG/JPEG/WebP/PDF: classic magic-byte signatures, no filename involved.
 *   - DOCX: at minimum a ZIP local-file-header signature (`PK\x03\x04`) *and* a declared
 *     original filename ending in `.docx` — this project deliberately does not add a ZIP/XML
 *     parsing dependency just to fully validate OOXML internals; the signature+name pairing
 *     is the documented minimum bar, and still rejects a renamed non-ZIP file or a `.docx`
 *     name over non-ZIP bytes.
 *   - TXT: no signature exists for plain text at all, so acceptance instead requires the
 *     content to look like genuine strict-UTF-8 text (see isStrictUtf8PlainText) *and* a
 *     declared original filename ending in `.txt`.
 */
export function sniffEvidenceFile(buffer: Buffer, declaredOriginalName: string): SniffedEvidenceFile | null {
  if (buffer.length === 0) return null;

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: EXT_BY_MIME['image/png'] };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: EXT_BY_MIME['image/jpeg'] };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: EXT_BY_MIME['image/webp'] };
  }
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: EXT_BY_MIME['application/pdf'] };
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04 &&
    endsWithCaseInsensitive(declaredOriginalName, '.docx')
  ) {
    return {
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ext: EXT_BY_MIME['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    };
  }
  if (endsWithCaseInsensitive(declaredOriginalName, '.txt') && isStrictUtf8PlainText(buffer)) {
    return { mime: 'text/plain', ext: EXT_BY_MIME['text/plain'] };
  }
  return null;
}

/** Generates a fresh, cryptographically random, unguessable stored filename — the *only*
 *  string ever used to locate a file on disk. Never derived from the client's original
 *  filename in any way, so there is nothing for a path-traversal attempt to inject into. */
export function generateStoredFilename(ext: string): string {
  return `${crypto.randomBytes(24).toString('hex')}${ext}`;
}

/** Resolves a stored filename to an absolute path strictly inside `config.evidenceDir`,
 *  throwing if the resolved path would somehow escape it. Since every stored filename is
 *  always one of *our own* `generateStoredFilename()` outputs (hex + a fixed extension from
 *  `EXT_BY_MIME`), this can never actually trigger in normal operation — it exists purely as
 *  defense-in-depth containment, per the "resolved-path containment" requirement. */
export function evidenceFilePath(storedName: string): string {
  const dir = config.evidenceDir;
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  const resolved = path.resolve(dir, storedName);
  if (!resolved.startsWith(dirWithSep)) {
    throw new Error('evidence file path escaped the evidence directory');
  }
  return resolved;
}

/** Writes a freshly-uploaded evidence file. Calls `ensureEvidenceDir()` first (see its own
 *  doc comment — this is what lets tests redirect `EVIDENCE_DIR` per-test without a separate
 *  startup hook). `wx` (write, fail-if-exists, and on POSIX refuses to follow a symlink at
 *  that path) is used deliberately: `storedName` is always a brand-new random name that must
 *  not already exist, so any collision (astronomically unlikely with 192 bits of randomness)
 *  or a symlink placed at that exact path is treated as an error rather than silently
 *  overwritten-through or followed. `mode: 0o600` keeps the file owner-only readable/writable
 *  from the moment it's created (not merely chmod'd afterward, which would leave a brief
 *  window with looser permissions). */
export async function writeEvidenceFile(storedName: string, data: Buffer): Promise<void> {
  ensureEvidenceDir();
  await fs.promises.writeFile(evidenceFilePath(storedName), data, { flag: 'wx', mode: EVIDENCE_FILE_MODE });
}

export async function readEvidenceFile(storedName: string): Promise<Buffer> {
  return fs.promises.readFile(evidenceFilePath(storedName));
}

/** Best-effort delete — used both to clean up a replaced/removed file after the corresponding
 *  DB change has already committed, and to roll back a just-written file if the DB write that
 *  was supposed to reference it then fails. `force: true` makes a missing file a silent
 *  no-op rather than an error (it may never have existed, or may already have been removed). */
export async function deleteEvidenceFile(storedName: string | null | undefined): Promise<void> {
  if (!storedName) return;
  await fs.promises.rm(evidenceFilePath(storedName), { force: true });
}

export interface ContentDispositionFilenameParts {
  /** ASCII-only value for the legacy `filename="..."` quoted-string parameter (RFC 6266 §5
   *  recommends always including this for older user agents that don't understand
   *  `filename*`). Every character outside printable ASCII (0x20-0x7E), plus `"`/`\` (which
   *  would otherwise break out of the quoted string), is replaced with `_`. This is what
   *  actually matters for correctness: Node's HTTP layer only accepts Latin-1/ASCII bytes in
   *  header *values* at all — passing a raw Hebrew or emoji character through here would throw
   *  `ERR_INVALID_CHAR` and crash the request (this is the exact bug this function fixes). */
  asciiFallback: string;
  /** Already percent-encoded (`encodeURIComponent`-style) value for the RFC 5987/6266
   *  extended `filename*=UTF-8''...` parameter — safe to place directly after `UTF-8''` with
   *  no further escaping. Bounded to a reasonable byte length by iterating whole Unicode code
   *  points (via `Array.from`, never a naive UTF-16 `slice`), so a multi-byte/surrogate-pair
   *  character (Hebrew, most emoji) is never split in half mid-sequence. */
  utf8Encoded: string;
}

/** Bounds the `filename*` value to roughly this many encoded UTF-8 bytes — generous enough
 *  for any real filename, small enough to keep the header itself reasonably sized. */
const MAX_DISPOSITION_UTF8_BYTES = 300;

/**
 * Builds both Content-Disposition filename representations from a (possibly untrusted,
 * possibly non-ASCII, possibly malicious) original filename — never used for anything
 * path-related, only for what's suggested to the browser as a save-as name. Never throws:
 * any code point that individually fails to percent-encode (e.g. an unpaired/lone surrogate
 * from a malformed input) is simply skipped rather than aborting the whole value.
 */
export function buildContentDispositionFilenameParts(originalName: string | null | undefined): ContentDispositionFilenameParts {
  const base = normalizeOriginalFilename(originalName ?? '');
  const safeBase = base.length > 0 ? base : 'evidence';

  let asciiFallback = '';
  for (const ch of safeBase) {
    const code = ch.codePointAt(0) ?? 0;
    asciiFallback += code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== '\\' ? ch : '_';
  }
  asciiFallback = asciiFallback.trim();
  if (asciiFallback.length === 0) asciiFallback = 'evidence';

  let utf8Encoded = '';
  let byteLength = 0;
  for (const ch of safeBase) {
    let encoded: string;
    try {
      // encodeURIComponent leaves RFC 3986's `'()*` characters untouched, but RFC 5987's
      // attr-char grammar used by filename* excludes them. Encode those explicitly so the
      // emitted extended parameter is valid for every printable filename, not just Unicode.
      encoded = encodeURIComponent(ch).replace(
        /['()*]/g,
        (reserved) => `%${reserved.charCodeAt(0).toString(16).toUpperCase()}`
      );
    } catch {
      // A lone/unpaired surrogate (only reachable from malformed input) — skip this one code
      // point rather than let the whole filename* value fail to build.
      continue;
    }
    const chByteLength = (encoded.match(/%[0-9A-Fa-f]{2}/g) ?? []).length || ch.length;
    if (byteLength + chByteLength > MAX_DISPOSITION_UTF8_BYTES) break;
    utf8Encoded += encoded;
    byteLength += chByteLength;
  }
  if (utf8Encoded.length === 0) utf8Encoded = encodeURIComponent('evidence');

  return { asciiFallback, utf8Encoded };
}

/** Collects the on-disk stored filenames for every evidence row belonging to any of
 *  `tacticIds` — called *before* a cascading DB delete (goal/tactic deletion) removes those
 *  rows, since SQL's own `ON DELETE CASCADE` has no way to also remove the corresponding
 *  files from disk. */
export function collectEvidenceStoredFilenames(db: Database.Database, tacticIds: number[]): string[] {
  if (tacticIds.length === 0) return [];
  const placeholders = tacticIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT file_stored_name FROM tactic_evidence WHERE tactic_id IN (${placeholders}) AND file_stored_name IS NOT NULL`)
    .all(...tacticIds) as { file_stored_name: string }[];
  return rows.map((r) => r.file_stored_name);
}

/** Schedules best-effort deletion of now-orphaned evidence files after a cascading DB delete
 *  has already committed (goal/tactic deletion) — deferred via `setImmediate` so it never
 *  delays the delete route's own response, and every failure is caught and logged (only a
 *  count, never a filename or path) rather than ever becoming an unhandled rejection. */
export function scheduleEvidenceFileCleanup(storedNames: string[]): void {
  if (storedNames.length === 0) return;
  setImmediate(() => {
    Promise.all(storedNames.map((name) => deleteEvidenceFile(name))).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[tacticEvidence] failed to clean up ${storedNames.length} orphaned evidence file(s): ${
          err instanceof Error ? err.message : 'unknown error'
        }`
      );
    });
  });
}

/** Cheap "which (tactic, week, weekday) occurrences have evidence at all" lookup for
 *  embedding a compact indicator into the weekly grid/list without a second round trip —
 *  used by cycleBundle.ts. Returns a Set of `"tacticId:week:weekday"` keys for O(1) lookup. */
export function getEvidenceKeysForTactics(db: Database.Database, tacticIds: number[]): Set<string> {
  if (tacticIds.length === 0) return new Set();
  const placeholders = tacticIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT tactic_id, week, weekday FROM tactic_evidence WHERE tactic_id IN (${placeholders})`)
    .all(...tacticIds) as { tactic_id: number; week: number; weekday: number }[];
  return new Set(rows.map((r) => `${r.tactic_id}:${r.week}:${r.weekday}`));
}

export interface TacticEvidenceRow {
  id: number;
  tactic_id: number;
  week: number;
  weekday: number;
  note: string | null;
  link: string | null;
  file_original_name: string | null;
  file_stored_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
}

/** Shared public metadata shape; stored filenames/bytes are never exposed. */
export function serializeTacticEvidence(row: Omit<TacticEvidenceRow, 'tactic_id'> & { tactic_id: number | null }) {
  return {
    tacticId: row.tactic_id,
    week: row.week,
    weekday: row.weekday === WEEKLY_EVIDENCE_SLOT ? null : row.weekday,
    note: row.note,
    link: row.link,
    hasFile: row.file_stored_name !== null,
    fileOriginalName: row.file_original_name,
    fileMime: row.file_mime,
    fileSize: row.file_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface EvidenceFileUpsertInput {
  tacticId: number;
  week: number;
  weekday: number;
  fileOriginalName: string | null;
  fileStoredName: string;
  fileMime: EvidenceMime;
  fileSize: number;
}

export type EvidenceFileUpsertResult =
  | { status: 'aborted'; reason: string }
  | { status: 'committed'; previousStoredName: string | null };

/**
 * Atomically re-checks the occurrence's current state and upserts the file-evidence record in
 * one synchronous SQLite transaction — this is what closes the TOCTOU race window between the
 * async file-write that must happen before this call (`writeEvidenceFile`, which yields the
 * event loop) and the DB write that follows it. See routes/tacticEvidence.ts's file-upload
 * handler for the full call sequence: write file → call this → on `'aborted'`, delete the
 * just-written file and respond 400 → on `'committed'`, delete `previousStoredName` (if any
 * and different from this call's own `fileStoredName`), then re-read the occurrence one more
 * time to check whether a *later* concurrent request has since replaced this one's file —
 * self-deleting if so, since it would otherwise be an orphan (see `currentEvidenceStoredName`).
 *
 * - If no evidence row exists yet for this occurrence as of *this fresh read* (never a
 *   snapshot the caller may have taken before its own file-write await), the occurrence's
 *   completion status is re-checked fresh too — since it could have been unchecked during
 *   that await — and the upsert is aborted (never creating a brand-new record) if it's no
 *   longer completed. An *existing* record may always be replaced regardless of the
 *   occurrence's current completion state (same rule as the metadata PUT route).
 * - The `previousStoredName` returned is whatever this fresh read saw, never whatever the
 *   caller itself saw before its own await — so if a *different* concurrent request already
 *   replaced the file in that window, that request's own file (not some earlier stale one) is
 *   the one correctly identified for cleanup, never left orphaned.
 */
export function upsertEvidenceFileRecord(db: Database.Database, input: EvidenceFileUpsertInput): EvidenceFileUpsertResult {
  const run = db.transaction((): EvidenceFileUpsertResult => {
    const existing = db
      .prepare('SELECT * FROM tactic_evidence WHERE tactic_id = ? AND week = ? AND weekday = ?')
      .get(input.tacticId, input.week, input.weekday) as TacticEvidenceRow | undefined;

    if (!existing) {
      if (!hasCompletedEvidenceScope(db, input.tacticId, input.week, input.weekday)) {
        return { status: 'aborted', reason: input.weekday === WEEKLY_EVIDENCE_SLOT
          ? 'ניתן להוסיף עדות שבועית לאחר השלמת ביצוע אחד לפחות בשבוע'
          : 'ניתן להוסיף עדות רק לביצוע שהושלם' };
      }
    }

    db.prepare(
      `INSERT INTO tactic_evidence (tactic_id, week, weekday, file_original_name, file_stored_name, file_mime, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tactic_id, week, weekday)
       DO UPDATE SET
         file_original_name = excluded.file_original_name,
         file_stored_name = excluded.file_stored_name,
         file_mime = excluded.file_mime,
         file_size = excluded.file_size,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run(input.tacticId, input.week, input.weekday, input.fileOriginalName, input.fileStoredName, input.fileMime, input.fileSize);

    return { status: 'committed', previousStoredName: existing?.file_stored_name ?? null };
  });
  return run();
}

/** Reads back the currently-stored filename for one occurrence — used after
 *  `upsertEvidenceFileRecord` commits to detect whether a *later* concurrent request has since
 *  replaced this one's file (in which case this request's own copy is now unreferenced and
 *  should self-delete rather than orphan on disk). */
export function currentEvidenceStoredName(db: Database.Database, tacticId: number, week: number, weekday: number): string | null {
  const row = db
    .prepare('SELECT file_stored_name FROM tactic_evidence WHERE tactic_id = ? AND week = ? AND weekday = ?')
    .get(tacticId, week, weekday) as { file_stored_name: string | null } | undefined;
  return row?.file_stored_name ?? null;
}

/** Matches exactly the shape `generateStoredFilename()` produces (48 lowercase hex characters
 *  + one of the known extensions) — the maintenance scan below only ever considers files
 *  matching this pattern as candidates; anything else (an unknown filename, a hidden file,
 *  etc.) is left completely alone and reported separately. */
const GENERATED_FILENAME_PATTERN = /^[0-9a-f]{48}\.(png|jpe?g|webp|pdf|docx|txt)$/i;

export interface OrphanedEvidenceScanResult {
  /** Every generated-name regular file on disk not referenced by any tactic_evidence row. */
  orphanedFilenames: string[];
  /** Total generated-name regular files found on disk (orphaned + still-referenced). */
  scannedCount: number;
  /** Directory entries skipped because they aren't a generated-name regular file (a symlink,
   *  a directory, or an unrecognized filename) — reported, never touched. */
  skippedEntries: string[];
}

/**
 * Scans `config.evidenceDir` for on-disk files not referenced by any `tactic_evidence` row —
 * read-only, never deletes anything itself (see `deleteOrphanedEvidenceFiles` for that, and
 * `evidenceMaintenance.ts` for the CLI wrapper — intentionally never invoked automatically at
 * startup or from any request handler; a live server can legitimately have a brand-new file on
 * disk whose DB row hasn't committed yet at the exact instant of a scan, so this is documented
 * as a maintenance operation to run with the app stopped for deterministic results).
 *
 * Only ever considers a directory entry a candidate if it is both a regular file — via
 * `lstatSync` (never `statSync`, so a symlink is identified as itself, never silently followed
 * to whatever it points at) — and its name matches the exact shape `generateStoredFilename()`
 * produces; a symlink or any unrecognized filename is reported in `skippedEntries` and never
 * touched, even if it happens to also appear as "not referenced".
 */
export function findOrphanedEvidenceFiles(db: Database.Database): OrphanedEvidenceScanResult {
  const dir = config.evidenceDir;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { orphanedFilenames: [], scannedCount: 0, skippedEntries: [] };
  }

  const referencedRows = db
    .prepare('SELECT file_stored_name FROM tactic_evidence WHERE file_stored_name IS NOT NULL')
    .all() as { file_stored_name: string }[];
  const referenced = new Set(referencedRows.map((r) => r.file_stored_name));

  const orphanedFilenames: string[] = [];
  const skippedEntries: string[] = [];
  let scannedCount = 0;
  for (const name of entries) {
    if (!GENERATED_FILENAME_PATTERN.test(name)) {
      skippedEntries.push(name);
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path.join(dir, name));
    } catch {
      skippedEntries.push(name);
      continue;
    }
    if (!stat.isFile()) {
      // Covers symlinks (lstat reports the link itself, never its target) and directories —
      // never treated as a deletable evidence file candidate either way.
      skippedEntries.push(name);
      continue;
    }
    scannedCount += 1;
    if (!referenced.has(name)) {
      orphanedFilenames.push(name);
    }
  }
  return { orphanedFilenames, scannedCount, skippedEntries };
}

/** Deletes exactly the given filenames (intended to be the `orphanedFilenames` from a
 *  just-computed `findOrphanedEvidenceFiles()` result) — re-validates each name against the
 *  same generated-name pattern immediately before deleting, as a last-line defense against
 *  ever deleting something a caller didn't actually get from that scan. Returns the filenames
 *  actually deleted. */
export async function deleteOrphanedEvidenceFiles(orphanedFilenames: string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const name of orphanedFilenames) {
    if (!GENERATED_FILENAME_PATTERN.test(name)) continue;
    await deleteEvidenceFile(name);
    deleted.push(name);
  }
  return deleted;
}
