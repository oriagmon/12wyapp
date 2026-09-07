import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { searchArchive } from '../lib/archiveSearch.js';

export const archiveSearchRouter = Router();
archiveSearchRouter.use(requireAuth);

const querySchema = z.object({
  q: z.string().max(120).trim().min(1).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(20)).optional(),
}).strict();

/** GET /api/archive-search?q=...&limit=5 — exact per-category counts, bounded plain-text previews. */
archiveSearchRouter.get('/', (req, res) => {
  // Queries and authorized snippets should not survive logout in a shared browser/proxy cache.
  res.set('Cache-Control', 'no-store');
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'יש להזין חיפוש באורך 1–120 תווים ומגבלה של 1–20 תוצאות לקבוצה' });
    return;
  }
  res.json(searchArchive(getDb(), req.user!.id, parsed.data.q, parsed.data.limit ?? 5));
});
