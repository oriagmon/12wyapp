import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAccess } from '../lib/access.js';
import { getActiveCycle, getCycleById } from '../lib/repo.js';
import { buildExecutionHeatmap, emptyHeatmapSummary } from '../lib/executionHeatmap.js';
import { TARGET_SCORE } from '../lib/scoring.js';
import { formatIsraelWallTime } from '../lib/israelTime.js';
import { tReq } from '../lib/i18n/index.js';

export const executionHeatmapRouter = Router();
executionHeatmapRouter.use(requireAuth);

function positiveId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** GET /:userId?cycleId= — current cycle by default; explicitly scoped archived history too. */
executionHeatmapRouter.get('/:userId', (req, res) => {
  const targetUserId = positiveId(req.params.userId);
  const cycleId = req.query.cycleId === undefined ? undefined : positiveId(req.query.cycleId);
  if (targetUserId === null || cycleId === null) {
    res.status(400).json({ error: tReq(req, 'api.executionHeatmap.invalidParams') });
    return;
  }
  const db = getDb();
  const access = resolveAccess(db, req.user!.id, targetUserId);
  if (access === 'none') {
    res.status(403).json({ error: tReq(req, 'api.executionHeatmap.forbidden') });
    return;
  }
  const cycle = cycleId === undefined ? getActiveCycle(db, targetUserId) : getCycleById(db, cycleId);
  if (cycleId !== undefined && (!cycle || cycle.user_id !== targetUserId)) {
    res.status(404).json({ error: tReq(req, 'api.executionHeatmap.cycleNotFound') });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  if (!cycle) {
    res.json({
      access, cycle: null, today: formatIsraelWallTime(new Date()).slice(0, 10),
      startDate: null, endDate: null, dateBasis: null, targetScore: TARGET_SCORE,
      days: [], summary: emptyHeatmapSummary(),
    });
    return;
  }
  res.json({ access, ...buildExecutionHeatmap(db, cycle) });
});
