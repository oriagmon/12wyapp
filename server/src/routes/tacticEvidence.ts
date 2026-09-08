import express, { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess } from '../lib/access.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';
import { sessionCookieScope } from '../lib/sessionCookie.js';
import { getValidSession } from '../lib/sessions.js';
import {
  EVIDENCE_ACCEPTED_CONTENT_TYPES,
  MAX_EVIDENCE_FILE_BYTES,
  MAX_LINK_LENGTH,
  MAX_NOTE_LENGTH,
  WEEKLY_EVIDENCE_SLOT,
  buildContentDispositionFilenameParts,
  currentEvidenceStoredName,
  deleteEvidenceFile,
  generateStoredFilename,
  hasCompletedEvidenceScope,
  normalizeOriginalFilename,
  readEvidenceFile,
  sniffEvidenceFile,
  serializeTacticEvidence as serialize,
  upsertEvidenceFileRecord,
  writeEvidenceFile,
  type EvidenceMime,
  type TacticEvidenceRow,
} from '../lib/tacticEvidence.js';
import { tReq } from '../lib/i18n/index.js';

export const tacticEvidenceRouter = Router();
tacticEvidenceRouter.use(requireAuth);

const paramsSchema = z.object({
  tacticId: z.coerce.number().int().positive(),
  week: z.coerce.number().int().min(1).max(12),
  weekday: z.coerce.number().int().min(0).max(6).optional().transform((day) => day ?? WEEKLY_EVIDENCE_SLOT),
});

const evidencePaths = ['/weekly/:tacticId/:week', '/:tacticId/:week/:weekday'];
const filePaths = evidencePaths.map((route) => `${route}/file`);

const metadataSchema = z.object({
  note: z.string().max(MAX_NOTE_LENGTH, 'errors.validation.noteTooLong').optional(),
  link: z
    .string()
    .max(MAX_LINK_LENGTH, 'errors.validation.linkTooLong')
    .optional(),
});

/** Trims to null-if-empty; the DB stores an absent value as SQL NULL, never an empty string,
 *  so the "at least one of note/link/file" invariant can be checked with simple null tests. */
function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Only http:// and https:// are ever accepted — parsed with the URL constructor (never a
 *  regex) so e.g. `javascript:`, `data:`, or a malformed string are rejected outright. */
function validateLink(link: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (link === null) return { ok: true, value: null };
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return { ok: false, error: 'api.tacticEvidence.linkInvalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'api.tacticEvidence.linkProtocol' };
  }
  return { ok: true, value: link };
}

type EvidenceContext =
  | { ok: true; access: 'owner' | 'partner'; targetUserId: number; cycleId: number; cycleIsActive: boolean }
  | { ok: false; status: 404 | 403; error: string };

/** Resolves whether `viewerId` may see/act on evidence for `tacticId` at all, independent of
 *  any specific occurrence — owner/partner is derived from the tactic's owning cycle's
 *  `user_id` via the same `resolveAccess` used throughout the app (never a bespoke check). */
function loadEvidenceContext(db: Database.Database, viewerId: number, tacticId: number): EvidenceContext {
  const row = db
    .prepare(
      `SELECT g.cycle_id as cycle_id, c.user_id as cycle_user_id, c.is_active as cycle_is_active
       FROM tactics t JOIN goals g ON g.id = t.goal_id JOIN cycles c ON c.id = g.cycle_id
       WHERE t.id = ?`
    )
    .get(tacticId) as { cycle_id: number; cycle_user_id: number; cycle_is_active: number } | undefined;
  if (!row) return { ok: false, status: 404, error: 'api.tacticEvidence.tacticNotFound' };
  const access = resolveAccess(db, viewerId, row.cycle_user_id);
  if (access === 'none') return { ok: false, status: 403, error: 'api.tacticEvidence.accessForbidden' };
  return { ok: true, access, targetUserId: row.cycle_user_id, cycleId: row.cycle_id, cycleIsActive: row.cycle_is_active === 1 };
}

function findEvidence(db: Database.Database, tacticId: number, week: number, weekday: number): TacticEvidenceRow | undefined {
  return db
    .prepare('SELECT * FROM tactic_evidence WHERE tactic_id = ? AND week = ? AND weekday = ?')
    .get(tacticId, week, weekday) as TacticEvidenceRow | undefined;
}

type FileAccessFailure = { status: 401 | 403 | 404; error: string };

/** Return a denial without sending it, so an upload can finish rollback before responding. */
function fileAccessFailure(req: express.Request, tacticId: number, ownerOnly: boolean): FileAccessFailure | null {
  const db = getDb();
  const session = getValidSession(db, req.cookies?.[config.sessionCookieName]);
  if (!session || session.user_id !== req.user?.id || !isUserAdmitted(session.user_id)) {
    return { status: 401, error: 'api.tacticEvidence.sessionExpired' };
  }
  const ctx = loadEvidenceContext(db, session.user_id, tacticId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };
  if (ownerOnly && ctx.access !== 'owner') {
    return { status: 403, error: 'api.tacticEvidence.onlyOwnerCanEdit' };
  }
  return null;
}

function sendFileAccessFailure(
  req: express.Request,
  res: express.Response,
  failure: FileAccessFailure,
): void {
  if (failure.status === 401) res.clearCookie(config.sessionCookieName, sessionCookieScope(req));
  res.status(failure.status).json({ error: failure.error });
}

/** One weekly editor plus every original daily entry, without merging/overwriting slots. */
tacticEvidenceRouter.get('/weekly/:tacticId/:week', (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const db = getDb();
  const { tacticId, week } = params.data;
  const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }
  const rows = db.prepare('SELECT * FROM tactic_evidence WHERE tactic_id = ? AND week = ? ORDER BY weekday')
    .all(tacticId, week) as TacticEvidenceRow[];
  const weekly = rows.find((row) => row.weekday === WEEKLY_EVIDENCE_SLOT);
  res.json({
    access: ctx.access,
    evidence: weekly ? serialize(weekly) : null,
    legacyEvidence: rows.filter((row) => row.weekday !== WEEKLY_EVIDENCE_SLOT).map(serialize),
    canCreate: ctx.access === 'owner' && hasCompletedEvidenceScope(db, tacticId, week, WEEKLY_EVIDENCE_SLOT),
  });
});

/** GET /:tacticId/:week/:weekday — owner or accepted partner (read-only) may view. Returns
 *  `{ evidence: null }` (not a 404) when the occurrence has no evidence yet — mirroring the
 *  weekly-planning-ritual route's own null-when-absent convention. */
tacticEvidenceRouter.get('/:tacticId/:week/:weekday', (req, res) => {
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday } = parsedParams.data;
  const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }
  const row = findEvidence(db, tacticId, week, weekday);
  res.json({ access: ctx.access, evidence: row ? serialize(row) : null });
});

/** PUT /:tacticId/:week/:weekday — owner-only upsert of the note/link metadata (never
 *  touches file fields). Creating a brand-new evidence row requires the occurrence to be
 *  currently completed (`completions.done = 1`); editing an *existing* row is always allowed
 *  regardless of the occurrence's current completion state, so unchecking a completion never
 *  erases previously-recorded evidence or blocks the owner from continuing to edit it — only
 *  *new* evidence requires a currently-completed occurrence. */
tacticEvidenceRouter.put(evidencePaths, (req, res) => {
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const parsedBody = metadataSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: tReq(req, parsedBody.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday } = parsedParams.data;
  const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }
  if (ctx.access !== 'owner') {
    res.status(403).json({ error: tReq(req, 'api.tacticEvidence.onlyOwnerCanEdit') });
    return;
  }

  const note = normalizeOptionalText(parsedBody.data.note);
  const linkResult = validateLink(normalizeOptionalText(parsedBody.data.link));
  if (!linkResult.ok) {
    res.status(400).json({ error: linkResult.error });
    return;
  }
  const link = linkResult.value;

  const existing = findEvidence(db, tacticId, week, weekday);
  if (!existing && !hasCompletedEvidenceScope(db, tacticId, week, weekday)) {
    res.status(400).json({ error: weekday === WEEKLY_EVIDENCE_SLOT
      ? tReq(req, 'api.tacticEvidence.noWeeklyCompletionForEvidence')
      : tReq(req, 'api.tacticEvidence.noCompletionForEvidence') });
    return;
  }
  const willHaveFile = existing?.file_stored_name != null;
  if (note === null && link === null && !willHaveFile) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.evidenceCannotBeEmpty') });
    return;
  }

  db.prepare(
    `INSERT INTO tactic_evidence (tactic_id, week, weekday, note, link)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tactic_id, week, weekday)
     DO UPDATE SET note = excluded.note, link = excluded.link, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(tacticId, week, weekday, note, link);

  const row = findEvidence(db, tacticId, week, weekday)!;
  res.json(serialize(row));
});

/** Cheap early rejection of an oversized upload from the declared Content-Length, mirroring
 *  profile.ts's identical avatar-upload guard — express.raw()'s own `limit` is the second
 *  line of defense for chunked/absent-Content-Length requests. */
function rejectOversizedEvidenceFile(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_EVIDENCE_FILE_BYTES) {
    req.resume();
    res.status(413).json({ error: tReq(req, 'api.tacticEvidence.fileTooLarge') });
    return;
  }
  next();
}

/** PUT /:tacticId/:week/:weekday/file — owner-only raw binary upload/replace. The client must
 *  send the real original filename via `X-Evidence-Filename` (URL-encoded — this is the only
 *  way for a raw-binary request to carry it without a multipart dependency or base64/JSON
 *  wrapping) purely so DOCX/TXT sniffing has *something* to cross-check against and so
 *  downloads can suggest a sensible name later; it is never trusted as a filesystem path. The
 *  declared name is normalized (bounded to 255 Unicode code points, control characters and any
 *  path-like prefix stripped — see `normalizeOriginalFilename`) *before* it's used for either
 *  the DOCX/TXT extension check or the DB write.
 *
 *  A file that's written to disk but then fails to commit to the DB is deleted again (rolled
 *  back). Since the file write is asynchronous (it yields the event loop) but the DB write
 *  that follows it is not, another concurrent request for the *same* occurrence could complete
 *  entirely in between — `upsertEvidenceFileRecord` re-checks the occurrence's current state
 *  fresh, atomically, immediately before writing the DB row (see its own doc comment for the
 *  full race analysis), and the sequence below reacts to every outcome that can produce
 *  (abort-and-clean-up-our-file, delete-a-freshly-observed-previous-file, or
 *  self-delete-our-own-file if a still-later request has since won the race). */
tacticEvidenceRouter.put(
  filePaths,
  rejectOversizedEvidenceFile,
  express.raw({ type: EVIDENCE_ACCEPTED_CONTENT_TYPES, limit: MAX_EVIDENCE_FILE_BYTES }),
  async (req, res) => {
    const parsedParams = paramsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: tReq(req, 'api.tacticEvidence.unsupportedFileType') });
      return;
    }
    const db = getDb();
    const { tacticId, week, weekday } = parsedParams.data;

    // Every synchronous DB call below is inside this `async` handler, so any of them
    // throwing (e.g. a forced schema-drift/corruption scenario) would otherwise become a
    // silently unhandled promise rejection with no response ever sent — Express does not
    // automatically forward async rejections to the error middleware (see the identical
    // rationale in routes/wams.ts's own POST /:id/complete). This outer try/catch is the
    // safety net; the more specific catches further below give better-targeted messages for
    // the two known failure points (the file write, and the DB write after it).
    try {
      const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
      if (!ctx.ok) {
        res.status(ctx.status).json({ error: ctx.error });
        return;
      }
      if (ctx.access !== 'owner') {
        res.status(403).json({ error: tReq(req, 'api.tacticEvidence.onlyOwnerCanEdit') });
        return;
      }
      // Advisory only — a fast-path rejection for the common case, avoiding a wasted upload
      // attempt. The authoritative check is repeated fresh (race-safe) inside
      // `upsertEvidenceFileRecord` after the file write below.
      const preCheckExisting = findEvidence(db, tacticId, week, weekday);
      if (!preCheckExisting && !hasCompletedEvidenceScope(db, tacticId, week, weekday)) {
        res.status(400).json({ error: weekday === WEEKLY_EVIDENCE_SLOT
          ? tReq(req, 'api.tacticEvidence.noWeeklyCompletionForEvidence')
          : tReq(req, 'api.tacticEvidence.noCompletionForEvidence') });
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tacticEvidence] unexpected error preparing file upload for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileSaveFailed') });
      return;
    }

    let declaredFilename = '';
    const rawHeader = req.headers['x-evidence-filename'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (headerValue) {
      try {
        declaredFilename = normalizeOriginalFilename(decodeURIComponent(headerValue));
      } catch {
        declaredFilename = '';
      }
    }

    const sniffed = sniffEvidenceFile(req.body, declaredFilename);
    if (!sniffed) {
      res.status(400).json({ error: tReq(req, 'api.tacticEvidence.fileContentMismatch') });
      return;
    }
    const declaredContentType = (req.headers['content-type'] || '').split(';')[0].trim() as EvidenceMime;
    if (declaredContentType !== sniffed.mime) {
      res.status(400).json({ error: tReq(req, 'api.tacticEvidence.declaredTypeMismatch') });
      return;
    }

    const storedName = generateStoredFilename(sniffed.ext);
    try {
      await writeEvidenceFile(storedName, req.body);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tacticEvidence] failed to write evidence file for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileSaveFailed') });
      return;
    }

    let upsertResult: ReturnType<typeof upsertEvidenceFileRecord>;
    try {
      const accessFailure = fileAccessFailure(req, tacticId, true);
      if (accessFailure) {
        await deleteEvidenceFile(storedName).catch(() => undefined);
        sendFileAccessFailure(req, res, accessFailure);
        return;
      }
      upsertResult = upsertEvidenceFileRecord(db, {
        tacticId,
        week,
        weekday,
        fileOriginalName: declaredFilename.length > 0 ? declaredFilename : null,
        fileStoredName: storedName,
        fileMime: sniffed.mime,
        fileSize: req.body.length,
      });
    } catch (err) {
      // The DB write failed — the file we just wrote must not become an orphan, and no
      // record of it must be left as though it succeeded.
      await deleteEvidenceFile(storedName).catch(() => undefined);
      // eslint-disable-next-line no-console
      console.error(`[tacticEvidence] failed to persist evidence file metadata for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileSaveFailed') });
      return;
    }

    if (upsertResult.status === 'aborted') {
      // The occurrence was unchecked during the (async) file write above, and this would
      // have been a brand-new record — never create it; the file we already wrote must not
      // become an orphan either.
      await deleteEvidenceFile(storedName).catch(() => undefined);
      res.status(400).json({ error: tReq(req, upsertResult.reason) });
      return;
    }

    // Only now, after the DB successfully points at the new file, is the previous one (if
    // this was a replace) removed — never before, so a failure above always leaves the
    // previous file intact and referenced. `previousStoredName` reflects a fresh read taken
    // *inside* the same transaction as the upsert, so a different concurrent request's
    // replacement that happened during our own file-write await is the one correctly cleaned
    // up here, never orphaned.
    if (upsertResult.previousStoredName && upsertResult.previousStoredName !== storedName) {
      await deleteEvidenceFile(upsertResult.previousStoredName).catch(() => undefined);
    }

    try {
      // Final race check: if a *later* concurrent request has since replaced this one's file
      // (its own upsert committing after ours), the current stored name will no longer be
      // ours — self-delete rather than leave an unreferenced orphan on disk. Deletion is
      // idempotent/force, so this is safe even if that other request's own cleanup already
      // removed it.
      const stillCurrent = currentEvidenceStoredName(db, tacticId, week, weekday) === storedName;
      if (!stillCurrent) {
        await deleteEvidenceFile(storedName).catch(() => undefined);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tacticEvidence] unexpected error during post-commit race check for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }

    try {
      const row = findEvidence(db, tacticId, week, weekday);
      if (!row) {
        // Extremely unlikely (would require the whole record to have been deleted by another
        // request in the same tiny window) — still handled explicitly rather than assuming.
        res.json({ evidence: null });
        return;
      }
      res.json(serialize(row));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tacticEvidence] failed to load just-saved evidence for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileLoadedButStaleAfterSave') });
    }
  }
);

/** DELETE /:tacticId/:week/:weekday/file — owner-only, removes just the file. If the record
 *  would otherwise become completely empty (no note/link left either), the whole row is
 *  deleted instead of being left in a state the DB's own CHECK constraint forbids anyway. */
tacticEvidenceRouter.delete(filePaths, async (req, res) => {
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday } = parsedParams.data;
  let storedName: string;
  try {
    const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
    if (!ctx.ok) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }
    if (ctx.access !== 'owner') {
      res.status(403).json({ error: tReq(req, 'api.tacticEvidence.onlyOwnerCanEdit') });
      return;
    }
    const existing = findEvidence(db, tacticId, week, weekday);
    if (!existing || existing.file_stored_name === null) {
      res.status(404).json({ error: tReq(req, 'api.tacticEvidence.fileNotFound') });
      return;
    }

    storedName = existing.file_stored_name;
    const becomesEmpty = existing.note === null && existing.link === null;
    if (becomesEmpty) {
      db.prepare('DELETE FROM tactic_evidence WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        `UPDATE tactic_evidence
         SET file_original_name = NULL, file_stored_name = NULL, file_mime = NULL, file_size = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      ).run(existing.id);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] unexpected error deleting evidence file for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileDeleteFailed') });
    return;
  }
  await deleteEvidenceFile(storedName).catch(() => undefined);

  try {
    const row = findEvidence(db, tacticId, week, weekday);
    res.json({ evidence: row ? serialize(row) : null });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] failed to load evidence after file deletion for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileDeletedButStaleState') });
  }
});

/** DELETE /:tacticId/:week/:weekday — owner-only, removes the entire record (metadata + file
 *  if any). Idempotent: deleting an occurrence with no evidence is a harmless no-op 200. */
tacticEvidenceRouter.delete(evidencePaths, async (req, res) => {
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday } = parsedParams.data;
  let fileToDelete: string | null = null;
  try {
    const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
    if (!ctx.ok) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }
    if (ctx.access !== 'owner') {
      res.status(403).json({ error: tReq(req, 'api.tacticEvidence.onlyOwnerCanEdit') });
      return;
    }
    const existing = findEvidence(db, tacticId, week, weekday);
    if (!existing) {
      res.json({ ok: true });
      return;
    }
    db.prepare('DELETE FROM tactic_evidence WHERE id = ?').run(existing.id);
    fileToDelete = existing.file_stored_name;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] unexpected error deleting evidence for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: tReq(req, 'api.tacticEvidence.evidenceDeleteFailed') });
    return;
  }
  await deleteEvidenceFile(fileToDelete).catch(() => undefined);
  res.json({ ok: true });
});

/** GET /:tacticId/:week/:weekday/file — owner or accepted partner (read-only) may download.
 *  Authenticated and authorized every single time (no signed/anonymous URLs) — the browser's
 *  own cookie is what carries the session on a plain `<a href>`/`fetch` to this same-origin
 *  route. `Content-Type` is the *stored, sniffed* MIME (never re-derived from the client),
 *  `Content-Disposition` is `inline` for the two image formats and PDF (safe to render
 *  in-browser) and `attachment` for DOCX/TXT, and `Cache-Control: private, no-store` +
 *  `X-Content-Type-Options: nosniff` are always set. An inline (`image/*`/PDF) response also
 *  gets `Content-Security-Policy: sandbox`, so if it's ever rendered directly by a browser
 *  (e.g. opened in a new tab) it can never execute scripts, submit forms, or navigate the top
 *  frame — defense in depth against a PDF/image viewer bug, independent of `nosniff`. The
 *  header-building/response-send tail is wrapped in its own try/catch (see
 *  `buildContentDispositionFilenameParts` for why a raw Hebrew/emoji filename can otherwise
 *  crash Node's header validation) so an unexpected error here can never become an unhandled
 *  rejection — this route is `async`, and Express 4 does not forward async rejections to the
 *  centralized error middleware automatically. */
tacticEvidenceRouter.get(filePaths, async (req, res) => {
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidParams') });
    return;
  }
  const db = getDb();
  const { tacticId, week, weekday } = parsedParams.data;
  let row: TacticEvidenceRow | undefined;
  try {
    const ctx = loadEvidenceContext(db, req.user!.id, tacticId);
    if (!ctx.ok) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }
    row = findEvidence(db, tacticId, week, weekday);
    if (!row || row.file_stored_name === null || row.file_mime === null) {
      res.status(404).json({ error: tReq(req, 'api.tacticEvidence.fileNotFound') });
      return;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] unexpected error loading evidence metadata for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileLoadFailed') });
    return;
  }

  let data: Buffer;
  try {
    data = await readEvidenceFile(row.file_stored_name);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] failed to read evidence file for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileLoadFailed') });
    return;
  }

  try {
    const accessFailure = fileAccessFailure(req, tacticId, false);
    if (accessFailure) {
      sendFileAccessFailure(req, res, accessFailure);
      return;
    }
    if (currentEvidenceStoredName(db, tacticId, week, weekday) !== row.file_stored_name) {
      res.status(409).json({ error: tReq(req, 'api.tacticEvidence.fileChangedOrRemoved') });
      return;
    }
    const disposition = row.file_mime === 'application/pdf' || row.file_mime.startsWith('image/') ? 'inline' : 'attachment';
    const { asciiFallback, utf8Encoded } = buildContentDispositionFilenameParts(row.file_original_name);
    res.set('Content-Type', row.file_mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    if (disposition === 'inline') {
      res.set('Content-Security-Policy', 'sandbox');
    }
    res.set('Content-Disposition', `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`);
    res.send(data);
  } catch (err) {
    // A header/send failure here (never expected — buildContentDispositionFilenameParts is
    // itself designed to never throw — but this is the safety net regardless) must never
    // crash the process or hang the request. Headers may or may not have already been sent
    // by the time this fires, so respond only if it's still possible to.
    // eslint-disable-next-line no-console
    console.error(`[tacticEvidence] unexpected error sending evidence file for tactic ${tacticId}: ${err instanceof Error ? err.message : 'unknown error'}`);
    if (!res.headersSent) {
      res.status(500).json({ error: tReq(req, 'api.tacticEvidence.fileDownloadFailed') });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

/** GET /cycle/:cycleId — flat evidence gallery for one whole cycle (active or archived),
 *  owner or accepted partner (read-only). Includes enough tactic/goal context (title) for the
 *  client to group by week then tactic without a second round trip; never includes file
 *  bytes — only the same safe metadata shape as the single-occurrence GET above, plus
 *  identifying context. */
tacticEvidenceRouter.get('/cycle/:cycleId', (req, res) => {
  const cycleId = Number(req.params.cycleId);
  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    res.status(400).json({ error: tReq(req, 'api.tacticEvidence.invalidCycleId') });
    return;
  }
  const db = getDb();
  const cycle = db.prepare('SELECT id, user_id FROM cycles WHERE id = ?').get(cycleId) as
    | { id: number; user_id: number }
    | undefined;
  if (!cycle) {
    res.status(404).json({ error: tReq(req, 'api.tacticEvidence.cycleNotFound') });
    return;
  }
  const access = resolveAccess(db, req.user!.id, cycle.user_id);
  if (access === 'none') {
    res.status(403).json({ error: tReq(req, 'api.tacticEvidence.cycleForbidden') });
    return;
  }

  const rows = db
    .prepare(
      `SELECT e.*, t.title as tactic_title, g.title as goal_title, g.color as goal_color
       FROM tactic_evidence e
       JOIN tactics t ON t.id = e.tactic_id
       JOIN goals g ON g.id = t.goal_id
       WHERE g.cycle_id = ?
       ORDER BY e.week ASC, t.id ASC, e.weekday ASC`
    )
    .all(cycleId) as (TacticEvidenceRow & { tactic_title: string; goal_title: string; goal_color: string })[];

  res.json({
    access,
    items: rows.map((row) => ({
      ...serialize(row),
      tacticTitle: row.tactic_title,
      goalTitle: row.goal_title,
      goalColor: row.goal_color,
    })),
  });
});
