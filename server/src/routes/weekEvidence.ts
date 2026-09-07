import express, { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { getValidSession } from '../lib/sessions.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';
import {
  EVIDENCE_ACCEPTED_CONTENT_TYPES, MAX_EVIDENCE_FILE_BYTES, buildContentDispositionFilenameParts,
  deleteEvidenceFile, generateStoredFilename, normalizeOriginalFilename, readEvidenceFile, sniffEvidenceFile, writeEvidenceFile,
} from '../lib/tacticEvidence.js';
import {
  createWeekEvidence, findWeekEvidence, listWeekEvidence, removeWeekEvidence, serializeWeekEvidence,
  updateWeekEvidenceMetadata, weekEvidenceAccess, weekEvidenceMetadata,
} from '../lib/weekEvidence.js';

export const weekEvidenceRouter = Router();
weekEvidenceRouter.use(requireAuth);
const scopeSchema = z.object({
  cycleId: z.coerce.number().int().positive().safe(),
  week: z.coerce.number().int().min(1).max(12).optional(),
  id: z.coerce.number().int().positive().safe().optional(),
});

/** Reusable after every asynchronous disk operation; never sends an early rollback response. */
function failure(req: express.Request, cycleId: number, write: boolean) {
  const db = getDb();
  const session = getValidSession(db, req.cookies?.[config.sessionCookieName]);
  if (!session || session.user_id !== req.user?.id || !isUserAdmitted(session.user_id)) {
    return { status: 401, error: 'ההתחברות פגה, יש להתחבר מחדש' };
  }
  const access = weekEvidenceAccess(db, session.user_id, cycleId, write);
  return access.ok ? null : access;
}

weekEvidenceRouter.use('/:cycleId', (req, res, next) => {
  const parsed = scopeSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: 'פרמטרים לא תקינים' }); return; }
  const denied = failure(req, parsed.data.cycleId, req.method !== 'GET');
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  res.set('Cache-Control', 'private, no-store');
  next();
});

function scope(req: express.Request, res: express.Response) {
  const parsed = scopeSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: 'פרמטרים לא תקינים' }); return null; }
  return parsed.data;
}

weekEvidenceRouter.get(['/:cycleId', '/:cycleId/:week'], (req, res) => {
  const params = scope(req, res);
  if (!params) return;
  const access = weekEvidenceAccess(getDb(), req.user!.id, params.cycleId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  res.json({ access: access.access, items: listWeekEvidence(getDb(), params.cycleId, params.week).map(serializeWeekEvidence) });
});

weekEvidenceRouter.post('/:cycleId/:week', (req, res) => {
  const params = scope(req, res);
  if (!params) return;
  const input = weekEvidenceMetadata.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message ?? 'קלט לא תקין' }); return; }
  if (!input.data.note && !input.data.link) { res.status(400).json({ error: 'יש להוסיף הערה, קישור או קובץ' }); return; }
  res.status(201).json(serializeWeekEvidence(createWeekEvidence(getDb(), params.cycleId, params.week!, input.data)));
});

weekEvidenceRouter.put('/:cycleId/:week/:id', (req, res) => {
  const params = scope(req, res);
  if (!params) return;
  const input = weekEvidenceMetadata.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message ?? 'קלט לא תקין' }); return; }
  const db = getDb();
  const row = findWeekEvidence(db, params.cycleId, params.week!, params.id!);
  if (!row) { res.status(404).json({ error: 'הפריט לא נמצא בשבוע הזה' }); return; }
  if (!input.data.note && !input.data.link && !row.file_stored_name) {
    res.status(400).json({ error: 'יש להשאיר הערה, קישור או קובץ' }); return;
  }
  updateWeekEvidenceMetadata(db, row, input.data);
  res.json(serializeWeekEvidence(findWeekEvidence(db, params.cycleId, params.week!, params.id!)!));
});

weekEvidenceRouter.post(
  '/:cycleId/:week/files',
  (req, res, next) => {
    if (Number(req.headers['content-length'] || 0) > MAX_EVIDENCE_FILE_BYTES) {
      req.resume(); res.status(413).json({ error: 'הקובץ גדול מדי — הגודל המרבי הוא 8MB' }); return;
    }
    next();
  },
  express.raw({ type: EVIDENCE_ACCEPTED_CONTENT_TYPES, limit: MAX_EVIDENCE_FILE_BYTES }),
  async (req, res, next) => {
    const params = scope(req, res);
    if (!params) return;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'יש להעלות PNG, JPEG, WebP, PDF, DOCX או TXT בלבד' }); return;
    }
    let name = '';
    try { name = normalizeOriginalFilename(decodeURIComponent(req.get('X-Evidence-Filename') ?? '')); } catch { /* Invalid display metadata is ignored. */ }
    const sniffed = sniffEvidenceFile(req.body, name);
    if (!sniffed || sniffed.mime !== (req.get('Content-Type') ?? '').split(';')[0].trim()) {
      res.status(400).json({ error: 'תוכן הקובץ אינו תואם לפורמט הנתמך שהוצהר' }); return;
    }
    const storedName = generateStoredFilename(sniffed.ext);
    let committed = false;
    try {
      await writeEvidenceFile(storedName, req.body);
      const denied = failure(req, params.cycleId, true);
      if (denied) {
        await deleteEvidenceFile(storedName).catch(() => undefined);
        res.status(denied.status).json({ error: denied.error }); return;
      }
      const item = createWeekEvidence(getDb(), params.cycleId, params.week!, {
        fileOriginalName: name || null, fileStoredName: storedName, fileMime: sniffed.mime, fileSize: req.body.length,
      });
      committed = true;
      res.status(201).json(serializeWeekEvidence(item));
    } catch (error) {
      if (!committed) await deleteEvidenceFile(storedName).catch(() => undefined);
      next(error);
    }
  },
);

weekEvidenceRouter.get('/:cycleId/:week/:id/file', async (req, res, next) => {
  const params = scope(req, res);
  if (!params) return;
  try {
    const db = getDb();
    const row = findWeekEvidence(db, params.cycleId, params.week!, params.id!);
    if (!row?.file_stored_name || !row.file_mime) { res.status(404).json({ error: 'לא נמצא קובץ' }); return; }
    const data = await readEvidenceFile(row.file_stored_name);
    const denied = failure(req, params.cycleId, false);
    if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
    if (findWeekEvidence(db, params.cycleId, params.week!, params.id!)?.file_stored_name !== row.file_stored_name) {
      res.status(409).json({ error: 'הקובץ השתנה או הוסר. יש לרענן' }); return;
    }
    const inline = row.file_mime.startsWith('image/') || row.file_mime === 'application/pdf';
    const { asciiFallback, utf8Encoded } = buildContentDispositionFilenameParts(row.file_original_name);
    res.set('Content-Type', row.file_mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    if (inline) res.set('Content-Security-Policy', 'sandbox');
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`);
    res.send(data);
  } catch (error) { next(error); }
});

function deleteWeekEvidence(fileOnly: boolean): express.RequestHandler {
  return async (req, res, next) => {
    const params = scope(req, res);
    if (!params) return;
    try {
      const db = getDb();
      const row = findWeekEvidence(db, params.cycleId, params.week!, params.id!);
      if (!row) { res.status(404).json({ error: 'הפריט לא נמצא בשבוע הזה' }); return; }
      const storedName = removeWeekEvidence(db, row, fileOnly);
      await deleteEvidenceFile(storedName).catch(() => undefined);
      res.json({ ok: true });
    } catch (error) { next(error); }
  };
}

weekEvidenceRouter.delete('/:cycleId/:week/:id/file', deleteWeekEvidence(true));
weekEvidenceRouter.delete('/:cycleId/:week/:id', deleteWeekEvidence(false));
