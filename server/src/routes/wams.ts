import { Router, type Request, type Response, type RequestHandler } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getEmailConfig } from '../config.js';
import {
  wamCreateSchema,
  wamContentUpdateSchema,
  wamRatingSchema,
  wamCompleteSchema,
  commitmentCreateSchema,
  commitmentUpdateSchema,
  punishmentCreateSchema,
  punishmentUpdateSchema,
  punishmentToggleSchema,
} from '../lib/validation.js';
import {
  getAcceptedPartnershipForUser,
  isPartnershipMember,
  currentActiveCycleId,
  isCycleArchived,
  computeCycleWeekScore,
  type PartnershipInfo,
} from '../lib/wam.js';
import { buildStableWamCalendarUid, domainFromEmail } from '../lib/ics.js';
import { sendWamCalendarInvitations } from '../lib/wamCalendarInvites.js';
import { insertWamCompletionBackupIfAbsent } from '../lib/wamCompletionBackup.js';
import { computeDuoStreak, classifyWamOutcome, type DuoStreakSummary } from '../lib/duoStreak.js';
import { tReq } from '../lib/i18n/index.js';

export const wamsRouter = Router();
wamsRouter.use(requireAuth);

const HISTORICAL_LOCK_MESSAGE =
  'פגישה זו שייכת למחזור שכבר הסתיים ולכן היא נעולה כהיסטוריה בלתי ניתנת לעריכה';

interface WamRow {
  id: number;
  partnership_id: number;
  week: number;
  status: 'draft' | 'complete';
  wins: string;
  misses: string;
  blockers: string;
  lessons_learned: string;
  notes: string;
  adjustment_notes: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  initiator_cycle_id: number | null;
  invitee_cycle_id: number | null;
  next_wam_at: string | null;
  next_wam_duration_minutes: number | null;
  calendar_event_uid: string | null;
  calendar_event_sequence: number;
}

interface ReviewRow {
  wam_id: number;
  user_id: number;
  rating: number | null;
  score_snapshot: number | null;
  updated_at: string;
}

interface CommitmentRow {
  id: number;
  wam_id: number;
  scope: 'a' | 'b' | 'shared';
  label: string;
  done: number;
  sort_order: number;
}

interface PunishmentRow {
  id: number;
  source_wam_id: number;
  due_wam_id: number | null;
  author_user_id: number;
  assigned_user_id: number;
  label: string;
  done: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Precomputes a {userId: label} map for a partnership's two members (never more than two
 *  rows), reusing the app-wide displayName-with-email-fallback convention (see
 *  lib/userProfile.ts) — done once per request rather than once per punishment row. */
function loadParticipantLabels(db: ReturnType<typeof getDb>, partnership: PartnershipInfo): Record<number, string> {
  const rows = db
    .prepare('SELECT id, email, display_name FROM users WHERE id IN (?, ?)')
    .all(partnership.initiatorId, partnership.inviteeId) as { id: number; email: string; display_name: string | null }[];
  const labels: Record<number, string> = {};
  for (const row of rows) {
    labels[row.id] = row.display_name?.trim() || row.email;
  }
  return labels;
}

interface CelebrationProfile {
  userId: number;
  displayName: string;
  email: string;
  hasAvatar: boolean;
  avatarVersion: number;
}

/** Profile-safe fields for the Duo Streak card and post-completion celebration — never
 *  includes bio, avatar bytes, or the password hash. Mirrors `loadUserProfile`'s shape minus
 *  the fields those two features don't need (bio, personal successStreak), so the client's
 *  existing `Avatar` component can render it directly from `displayName`/`email`/`hasAvatar`/
 *  `avatarVersion` exactly as it already does for the logged-in user's own profile. */
function loadCelebrationProfile(db: ReturnType<typeof getDb>, userId: number): CelebrationProfile {
  const row = db.prepare('SELECT id, email, display_name, avatar_mime, avatar_version FROM users WHERE id = ?').get(userId) as
    | { id: number; email: string; display_name: string; avatar_mime: string | null; avatar_version: number }
    | undefined;
  return {
    userId,
    displayName: row?.display_name ?? '',
    email: row?.email ?? '',
    hasAvatar: row?.avatar_mime !== null && row?.avatar_mime !== undefined,
    avatarVersion: row?.avatar_version ?? 0,
  };
}

/** Builds the wire-format Duo Streak summary (numbers + both participants' profiles) for a
 *  partnership — shared by the WAM list envelope and every WAM detail response. */
function buildDuoStreakResponse(db: ReturnType<typeof getDb>, partnership: PartnershipInfo) {
  const summary: DuoStreakSummary = computeDuoStreak(db, partnership.id, partnership.initiatorId, partnership.inviteeId);
  return {
    ...summary,
    participants: [
      loadCelebrationProfile(db, partnership.initiatorId),
      loadCelebrationProfile(db, partnership.inviteeId),
    ] as [CelebrationProfile, CelebrationProfile],
  };
}

/** Builds the post-completion celebration descriptor from the exact frozen scores just written
 *  (never live/rounded) — a strict discriminated union so the client can render each variant
 *  without ever needing to re-derive "who won"/"was it a duo success" itself. Computing this
 *  after the completion transaction has already committed means `computeDuoStreak` here
 *  correctly includes the just-completed WAM, giving the true post-completion streak. */
function buildCelebration(db: ReturnType<typeof getDb>, partnership: PartnershipInfo, scoreA: number | null, scoreB: number | null) {
  const outcome = classifyWamOutcome(scoreA, scoreB);
  if (outcome === 'completion') {
    return { type: 'completion' as const };
  }
  const participantA = { ...loadCelebrationProfile(db, partnership.initiatorId), score: scoreA as number };
  const participantB = { ...loadCelebrationProfile(db, partnership.inviteeId), score: scoreB as number };
  if (outcome === 'duo-success') {
    const { currentStreak } = computeDuoStreak(db, partnership.id, partnership.initiatorId, partnership.inviteeId);
    return { type: 'duo-success' as const, participants: [participantA, participantB] as [typeof participantA, typeof participantB], currentStreak };
  }
  if (outcome === 'tie') {
    return { type: 'tie' as const, participants: [participantA, participantB] as [typeof participantA, typeof participantB] };
  }
  const winner = outcome === 'spotlight-a' ? participantA : participantB;
  const other = outcome === 'spotlight-a' ? participantB : participantA;
  return { type: 'spotlight' as const, winner, other };
}

/** Finds the "next WAM" for a partnership relative to a given WAM id — the smallest WAM id
 *  strictly greater than it in the same partnership — or null if none exists yet. Deliberately
 *  ID-based (never week-number-based) so it is correct across skipped weeks and cycle
 *  regenerations (see migration 016's header comment for the full rationale). */
function findNextWamId(db: ReturnType<typeof getDb>, partnershipId: number, afterWamId: number): WamRow | null {
  return (
    (db
      .prepare('SELECT * FROM wams WHERE partnership_id = ? AND id > ? ORDER BY id ASC LIMIT 1')
      .get(partnershipId, afterWamId) as WamRow | undefined) ?? null
  );
}

/** True only while a punishment's *due* WAM (not its source) is *currently* complete or
 *  historical — this is a live, reopen-aware check, not a "was ever completed" flag.
 *  Explicitly reopening the due WAM (`POST /:id/reopen`) puts it back into `draft` and this
 *  immediately returns false again, re-allowing source-side edits/reassign/delete — exactly
 *  the same product-consistent behavior already used for the due WAM's own shared content and
 *  commitments (draft/complete/reopen governs editability there too; there is no separate,
 *  stricter rule for punishments). The completed WAM's own immutable backup snapshot from its
 *  *first* completion (see wamCompletionBackup.ts) is unaffected either way — reopening never
 *  deletes or rewrites it, it only re-enables further editing going forward. Historical
 *  (archived-cycle) due WAMs have no reopen path at all, so they stay permanently frozen.
 *  Returns false for an unbound punishment (`dueWamId === null`) — nothing to freeze yet. */
function isDueWamFrozen(db: ReturnType<typeof getDb>, dueWamId: number | null): boolean {
  if (dueWamId === null) return false;
  const dueWam = db.prepare('SELECT * FROM wams WHERE id = ?').get(dueWamId) as WamRow | undefined;
  if (!dueWam) return false;
  return dueWam.status === 'complete' || isWamHistorical(db, dueWam);
}

function getPartnershipMeta(db: ReturnType<typeof getDb>, partnership: PartnershipInfo) {
  const initiator = db.prepare('SELECT email FROM users WHERE id = ?').get(partnership.initiatorId) as
    | { email: string }
    | undefined;
  const invitee = db.prepare('SELECT email FROM users WHERE id = ?').get(partnership.inviteeId) as
    | { email: string }
    | undefined;
  return {
    id: partnership.id,
    initiatorId: partnership.initiatorId,
    inviteeId: partnership.inviteeId,
    initiatorEmail: initiator?.email ?? '',
    inviteeEmail: invitee?.email ?? '',
  };
}

/** True once either side's referenced cycle has since been archived — the meeting is then
 *  permanent, fully locked history (stronger than, and independent of, the draft/complete
 *  lifecycle lock, which is only about the meeting's own completion state). */
function isWamHistorical(db: ReturnType<typeof getDb>, wam: WamRow): boolean {
  return isCycleArchived(db, wam.initiator_cycle_id) || isCycleArchived(db, wam.invitee_cycle_id);
}

function serializeWamSummary(db: ReturnType<typeof getDb>, wam: WamRow, partnership: PartnershipInfo) {
  const reviews = db.prepare('SELECT * FROM wam_reviews WHERE wam_id = ?').all(wam.id) as ReviewRow[];
  const reviewA = reviews.find((r) => r.user_id === partnership.initiatorId);
  const reviewB = reviews.find((r) => r.user_id === partnership.inviteeId);
  const commitments = db
    .prepare('SELECT done FROM wam_commitments WHERE wam_id = ?')
    .all(wam.id) as { done: number }[];
  const duePunishments = db
    .prepare('SELECT done FROM wam_punishments WHERE due_wam_id = ?')
    .all(wam.id) as { done: number }[];

  return {
    id: wam.id,
    week: wam.week,
    status: wam.status,
    isHistorical: isWamHistorical(db, wam),
    updatedAt: wam.updated_at,
    completedAt: wam.completed_at,
    ratingA: reviewA?.rating ?? null,
    ratingB: reviewB?.rating ?? null,
    scoreSnapshotA: reviewA?.score_snapshot ?? null,
    scoreSnapshotB: reviewB?.score_snapshot ?? null,
    commitmentsTotal: commitments.length,
    commitmentsDone: commitments.filter((c) => c.done === 1).length,
    punishmentsDueTotal: duePunishments.length,
    punishmentsDueDone: duePunishments.filter((p) => p.done === 1).length,
  };
}

interface CalendarInvitationRow {
  status: 'sent' | 'failed';
  error: string | null;
  event_sequence: number;
  sent_at: string | null;
}

/** Only reports a status if it belongs to the WAM's *current* calendar_event_sequence — a
 *  leftover row from a since-changed schedule generation must never be shown as if it applied
 *  to the current one (see migration 008). */
function getCalendarInvitationStatus(
  db: ReturnType<typeof getDb>,
  wamId: number,
  userId: number,
  currentSequence: number
): { status: 'sent' | 'failed' | null; error: string | null; sentAt: string | null } {
  const row = db
    .prepare('SELECT status, error, event_sequence, sent_at FROM wam_calendar_invitations WHERE wam_id = ? AND recipient_user_id = ?')
    .get(wamId, userId) as CalendarInvitationRow | undefined;
  if (!row || row.event_sequence !== currentSequence) {
    return { status: null, error: null, sentAt: null };
  }
  return { status: row.status, error: row.error, sentAt: row.sent_at };
}

/** True exactly when a NEW punishment could ever be checked off if added to `wam` right now —
 *  `wam` itself must be an editable draft, non-historical source, AND its own next-WAM
 *  candidate (if one already exists) must not itself be frozen (complete/historical), since a
 *  punishment bound to an already-frozen due WAM could never be toggled. Shared by both the
 *  create route's hard rejection and the serialized `canAddPunishment` flag the client uses to
 *  hide/explain the composer proactively, so the two can never drift apart. */
function canAddPunishmentToWam(db: ReturnType<typeof getDb>, wam: WamRow, partnership: PartnershipInfo): boolean {
  if (wam.status !== 'draft' || isWamHistorical(db, wam)) return false;
  const candidate = findNextWamId(db, partnership.id, wam.id);
  return !isDueWamFrozen(db, candidate?.id ?? null);
}

function serializeWamDetail(db: ReturnType<typeof getDb>, wam: WamRow, partnership: PartnershipInfo, viewerId: number) {
  const reviews = db.prepare('SELECT * FROM wam_reviews WHERE wam_id = ?').all(wam.id) as ReviewRow[];
  const reviewA = reviews.find((r) => r.user_id === partnership.initiatorId);
  const reviewB = reviews.find((r) => r.user_id === partnership.inviteeId);
  const meta = getPartnershipMeta(db, partnership);

  const liveA = computeCycleWeekScore(db, wam.initiator_cycle_id, wam.week);
  const liveB = computeCycleWeekScore(db, wam.invitee_cycle_id, wam.week);

  const commitments = (
    db
      .prepare('SELECT * FROM wam_commitments WHERE wam_id = ? ORDER BY sort_order ASC, id ASC')
      .all(wam.id) as CommitmentRow[]
  ).map((c) => ({ id: c.id, scope: c.scope, label: c.label, done: c.done === 1 }));

  const historical = isWamHistorical(db, wam);
  const participantLabels = loadParticipantLabels(db, partnership);
  const punishments = (
    db
      .prepare('SELECT * FROM wam_punishments WHERE source_wam_id = ? ORDER BY id ASC')
      .all(wam.id) as PunishmentRow[]
  ).map((p) => ({
    id: p.id,
    label: p.label,
    done: p.done === 1,
    completedAt: p.completed_at,
    dueWamId: p.due_wam_id,
    authorUserId: p.author_user_id,
    authorLabel: participantLabels[p.author_user_id] ?? '',
    assignedUserId: p.assigned_user_id,
    assigneeLabel: participantLabels[p.assigned_user_id] ?? '',
    // False while the *due* WAM (not just the source) is currently complete/historical —
    // otherwise a source-side edit/reassign/delete could diverge from a due WAM whose
    // checklist is currently frozen. This is reopen-aware: see isDueWamFrozen().
    canEdit: p.author_user_id === viewerId && wam.status === 'draft' && !historical && !isDueWamFrozen(db, p.due_wam_id),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
  const duePunishments = (
    db
      .prepare(
        `SELECT p.*, s.week as source_week FROM wam_punishments p
         JOIN wams s ON s.id = p.source_wam_id
         WHERE p.due_wam_id = ? ORDER BY p.id ASC`
      )
      .all(wam.id) as (PunishmentRow & { source_week: number })[]
  ).map((p) => ({
    id: p.id,
    label: p.label,
    done: p.done === 1,
    completedAt: p.completed_at,
    sourceWamId: p.source_wam_id,
    sourceWeek: p.source_week,
    authorUserId: p.author_user_id,
    authorLabel: participantLabels[p.author_user_id] ?? '',
    assignedUserId: p.assigned_user_id,
    assigneeLabel: participantLabels[p.assigned_user_id] ?? '',
    canToggle: p.assigned_user_id === viewerId && wam.status === 'draft' && !historical,
  }));

  const mismatch = Boolean(
    liveA.hasCycle && liveB.hasCycle && liveA.currentWeek !== null && liveB.currentWeek !== null && liveA.currentWeek !== liveB.currentWeek
  );

  return {
    id: wam.id,
    week: wam.week,
    status: wam.status,
    isHistorical: isWamHistorical(db, wam),
    wins: wam.wins,
    misses: wam.misses,
    blockers: wam.blockers,
    lessonsLearned: wam.lessons_learned,
    notes: wam.notes,
    adjustmentNotes: wam.adjustment_notes,
    createdAt: wam.created_at,
    updatedAt: wam.updated_at,
    completedAt: wam.completed_at,
    partnership: meta,
    mismatch,
    nextWam: {
      at: wam.next_wam_at,
      durationMinutes: wam.next_wam_duration_minutes,
      sequence: wam.calendar_event_sequence,
    },
    calendarInvitations: {
      a: getCalendarInvitationStatus(db, wam.id, partnership.initiatorId, wam.calendar_event_sequence),
      b: getCalendarInvitationStatus(db, wam.id, partnership.inviteeId, wam.calendar_event_sequence),
    },
    reviews: {
      a: {
        userId: partnership.initiatorId,
        email: meta.initiatorEmail,
        rating: reviewA?.rating ?? null,
        scoreSnapshot: reviewA?.score_snapshot ?? null,
        live: liveA,
      },
      b: {
        userId: partnership.inviteeId,
        email: meta.inviteeEmail,
        rating: reviewB?.rating ?? null,
        scoreSnapshot: reviewB?.score_snapshot ?? null,
        live: liveB,
      },
    },
    commitments,
    punishments,
    duePunishments,
    canAddPunishment: canAddPunishmentToWam(db, wam, partnership),
    duoStreak: buildDuoStreakResponse(db, partnership),
  };
}

/** Loads a WAM and verifies the caller is a member of the owning partnership (which, if it
 *  still exists, is by construction a mutual pairing — removal deletes the row outright). */
function loadWamForMember(
  db: ReturnType<typeof getDb>,
  wamId: number,
  userId: number
): { wam: WamRow; partnership: PartnershipInfo } | null {
  const wam = db.prepare('SELECT * FROM wams WHERE id = ?').get(wamId) as WamRow | undefined;
  if (!wam) return null;
  const partnership = db
    .prepare(`SELECT id, initiator_id as initiatorId, invitee_id as inviteeId FROM partnerships WHERE id = ?`)
    .get(wam.partnership_id) as PartnershipInfo | undefined;
  if (!partnership || !isPartnershipMember(partnership, userId)) return null;
  return { wam, partnership };
}

/** GET / — history list for the caller's accepted partnership (empty if no partner). May
 *  include several entries for the same week number across different cycle generations. */
wamsRouter.get('/', (req, res) => {
  const db = getDb();
  const partnership = getAcceptedPartnershipForUser(db, req.user!.id);
  if (!partnership) {
    res.json({ partnership: null, wams: [], duoStreak: null });
    return;
  }
  const rows = db
    .prepare('SELECT * FROM wams WHERE partnership_id = ? ORDER BY week ASC, created_at ASC')
    .all(partnership.id) as WamRow[];
  res.json({
    partnership: getPartnershipMeta(db, partnership),
    wams: rows.map((w) => serializeWamSummary(db, w, partnership)),
    duoStreak: buildDuoStreakResponse(db, partnership),
  });
});

/** GET /search?q= — simple substring search across notes fields and commitment labels. */
wamsRouter.get('/search', (req, res) => {
  const db = getDb();
  const q = String(req.query.q ?? '').trim();
  const partnership = getAcceptedPartnershipForUser(db, req.user!.id);
  if (!partnership || q.length === 0) {
    res.json({ results: [] });
    return;
  }
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT DISTINCT w.* FROM wams w
       LEFT JOIN wam_commitments c ON c.wam_id = w.id
       WHERE w.partnership_id = ?
         AND (
           w.wins LIKE ? OR w.misses LIKE ? OR w.blockers LIKE ? OR w.lessons_learned LIKE ?
           OR w.notes LIKE ? OR w.adjustment_notes LIKE ? OR c.label LIKE ?
           OR EXISTS (SELECT 1 FROM wam_punishments p WHERE p.source_wam_id = w.id AND p.label LIKE ?)
           OR EXISTS (SELECT 1 FROM wam_punishments p WHERE p.due_wam_id = w.id AND p.label LIKE ?)
         )
       ORDER BY w.week ASC`
    )
    .all(partnership.id, like, like, like, like, like, like, like, like, like) as WamRow[];
  res.json({ results: rows.map((w) => serializeWamSummary(db, w, partnership)) });
});

/** POST / { week } — creates the shared draft WAM for this week using each partner's
 *  *currently* active cycle, or returns the existing meeting for that same combination if
 *  one was already started (idempotent). Once either partner resets their cycle, this
 *  produces a brand-new meeting for the same week number rather than reusing old history. */
wamsRouter.post('/', (req, res) => {
  const parsed = wamCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const partnership = getAcceptedPartnershipForUser(db, req.user!.id);
  if (!partnership) {
    res.status(409).json({ error: 'נדרש שותף/ה מאושר/ת כדי לקיים פגישת אחריותיות' });
    return;
  }
  const { week } = parsed.data;
  const initiatorCycleId = currentActiveCycleId(db, partnership.initiatorId);
  const inviteeCycleId = currentActiveCycleId(db, partnership.inviteeId);

  const existing = db
    .prepare(
      `SELECT * FROM wams
       WHERE partnership_id = ? AND week = ? AND initiator_cycle_id IS ? AND invitee_cycle_id IS ?`
    )
    .get(partnership.id, week, initiatorCycleId, inviteeCycleId) as WamRow | undefined;

  if (existing) {
    res.status(200).json(serializeWamDetail(db, existing, partnership, req.user!.id));
    return;
  }

  const created = db.transaction(() => {
    const info = db
      .prepare(
        'INSERT INTO wams (partnership_id, week, initiator_cycle_id, invitee_cycle_id) VALUES (?, ?, ?, ?)'
      )
      .run(partnership.id, week, initiatorCycleId, inviteeCycleId);
    const wamId = Number(info.lastInsertRowid);
    const insertReview = db.prepare('INSERT INTO wam_reviews (wam_id, user_id) VALUES (?, ?)');
    insertReview.run(wamId, partnership.initiatorId);
    insertReview.run(wamId, partnership.inviteeId);
    // Bind every still-unbound punishment authored in any earlier WAM of this same
    // partnership to the meeting we just created. Filtering on `due_wam_id IS NULL` both
    // picks up punishments from meetings that were skipped over (no WAM existed yet to bind
    // them to) and guarantees an already-bound punishment is never rebound.
    db.prepare(
      `UPDATE wam_punishments SET due_wam_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE due_wam_id IS NULL AND source_wam_id IN (
         SELECT id FROM wams WHERE partnership_id = ? AND id < ?
       )`
    ).run(wamId, partnership.id, wamId);
    return wamId;
  })();

  const wam = db.prepare('SELECT * FROM wams WHERE id = ?').get(created) as WamRow;
  res.status(201).json(serializeWamDetail(db, wam, partnership, req.user!.id));
});

/** GET /by-week/:week — convenience lookup for *this week's* meeting under each partner's
 *  currently active cycle. Older meetings from a since-archived cycle are only reachable via
 *  the general list/history, never through this "current" shortcut. */
wamsRouter.get('/by-week/:week', (req, res) => {
  const week = Number(req.params.week);
  if (!Number.isInteger(week) || week < 1 || week > 12) {
    res.status(400).json({ error: 'שבוע לא תקין' });
    return;
  }
  const db = getDb();
  const partnership = getAcceptedPartnershipForUser(db, req.user!.id);
  if (!partnership) {
    res.status(404).json({ error: 'אין שותף/ה מאושר/ת' });
    return;
  }
  const initiatorCycleId = currentActiveCycleId(db, partnership.initiatorId);
  const inviteeCycleId = currentActiveCycleId(db, partnership.inviteeId);
  const wam = db
    .prepare(
      `SELECT * FROM wams
       WHERE partnership_id = ? AND week = ? AND initiator_cycle_id IS ? AND invitee_cycle_id IS ?`
    )
    .get(partnership.id, week, initiatorCycleId, inviteeCycleId) as WamRow | undefined;
  if (!wam) {
    res.status(404).json({ error: 'עדיין לא נוצרה פגישה לשבוע זה' });
    return;
  }
  res.json(serializeWamDetail(db, wam, partnership, req.user!.id));
});

wamsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  res.json(serializeWamDetail(db, found.wam, found.partnership, req.user!.id));
});

wamsRouter.patch('/:id', (req, res) => {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (found.wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה לפני עריכת התוכן' });
    return;
  }
  const parsed = wamContentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const fieldMap: Record<string, string> = {
    wins: 'wins',
    misses: 'misses',
    blockers: 'blockers',
    lessonsLearned: 'lessons_learned',
    notes: 'notes',
    adjustmentNotes: 'adjustment_notes',
  };
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(fieldMap)) {
    const value = (parsed.data as Record<string, string | undefined>)[key];
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (updates.length > 0) {
    values.push(found.wam.id);
    db.prepare(
      `UPDATE wams SET ${updates.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(...values);
  }
  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(found.wam.id) as WamRow;
  res.json(serializeWamDetail(db, updated, found.partnership, req.user!.id));
});

// The service runs one Node process. A per-database lock covers the asynchronous email
// window, so two partners cannot send competing invitations or freeze this WAM twice.
const completingWams = new WeakMap<ReturnType<typeof getDb>, Set<number>>();

function lockedWamAction(scheduleOnly: boolean): RequestHandler {
  return (req, res, next) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!loadWamForMember(db, id, req.user!.id)) {
      res.status(404).json({ error: 'הפגישה לא נמצאה' });
      return;
    }
    const active = completingWams.get(db) ?? new Set<number>();
    completingWams.set(db, active);
    if (active.has(id)) {
      res.status(409).json({ error: 'עדכון הפגישה כבר מתבצע. נא להמתין ולרענן' });
      return;
    }
    active.add(id);
    void completeWam(req, res, scheduleOnly).catch(next).finally(() => active.delete(id));
  };
}

wamsRouter.post('/:id/complete', lockedWamAction(false));
wamsRouter.put('/:id/next-wam', lockedWamAction(true));

async function completeWam(req: Request, res: Response, scheduleOnly: boolean) {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  // Scheduling the next meeting is independent of freezing this one: a draft may send
  // invitations without being completed, and a completed WAM may still be rescheduled.
  if (!scheduleOnly && found.wam.status === 'complete') {
    res.status(409).json({ error: 'הפגישה כבר הושלמה. יש לפתוח מחדש כדי לעדכן ולהשלים שוב' });
    return;
  }
  const parsed = wamCompleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const { nextWamAt, nextWamDurationMinutes } = parsed.data;
  if (scheduleOnly && !nextWamAt) {
    res.status(400).json({ error: 'יש לבחור מועד לפגישה הבאה. אין תמיכה בביטול תיאום קיים' });
    return;
  }
  if (nextWamAt) {
    const dt = new Date(nextWamAt);
    if (Number.isNaN(dt.getTime()) || dt.getTime() <= Date.now()) {
      res.status(400).json({ error: 'מועד הפגישה הבאה חייב להיות בעתיד' });
      return;
    }
  }
  if (!nextWamAt && found.wam.next_wam_at) {
    res.status(400).json({
      error:
        'לא ניתן להשלים את הפגישה ללא תיאום לאחר שכבר נקבע מועד לפגישה הבאה. ניתן לשנות את המועד, אך לא לבטלו — אין תמיכה בביטול הזמנות יומן שכבר נשלחו.',
    });
    return;
  }

  const { partnership, wam } = found;

  if (nextWamAt) {
    let emailConfig;
    try {
      emailConfig = getEmailConfig();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'תצורת דוא"ל לשליחת הזמנות חסרה' });
      return;
    }

    const duration = nextWamDurationMinutes ?? 60;
    const scheduleChanged = Boolean(
      wam.next_wam_at && (wam.next_wam_at !== nextWamAt || wam.next_wam_duration_minutes !== duration)
    );
    const uid = wam.calendar_event_uid ?? buildStableWamCalendarUid(wam.id, domainFromEmail(emailConfig.senderAddress));
    const sequence = wam.calendar_event_uid && scheduleChanged ? wam.calendar_event_sequence + 1 : wam.calendar_event_sequence;

    db.prepare(
      `UPDATE wams SET next_wam_at = ?, next_wam_duration_minutes = ?, calendar_event_uid = ?, calendar_event_sequence = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(nextWamAt, duration, uid, sequence, wam.id);

    const meta = getPartnershipMeta(db, partnership);
    const recipients = [
      { userId: partnership.initiatorId, email: meta.initiatorEmail },
      { userId: partnership.inviteeId, email: meta.inviteeEmail },
    ];

    const inviteResult = await sendWamCalendarInvitations(
      db,
      { id: wam.id, nextWamAt, nextWamDurationMinutes: duration, calendarEventUid: uid, calendarEventSequence: sequence },
      recipients
    );

    // The partnership/cycle may have changed while the email service was responding.
    const current = loadWamForMember(db, wam.id, req.user!.id);
    if (!current) {
      res.status(404).json({ error: 'הפגישה לא נמצאה' });
      return;
    }
    if (isWamHistorical(db, current.wam)) {
      res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
      return;
    }
    if (current.wam.status !== wam.status) {
      res.status(409).json({ error: 'מצב הפגישה השתנה. יש לרענן לפני ניסיון נוסף' });
      return;
    }

    if (!inviteResult.allSucceeded) {
      const updatedWam = db.prepare('SELECT * FROM wams WHERE id = ?').get(wam.id) as WamRow;
      res.status(502).json({
        error: scheduleOnly
          ? 'התיאום נשמר, אך חלק מההזמנות לא נשלחו. ניתן לנסות שוב; מצב הפגישה והציונים השמורים לא השתנו.'
          : 'שליחת הזמנות היומן נכשלה עבור לפחות אחד/ת מהמשתתפים. הפגישה נשארה כטיוטה — ניתן לנסות שוב.',
        wam: serializeWamDetail(db, updatedWam, partnership, req.user!.id),
      });
      return;
    }
  }

  // Calendar-only changes must never re-freeze reviews, replace a completion backup,
  // change completion time/streaks, or emit another completion celebration.
  if (scheduleOnly) {
    const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(wam.id) as WamRow;
    res.json({ wam: serializeWamDetail(db, updated, partnership, req.user!.id) });
    return;
  }

  const scoreA = computeCycleWeekScore(db, wam.initiator_cycle_id, wam.week).score;
  const scoreB = computeCycleWeekScore(db, wam.invitee_cycle_id, wam.week).score;

  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE wam_reviews SET score_snapshot = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE wam_id = ? AND user_id = ?`
      ).run(scoreA, wam.id, partnership.initiatorId);
      db.prepare(
        `UPDATE wam_reviews SET score_snapshot = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE wam_id = ? AND user_id = ?`
      ).run(scoreB, wam.id, partnership.inviteeId);
      db.prepare(
        `UPDATE wams SET status = 'complete', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).run(wam.id);
      // Read back the just-written row rather than computing a second, separately-evaluated
      // timestamp — this is the exact frozen completed_at now persisted on the WAM itself,
      // used below as durable scalar metadata on the backup row (see migration 012).
      const justCompleted = db.prepare('SELECT week, completed_at FROM wams WHERE id = ?').get(wam.id) as {
        week: number;
        completed_at: string;
      };
      // Runs *after* the updates above, inside this same transaction, so the immutable backup
      // snapshot captures the just-completed status and freshly-frozen score snapshots — and so
      // a failure while building it (e.g. the loud missing-table guard) rolls back the whole
      // completion, never leaving the WAM marked complete with no corresponding backup.
      insertWamCompletionBackupIfAbsent(db, {
        id: wam.id,
        week: justCompleted.week,
        completedAt: justCompleted.completed_at,
      });
    })();
  } catch (err) {
    // A synchronous throw here (e.g. the backup snapshot's loud missing-table guard) is
    // caught explicitly rather than left to propagate out of this `async` handler — an
    // uncaught throw inside an async Express handler becomes a silently-unhandled promise
    // rejection with no response ever sent, hanging the caller, since Express does not
    // automatically forward async rejections to error middleware. better-sqlite3's
    // transaction wrapper has already rolled back every write above by the time we get here.
    // eslint-disable-next-line no-console
    console.error(
      `[wams] failed to complete WAM ${wam.id}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    res.status(500).json({ error: 'שגיאה בהשלמת הפגישה. נא לנסות שוב' });
    return;
  }

  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(wam.id) as WamRow;
  // Celebration is attached only to this specific successful-completion response — never to
  // GET /:id or the list — so the client can distinguish "just completed via this mutation"
  // from "merely opened/reloaded an already-complete WAM" without any extra bookkeeping.
  res.json({
    wam: serializeWamDetail(db, updated, partnership, req.user!.id),
    celebration: buildCelebration(db, partnership, scoreA, scoreB),
  });
}

wamsRouter.post('/:id/reopen', (req, res) => {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (completingWams.get(db)?.has(found.wam.id)) {
    res.status(409).json({ error: 'עדכון הפגישה כבר מתבצע. נא להמתין ולרענן' });
    return;
  }
  if (found.wam.status === 'draft') {
    res.status(409).json({ error: 'הפגישה כבר במצב טיוטה' });
    return;
  }
  db.prepare(
    `UPDATE wams SET status = 'draft', completed_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(found.wam.id);
  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(found.wam.id) as WamRow;
  res.json(serializeWamDetail(db, updated, found.partnership, req.user!.id));
});

/** PATCH /:id/rating — always writes to the caller's own review row; the partner's rating
 *  can never be targeted since the user id is derived from the session, not the request body. */
wamsRouter.patch('/:id/rating', (req, res) => {
  const parsed = wamRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  db.prepare(
    `UPDATE wam_reviews SET rating = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE wam_id = ? AND user_id = ?`
  ).run(parsed.data.rating, found.wam.id, req.user!.id);
  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(found.wam.id) as WamRow;
  res.json(serializeWamDetail(db, updated, found.partnership, req.user!.id));
});

wamsRouter.post('/:id/commitments', (req, res) => {
  const parsed = commitmentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (found.wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי להוסיף התחייבויות' });
    return;
  }
  const count = (
    db.prepare('SELECT COUNT(*) as c FROM wam_commitments WHERE wam_id = ?').get(found.wam.id) as { c: number }
  ).c;
  const info = db
    .prepare('INSERT INTO wam_commitments (wam_id, scope, label, sort_order) VALUES (?, ?, ?, ?)')
    .run(found.wam.id, parsed.data.scope, parsed.data.label, count);
  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(found.wam.id) as WamRow;
  res.status(201).json({ commitmentId: info.lastInsertRowid, wam: serializeWamDetail(db, updated, found.partnership, req.user!.id) });
});

wamsRouter.patch('/:id/commitments/:commitmentId', (req, res) => {
  const parsed = commitmentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  const commitmentId = Number(req.params.commitmentId);
  const commitment = db
    .prepare('SELECT * FROM wam_commitments WHERE id = ? AND wam_id = ?')
    .get(commitmentId, found.wam.id) as CommitmentRow | undefined;
  if (!commitment) {
    res.status(404).json({ error: 'ההתחייבות לא נמצאה' });
    return;
  }

  const { label, scope, done } = parsed.data;
  const changingContent = label !== undefined || scope !== undefined;
  if (changingContent && found.wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי לערוך את תוכן ההתחייבות' });
    return;
  }

  db.prepare(
    `UPDATE wam_commitments SET
       label = COALESCE(?, label),
       scope = COALESCE(?, scope),
       done = COALESCE(?, done),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(label ?? null, scope ?? null, done === undefined ? null : done ? 1 : 0, commitmentId);

  const updated = db.prepare('SELECT * FROM wams WHERE id = ?').get(found.wam.id) as WamRow;
  res.json(serializeWamDetail(db, updated, found.partnership, req.user!.id));
});

wamsRouter.delete('/:id/commitments/:commitmentId', (req, res) => {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  if (isWamHistorical(db, found.wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (found.wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי למחוק התחייבות' });
    return;
  }
  const commitmentId = Number(req.params.commitmentId);
  const result = db
    .prepare('DELETE FROM wam_commitments WHERE id = ? AND wam_id = ?')
    .run(commitmentId, found.wam.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'ההתחייבות לא נמצאה' });
    return;
  }
  res.status(204).end();
});

/** POST /:id/punishments — either partnership member may add a punishment during a draft,
 *  non-historical source WAM, assigning it to themself or the other member (server-validated
 *  against the WAM's own partnership; the author is always the session's own id, never
 *  client-supplied). If a later WAM already exists for this partnership and it is already
 *  complete or historical, the punishment could never be checked off, so creation is
 *  rejected outright rather than silently producing a dead checklist item. */
wamsRouter.post('/:id/punishments', (req, res) => {
  const parsed = punishmentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  const { wam, partnership } = found;
  if (isWamHistorical(db, wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי להוסיף עונשים' });
    return;
  }
  const { label, assignedUserId } = parsed.data;
  if (assignedUserId !== partnership.initiatorId && assignedUserId !== partnership.inviteeId) {
    res.status(400).json({ error: 'ניתן להטיל עונש רק על עצמך או על השותף/ה בפגישה זו' });
    return;
  }

  const candidate = findNextWamId(db, partnership.id, wam.id);
  if (isDueWamFrozen(db, candidate?.id ?? null)) {
    res.status(400).json({
      error: 'הפגישה הבאה כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן להוסיף עונש שלעולם לא יסומן',
    });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO wam_punishments (source_wam_id, due_wam_id, author_user_id, assigned_user_id, label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(wam.id, candidate?.id ?? null, req.user!.id, assignedUserId, label);
  res
    .status(201)
    .json({ punishmentId: info.lastInsertRowid, wam: serializeWamDetail(db, wam, partnership, req.user!.id) });
});

/** PATCH /:id/punishments/:punishmentId — author-only edit of label and/or assignee, only
 *  while the source WAM is still an editable draft and non-historical, AND the punishment's
 *  own *due* WAM (if already bound) is not *currently* complete/historical — while it is, the
 *  due-side checklist is frozen, so source-side edits must stop too rather than silently
 *  diverging from it. This is reopen-aware, not permanent: explicitly reopening the due WAM
 *  (consistent with how reopen already re-enables editing its own shared content/commitments)
 *  puts it back in draft and immediately re-allows this edit again; only an archived-cycle
 *  (historical) due WAM stays permanently locked. Reassigning to a different user atomically
 *  clears any prior done/completedAt — that attribution belonged to the previous assignee and
 *  must not carry over; updating any other field (or "reassigning" to the same current
 *  assignee) leaves done/completedAt untouched. */
wamsRouter.patch('/:id/punishments/:punishmentId', (req, res) => {
  const parsed = punishmentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  const { wam, partnership } = found;
  if (isWamHistorical(db, wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  const punishmentId = Number(req.params.punishmentId);
  const punishment = db
    .prepare('SELECT * FROM wam_punishments WHERE id = ? AND source_wam_id = ?')
    .get(punishmentId, wam.id) as PunishmentRow | undefined;
  if (!punishment) {
    res.status(404).json({ error: 'העונש לא נמצא' });
    return;
  }
  if (punishment.author_user_id !== req.user!.id) {
    res.status(403).json({ error: 'רק מי שכתב/ה את העונש יכול/ה לערוך אותו' });
    return;
  }
  if (wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי לערוך עונש' });
    return;
  }
  if (isDueWamFrozen(db, punishment.due_wam_id)) {
    res.status(400).json({
      error: 'הפגישה שאליה שויך העונש כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן עוד לערוך את העונש',
    });
    return;
  }
  const { label, assignedUserId } = parsed.data;
  if (assignedUserId !== undefined && assignedUserId !== partnership.initiatorId && assignedUserId !== partnership.inviteeId) {
    res.status(400).json({ error: 'ניתן להטיל עונש רק על עצמך או על השותף/ה בפגישה זו' });
    return;
  }
  const assigneeChanged = assignedUserId !== undefined && assignedUserId !== punishment.assigned_user_id;
  db.prepare(
    `UPDATE wam_punishments SET
       label = COALESCE(?, label),
       assigned_user_id = COALESCE(?, assigned_user_id),
       done = CASE WHEN ? THEN 0 ELSE done END,
       completed_at = CASE WHEN ? THEN NULL ELSE completed_at END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(label ?? null, assignedUserId ?? null, assigneeChanged ? 1 : 0, assigneeChanged ? 1 : 0, punishmentId);
  res.json(serializeWamDetail(db, wam, partnership, req.user!.id));
});

/** DELETE /:id/punishments/:punishmentId — author-only, same draft/non-historical guard as
 *  edit. */
wamsRouter.delete('/:id/punishments/:punishmentId', (req, res) => {
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  const { wam, partnership } = found;
  if (isWamHistorical(db, wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  const punishmentId = Number(req.params.punishmentId);
  const punishment = db
    .prepare('SELECT * FROM wam_punishments WHERE id = ? AND source_wam_id = ?')
    .get(punishmentId, wam.id) as PunishmentRow | undefined;
  if (!punishment) {
    res.status(404).json({ error: 'העונש לא נמצא' });
    return;
  }
  if (punishment.author_user_id !== req.user!.id) {
    res.status(403).json({ error: 'רק מי שכתב/ה את העונש יכול/ה למחוק אותו' });
    return;
  }
  if (wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי למחוק עונש' });
    return;
  }
  if (isDueWamFrozen(db, punishment.due_wam_id)) {
    res.status(400).json({
      error: 'הפגישה שאליה שויך העונש כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן עוד למחוק את העונש',
    });
    return;
  }
  db.prepare('DELETE FROM wam_punishments WHERE id = ?').run(punishmentId);
  res.json(serializeWamDetail(db, wam, partnership, req.user!.id));
});

/** PATCH /:id/due-punishments/:punishmentId — toggles a due punishment's done state. Only the
 *  assigned/punished user may toggle it (never the author merely by authorship), and only
 *  while the *due* WAM (this `:id`, not the punishment's source) is still a draft and
 *  non-historical. The query additionally requires `due_wam_id = :id` explicitly so a
 *  stale/cross-WAM punishment id can never be toggled through the wrong context. */
wamsRouter.patch('/:id/due-punishments/:punishmentId', (req, res) => {
  const parsed = punishmentToggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: tReq(req, parsed.error.issues[0]?.message ?? 'errors.validation.generic') });
    return;
  }
  const db = getDb();
  const found = loadWamForMember(db, Number(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: 'הפגישה לא נמצאה' });
    return;
  }
  const { wam, partnership } = found;
  if (isWamHistorical(db, wam)) {
    res.status(400).json({ error: HISTORICAL_LOCK_MESSAGE });
    return;
  }
  if (wam.status !== 'draft') {
    res.status(400).json({ error: 'יש לפתוח מחדש את הפגישה כדי לעדכן עונשים לביצוע' });
    return;
  }
  const punishmentId = Number(req.params.punishmentId);
  const punishment = db
    .prepare('SELECT * FROM wam_punishments WHERE id = ? AND due_wam_id = ?')
    .get(punishmentId, wam.id) as PunishmentRow | undefined;
  if (!punishment) {
    res.status(404).json({ error: 'העונש לא נמצא בפגישה זו' });
    return;
  }
  if (punishment.assigned_user_id !== req.user!.id) {
    res.status(403).json({ error: 'רק מי שהעונש הוטל עליו/ה יכול/ה לסמן אותו כבוצע' });
    return;
  }
  const { done } = parsed.data;
  // Idempotent: re-marking an already-done item done=true must preserve the *original*
  // completed_at (never bump it to "now" again), while done=false always clears it and a
  // later done=true after that records a genuinely new timestamp. Computed from the row
  // already read above and written in the same synchronous statement, so this is atomic —
  // no other request can observe or race an in-between state.
  const nextCompletedAt = done ? (punishment.done === 1 ? punishment.completed_at : new Date().toISOString()) : null;
  db.prepare(
    `UPDATE wam_punishments SET done = ?, completed_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(done ? 1 : 0, nextCompletedAt, punishmentId);
  res.json(serializeWamDetail(db, wam, partnership, req.user!.id));
});
