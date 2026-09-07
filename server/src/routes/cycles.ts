import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess } from '../lib/access.js';
import { getAllCyclesForUser, getCycleById } from '../lib/repo.js';
import { buildCycleBundle } from '../lib/cycleBundle.js';

export const cyclesRouter = Router();
cyclesRouter.use(requireAuth);

/** GET /:userId — list of all cycles (active + archived) for a user, most recent first.
 *  Archived cycles remain visible forever as immutable, read-only history. */
cyclesRouter.get('/:userId', (req, res) => {
  const db = getDb();
  const viewerId = req.user!.id;
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'מזהה משתמש לא תקין' });
    return;
  }
  const access = resolveAccess(db, viewerId, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: 'אין הרשאה לצפות בהיסטוריית המחזורים' });
    return;
  }
  const cycles = getAllCyclesForUser(db, targetUserId).map((c) => ({
    id: c.id,
    name: c.name,
    currentWeek: c.current_week,
    isActive: c.is_active === 1,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
  res.json({ access, cycles });
});

/** GET /:userId/:cycleId — full read-only bundle for one specific cycle (active or
 *  archived) belonging to that user. Always read-only regardless of viewer/owner — mutation
 *  must go through the normal /api/goals, /api/tactics, /api/completions routes, which
 *  themselves reject edits once the owning cycle is archived. */
cyclesRouter.get('/:userId/:cycleId', (req, res) => {
  const db = getDb();
  const viewerId = req.user!.id;
  const targetUserId = Number(req.params.userId);
  const cycleId = Number(req.params.cycleId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !Number.isInteger(cycleId) || cycleId <= 0) {
    res.status(400).json({ error: 'מזהה לא תקין' });
    return;
  }
  const access = resolveAccess(db, viewerId, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: 'אין הרשאה לצפות במחזור זה' });
    return;
  }
  const cycle = getCycleById(db, cycleId);
  if (!cycle || cycle.user_id !== targetUserId) {
    res.status(404).json({ error: 'המחזור לא נמצא' });
    return;
  }
  res.json({ access, ...buildCycleBundle(db, cycle) });
});
