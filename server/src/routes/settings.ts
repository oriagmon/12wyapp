import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { settingsUpdateSchema } from '../lib/validation.js';
import { tReq } from '../lib/i18n/index.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT theme FROM user_settings WHERE user_id = ?').get(req.user!.id) as
    | { theme: string }
    | undefined;
  res.json({ theme: row?.theme ?? 'dark' });
});

settingsRouter.patch('/', (req, res) => {
  const parsed = settingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO user_settings (user_id, theme) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(req.user!.id, parsed.data.theme);
  res.json({ theme: parsed.data.theme });
});
