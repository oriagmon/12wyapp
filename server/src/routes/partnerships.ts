import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { pairWithUserSchema } from '../lib/validation.js';
import { getAcceptedPartner } from '../lib/access.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';
import { tReq } from '../lib/i18n/index.js';

export const partnershipsRouter = Router();
partnershipsRouter.use(requireAuth);

interface PartnershipRow {
  id: number;
  initiator_id: number;
  invitee_id: number;
  created_at: string;
}

/**
 * Direct pairing is limited to operator-approved accounts by the app-wide admission
 * policy. Approval covers discovery and mutual data sharing; there is no invitation flow.
 */

/** GET / -> the caller's current partner, if any. */
partnershipsRouter.get('/', (req, res) => {
  const db = getDb();
  const partner = getAcceptedPartner(db, req.user!.id);
  res.json({ partner: partner ?? null });
});

/** GET /candidates -> other admitted users (id + email), for direct selection. */
partnershipsRouter.get('/candidates', (req, res) => {
  const db = getDb();
  const users = db
    .prepare('SELECT id, email FROM users WHERE id != ? ORDER BY email COLLATE NOCASE ASC')
    .all(req.user!.id) as { id: number; email: string }[];
  res.json({ users: users.filter((user) => isUserAdmitted(user.id)) });
});

/**
 * POST /pair { targetUserId }
 * Immediately creates a mutual, already-active partnership with the selected registered
 * user — no invitation or acceptance step. Rejects self-pairing and enforces "at most one
 * partner per user" for both sides. The check-then-insert happens inside a single
 * synchronous transaction; better-sqlite3 has no internal concurrency and Express/Node
 * fully serializes handling of this (fully synchronous) handler, so there is no window for
 * a race to slip a second partnership past the "already has a partner" check.
 */
partnershipsRouter.post('/pair', (req, res) => {
  const parsed = pairWithUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const userId = req.user!.id;
  const targetUserId = parsed.data.targetUserId;

  if (targetUserId === userId) {
    res.status(400).json({ error: 'לא ניתן לבחור את עצמך כשותף/ה' });
    return;
  }

  const targetUser = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetUserId) as
    | { id: number; email: string }
    | undefined;
  if (!targetUser || !isUserAdmitted(targetUserId)) {
    res.status(404).json({ error: 'המשתמש/ת לא נמצא/ה' });
    return;
  }

  let conflict: string | null = null;
  const pair = db.transaction(() => {
    if (getAcceptedPartner(db, userId)) {
      conflict = 'כבר יש לך שותף/ה פעיל/ה. יש להסיר את השיתוף הקיים לפני בחירת שותף/ה חדש/ה';
      return;
    }
    if (getAcceptedPartner(db, targetUserId)) {
      conflict = 'למשתמש/ת שנבחר/ה כבר יש שותף/ה אחר/ת';
      return;
    }
    db.prepare('INSERT INTO partnerships (initiator_id, invitee_id) VALUES (?, ?)').run(userId, targetUserId);
  });
  pair();

  if (conflict) {
    res.status(409).json({ error: conflict });
    return;
  }

  const partner = getAcceptedPartner(db, userId);
  res.status(201).json({ partner });
});

/** DELETE /:id — either side of the partnership can remove it, immediately revoking access. */
partnershipsRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const partnership = db.prepare('SELECT * FROM partnerships WHERE id = ?').get(id) as
    | PartnershipRow
    | undefined;
  if (!partnership) {
    res.status(404).json({ error: 'לא נמצא' });
    return;
  }
  const isParticipant = partnership.initiator_id === userId || partnership.invitee_id === userId;
  if (!isParticipant) {
    res.status(403).json({ error: 'אין הרשאה' });
    return;
  }
  db.prepare('DELETE FROM partnerships WHERE id = ?').run(id);
  res.status(204).end();
});
