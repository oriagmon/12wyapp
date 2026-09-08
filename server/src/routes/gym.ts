import { Router } from 'express';
import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { bodyWeightSchema, gymStateSchema } from '../lib/validation.js';
import { tReq } from '../lib/i18n/index.js';
import { israelDate } from '../lib/israelTime.js';

export const gymRouter = Router();
gymRouter.use(requireAuth);

const EMPTY_STATE = '{"sessions":[],"active":null}';

/**
 * How many weigh-ins to hand back by default. Roughly a year of daily readings, which is
 * enough to draw every trend the app shows without the client ever needing to paginate.
 */
const DEFAULT_WEIGHT_LIMIT = 400;

type StateRow = { data: string; updated_at: string };
type WeightRow = {
  measured_on: string;
  kg: number;
  condition: 'before' | 'after' | null;
  recorded_at: string;
};

function readWeights(userId: number, limit: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT measured_on, kg, condition, recorded_at
         FROM body_weights
        WHERE user_id = ?
        ORDER BY measured_on DESC
        LIMIT ?`
    )
    .all(userId, limit) as WeightRow[];

  // Ascending is what every chart and "change since last time" calculation wants; querying
  // DESC is only how we take the most recent N.
  return rows
    .map((row) => ({
      measuredOn: row.measured_on,
      kg: row.kg,
      condition: row.condition,
      recordedAt: row.recorded_at,
    }))
    .reverse();
}

function readState(userId: number) {
  const db = getDb();
  const row = db.prepare('SELECT data, updated_at FROM gym_state WHERE user_id = ?').get(userId) as
    | StateRow
    | undefined;

  if (!row) return { data: JSON.parse(EMPTY_STATE) as unknown, updatedAt: null };

  try {
    return { data: JSON.parse(row.data) as unknown, updatedAt: row.updated_at };
  } catch {
    // A blob that will not parse is a bug on our side, not something the user can act on.
    // Hand back an empty log rather than a 500 so the tracker still opens and can start
    // writing again; the unparseable row stays in the database for us to look at.
    return { data: JSON.parse(EMPTY_STATE) as unknown, updatedAt: row.updated_at };
  }
}

/**
 * Everything the tracker needs on open, in one round trip: the workout log, the weigh-in
 * history, and today's date as the *server* sees it.
 *
 * That last field matters. "Have I already weighed in this morning?" is the question that
 * decides whether the app greets you with a weight prompt, and answering it from the
 * device clock means a phone in the wrong timezone silently logs against the wrong day.
 */
gymRouter.get('/state', (req, res) => {
  const userId = req.user!.id;
  res.json({
    ...readState(userId),
    weights: readWeights(userId, DEFAULT_WEIGHT_LIMIT),
    today: israelDate(),
  });
});

/**
 * The workout log is written whole. The tracker is single-user-per-account and edits happen
 * one tap at a time on one device, so last-write-wins is honest and correct here; trying to
 * merge two divergent logs would invent data neither device actually recorded.
 *
 * The global body parser caps requests at 200kb, which a long training history could
 * eventually exceed, so this route parses with its own larger ceiling.
 */
gymRouter.put('/state', express.json({ limit: '2mb' }), (req, res) => {
  const parsed = gymStateSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }

  const db = getDb();
  const serialized = JSON.stringify(parsed.data);
  db.prepare(
    `INSERT INTO gym_state (user_id, data, updated_at)
          VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(req.user!.id, serialized);

  const saved = db
    .prepare('SELECT updated_at FROM gym_state WHERE user_id = ?')
    .get(req.user!.id) as { updated_at: string };
  res.json({ updatedAt: saved.updated_at });
});

gymRouter.get('/weights', (req, res) => {
  const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), 2000)
    : DEFAULT_WEIGHT_LIMIT;
  res.json({ weights: readWeights(req.user!.id, limit) });
});

/**
 * Records (or corrects) one morning's weight.
 *
 * Weighing yourself twice on the same day overwrites that day rather than appending, which
 * is what the `UNIQUE (user_id, measured_on)` constraint is for. It also means the "log
 * today's weight" button is safe to tap twice — a mis-tap costs a correction, not a
 * duplicate row that quietly skews the average.
 */
gymRouter.post('/weights', (req, res) => {
  const parsed = bodyWeightSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }

  const { measuredOn, kg, condition } = parsed.data;
  const db = getDb();
  db.prepare(
    `INSERT INTO body_weights (user_id, measured_on, kg, condition, recorded_at)
          VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, measured_on)
       DO UPDATE SET kg = excluded.kg,
                     condition = excluded.condition,
                     recorded_at = excluded.recorded_at`
  ).run(req.user!.id, measuredOn, kg, condition ?? null);

  res.status(201).json({ weights: readWeights(req.user!.id, DEFAULT_WEIGHT_LIMIT) });
});

gymRouter.delete('/weights/:measuredOn', (req, res) => {
  const measuredOn = String(req.params.measuredOn);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) {
    res.status(400).json({ error: tReq(req, 'errors.validation.invalidDate') });
    return;
  }

  const db = getDb();
  const result = db
    .prepare('DELETE FROM body_weights WHERE user_id = ? AND measured_on = ?')
    .run(req.user!.id, measuredOn);

  res.json({ removed: result.changes > 0, weights: readWeights(req.user!.id, DEFAULT_WEIGHT_LIMIT) });
});
