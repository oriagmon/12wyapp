import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess } from '../lib/access.js';
import { getActiveCycle } from '../lib/repo.js';
import { buildCycleBundle } from '../lib/cycleBundle.js';
import { tReq } from '../lib/i18n/index.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/:userId', (req, res) => {
  const db = getDb();
  const viewerId = req.user!.id;
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: tReq(req, 'api.dashboard.invalidUserId') });
    return;
  }

  const access = resolveAccess(db, viewerId, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: tReq(req, 'api.dashboard.forbidden') });
    return;
  }

  const targetUser = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetUserId) as
    | { id: number; email: string }
    | undefined;
  if (!targetUser) {
    res.status(404).json({ error: tReq(req, 'api.dashboard.userNotFound') });
    return;
  }

  const cycle = getActiveCycle(db, targetUserId);
  if (!cycle) {
    res.json({ access, targetEmail: targetUser.email, cycle: null, goals: [], weekScores: [], averageScore: null });
    return;
  }

  const bundle = buildCycleBundle(db, cycle);
  res.json({ access, targetEmail: targetUser.email, ...bundle });
});
