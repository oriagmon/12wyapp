import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getAcceptedPartner } from '../lib/access.js';
import {
  BROOST_PRESETS,
  MAX_CUSTOM_MESSAGE_LENGTH,
  checkBroostRateLimit,
  resolveBroostMessage,
  sanitizeError,
  scheduleImmediateBroostSend,
  serializeBroost,
  serializeBroostList,
  type BroostRow,
} from '../lib/broosts.js';
import { tReq } from '../lib/i18n/index.js';

export const broostsRouter = Router();
broostsRouter.use(requireAuth);

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const MAX_RECENT_UNREAD = 5;

const sendSchema = z.object({
  presetKey: z.string().trim().min(1).max(64).optional(),
  customMessage: z.string().max(MAX_CUSTOM_MESSAGE_LENGTH).optional(),
  replyToBroostId: z.number().int().positive().safe().optional(),
});

/** A dedicated error type used only to unwind out of the rate-limit-check + insert
 *  transaction below (see POST /) — never surfaced to the client directly. */
class BroostRateLimitedError extends Error {}

class BroostTargetError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

/** GET /presets — the single source of truth for preset copy (see lib/broosts.ts); the
 *  client never hardcodes its own duplicate list. */
broostsRouter.get('/presets', (_req, res) => {
  res.json({ presets: BROOST_PRESETS });
});

/** GET /history — this user's own combined sent+received BROOST history (never a third
 *  party's — a stranger has no route to any other user's history at all). Includes BROOSTs
 *  from a partnership that has since been removed: history belongs to its two original
 *  participants forever, independent of whether they're still paired. Paginated/capped. */
broostsRouter.get('/history', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_HISTORY_LIMIT, Math.floor(limitRaw)) : DEFAULT_HISTORY_LIMIT;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const rows = db
    .prepare(
      `SELECT * FROM partner_broosts WHERE sender_id = ? OR recipient_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(userId, userId, limit, offset) as BroostRow[];
  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM partner_broosts WHERE sender_id = ? OR recipient_id = ?`)
    .get(userId, userId) as { count: number };

  res.json({
    items: serializeBroostList(db, rows, userId),
    total: totalRow.count,
    limit,
    offset,
  });
});

/** GET /unread — this user's own unread count + a short recent-unread preview (for a TopBar
 *  badge/popover). Recipient-scoped only (a sent BROOST is never "unread" from the sender's
 *  perspective in this sense). */
broostsRouter.get('/unread', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM partner_broosts WHERE recipient_id = ? AND read_at IS NULL`)
    .get(userId) as { count: number };
  const recentRows = db
    .prepare(`SELECT * FROM partner_broosts WHERE recipient_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`)
    .all(userId, MAX_RECENT_UNREAD) as BroostRow[];
  res.json({
    count: countRow.count,
    recent: serializeBroostList(db, recentRows, userId),
  });
});

/** POST / — sends a BROOST to the caller's *current* accepted partner only (never an
 *  arbitrary recipient, and never to self). An optional reply reference must belong to the
 *  caller's received history and its sender must still be the current partner. Requires
 *  exactly one of a valid preset key or a non-empty custom message. Anti-spam (rolling 24h
 *  cap + 60s cooldown) is checked and the row inserted inside one transaction, so overlapping
 *  requests can never both slip past the same limit.
 *
 *  Responds `201` with `emailStatus: 'pending'` the instant the in-app row is committed —
 *  deliberately synchronous/non-async handler, so nothing here ever awaits the email provider
 *  on the request/response path. The actual send attempt is scheduled via `setImmediate`
 *  (see `scheduleImmediateBroostSend`) to run strictly *after* the response has gone out; a
 *  later send failure never rolls back the already-created, already-visible in-app BROOST —
 *  its `emailStatus` simply settles to `sent`/`failed` shortly afterward. This is honest
 *  at-least-once, best-effort-immediate delivery, not exactly-once. */
broostsRouter.post('/', (req, res) => {
  const db = getDb();
  const senderId = req.user!.id;

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const resolved = resolveBroostMessage(parsed.data);
  if (!resolved.ok) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  let broostId: number;
  try {
    const insert = db.transaction(() => {
      const partner = getAcceptedPartner(db, senderId);
      if (!partner) {
        throw new BroostTargetError(400, 'יש להתחבר לשותף/ה כדי לשלוח BROOST');
      }
      if (parsed.data.replyToBroostId !== undefined) {
        const original = db.prepare(
          'SELECT sender_id FROM partner_broosts WHERE id = ? AND recipient_id = ?'
        ).get(parsed.data.replyToBroostId, senderId) as { sender_id: number } | undefined;
        if (!original) {
          throw new BroostTargetError(404, 'ה-BROOST שאליו רצית להשיב לא נמצא');
        }
        if (original.sender_id !== partner.id) {
          throw new BroostTargetError(409, 'לא ניתן להשיב — השולח/ת כבר אינו/ה השותף/ה הנוכחי/ת');
        }
      }
      const rateLimit = checkBroostRateLimit(db, senderId, partner.id);
      if (rateLimit.limited) {
        throw new BroostRateLimitedError(rateLimit.error);
      }
      const info = db
        .prepare(
          `INSERT INTO partner_broosts
             (sender_id, recipient_id, partnership_id, preset_key, message, email_next_attempt_at)
           VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        )
        .run(senderId, partner.id, partner.partnershipId, resolved.presetKey, resolved.message);
      return Number(info.lastInsertRowid);
    });
    broostId = insert.immediate();
  } catch (err) {
    if (err instanceof BroostTargetError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof BroostRateLimitedError) {
      res.status(429).json({ error: err.message });
      return;
    }
    // A synchronous throw from a non-async handler is normally forwarded to Express's own
    // error middleware automatically — this explicit catch exists so a DB failure here gets
    // a specific, safe Hebrew message (never a raw error) rather than the generic fallback,
    // and so the sanitized detail is logged with the BROOST context for debugging.
    // eslint-disable-next-line no-console
    console.error(`[broosts] failed to create BROOST for sender ${senderId}: ${sanitizeError(err)}`);
    res.status(500).json({ error: 'שגיאה בשליחת ה-BROOST. יש לנסות שוב' });
    return;
  }

  try {
    const row = db.prepare('SELECT * FROM partner_broosts WHERE id = ?').get(broostId) as BroostRow;
    res.status(201).json(serializeBroost(db, row, senderId));
  } catch (err) {
    // The row was already committed above — a failure here is purely a read-back/
    // serialization problem, not a lost BROOST. Still surfaced as a safe 500 rather than
    // left to crash the process or hang the request.
    // eslint-disable-next-line no-console
    console.error(`[broosts] failed to load/serialize just-created BROOST ${broostId}: ${sanitizeError(err)}`);
    res.status(500).json({ error: 'ה-BROOST נשלח אך אירעה שגיאה בטעינתו. יש לרענן' });
    return;
  }

  // Scheduled *after* the response above has already been written — never on the
  // request/response critical path. See scheduleImmediateBroostSend's doc comment for the
  // full non-blocking-send + safety-net rationale.
  scheduleImmediateBroostSend(db, broostId);
});

/** POST /read-all — recipient-scoped: marks every currently-unread BROOST addressed to the
 *  caller as read. Never touches anyone else's rows (the WHERE clause is always scoped to
 *  `recipient_id = <caller>`). */
broostsRouter.post('/read-all', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const info = db
    .prepare(`UPDATE partner_broosts SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE recipient_id = ? AND read_at IS NULL`)
    .run(userId);
  res.json({ updated: info.changes });
});

/** POST /:id/read — marks one BROOST read. Recipient-only: the sender (who can otherwise see
 *  this row in their own "sent" history) is explicitly forbidden from marking it read on the
 *  recipient's behalf (403 — the row exists and they know it, just aren't allowed to act on
 *  it); a total stranger gets the same 404 as a nonexistent id, never leaking existence. */
broostsRouter.post('/:id/read', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'מזהה לא תקין' });
    return;
  }
  const row = db.prepare('SELECT * FROM partner_broosts WHERE id = ?').get(id) as BroostRow | undefined;
  if (!row || (row.sender_id !== req.user!.id && row.recipient_id !== req.user!.id)) {
    res.status(404).json({ error: 'ה-BROOST לא נמצא' });
    return;
  }
  if (row.recipient_id !== req.user!.id) {
    res.status(403).json({ error: 'רק הנמען/ת יכול/ה לסמן BROOST כנקרא' });
    return;
  }

  if (row.read_at === null) {
    db.prepare(`UPDATE partner_broosts SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
  }
  const updated = db.prepare('SELECT * FROM partner_broosts WHERE id = ?').get(id) as BroostRow;
  res.json(serializeBroost(db, updated, req.user!.id));
});
