import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getAllCyclesForUser,
  getGoalsForCycle,
  getTacticsForGoals,
  getTacticOverrides,
  getCompletionsForTactics,
} from '../lib/repo.js';
import { getAcceptedPartnershipForUser } from '../lib/wam.js';
import { loadUserProfile } from '../lib/userProfile.js';
import { serializeTacticEvidence, type TacticEvidenceRow } from '../lib/tacticEvidence.js';
import { listWeekEvidence, serializeWeekEvidence } from '../lib/weekEvidence.js';

export const exportRouter = Router();
exportRouter.use(requireAuth);

/**
 * GET /api/export — a complete, authenticated export of everything the caller owns as a
 * single JSON document: profile (id/email/display name/bio/avatar presence+version/success
 * streak — never the avatar image bytes, password hash, or session tokens), settings, every
 * cycle (active and archived) with its goals/tactics/completions, partnership status, and
 * every Weekly Accountability Meeting they participate in. No CSV, no import, no account
 * deletion — JSON download only (V1).
 *
 * Joint WAM data is included because the caller is a genuine participant in it, but the
 * partner's own private goals/tactics/completions are never included here — only what the
 * partner already exposes to the caller via the WAM review (email, rating, score snapshot).
 */
exportRouter.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const createdAtRow = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as {
    created_at: string;
  };
  // Reuses the same profile serializer as /auth/me and /api/profile — never duplicates this
  // logic, and (just like those routes) never includes avatar bytes or the password hash.
  const profile = loadUserProfile(db, userId)!;
  const settings = db.prepare('SELECT theme FROM user_settings WHERE user_id = ?').get(userId) as
    | { theme: string }
    | undefined;

  const cycles = getAllCyclesForUser(db, userId).map((cycle) => {
    const goals = getGoalsForCycle(db, cycle.id);
    const tactics = getTacticsForGoals(db, goals.map((g) => g.id));
    const tacticIds = tactics.map((t) => t.id);
    const completions = getCompletionsForTactics(db, tacticIds);
    const overrides = getTacticOverrides(db, tacticIds);
    const evidence = tacticIds.length === 0 ? [] : db.prepare(
      `SELECT * FROM tactic_evidence WHERE tactic_id IN (${tacticIds.map(() => '?').join(',')}) ORDER BY week, weekday`
    ).all(...tacticIds) as TacticEvidenceRow[];
    return {
      id: cycle.id,
      name: cycle.name,
      currentWeek: cycle.current_week,
      isActive: cycle.is_active === 1,
      createdAt: cycle.created_at,
      updatedAt: cycle.updated_at,
      weekEvidence: listWeekEvidence(db, cycle.id).map(serializeWeekEvidence),
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        tactics: tactics
          .filter((t) => t.goal_id === g.id)
          .map((t) => ({
            id: t.id,
            title: t.title,
            weekdays: JSON.parse(t.weekdays) as number[],
            startWeek: t.start_week,
            endWeek: t.end_week,
            adaptations: overrides
              .filter((override) => override.tactic_id === t.id)
              .map((override) => ({
                week: override.week,
                title: override.title,
                weekdays: JSON.parse(override.weekdays) as number[],
              })),
            completions: completions
              .filter((c) => c.tactic_id === t.id)
              .map((c) => ({ week: c.week, weekday: c.weekday, done: c.done === 1 })),
            evidence: evidence.filter((row) => row.tactic_id === t.id)
              .map((row) => ({ id: row.id, ...serializeTacticEvidence(row) })),
          })),
      })),
    };
  });

  const partnership = getAcceptedPartnershipForUser(db, userId);
  const partnershipExport = partnership
    ? (() => {
        const initiator = db.prepare('SELECT email FROM users WHERE id = ?').get(partnership.initiatorId) as
          | { email: string }
          | undefined;
        const invitee = db.prepare('SELECT email FROM users WHERE id = ?').get(partnership.inviteeId) as
          | { email: string }
          | undefined;
        return {
          id: partnership.id,
          initiatorEmail: initiator?.email ?? '',
          inviteeEmail: invitee?.email ?? '',
          myRole: partnership.initiatorId === userId ? 'initiator' : 'invitee',
        };
      })()
    : null;

  const wams = partnership
    ? (
        db
          .prepare('SELECT * FROM wams WHERE partnership_id = ? ORDER BY week ASC, created_at ASC')
          .all(partnership.id) as {
          id: number;
          week: number;
          status: string;
          wins: string;
          misses: string;
          blockers: string;
          lessons_learned: string;
          notes: string;
          adjustment_notes: string;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        }[]
      ).map((w) => {
        const reviews = db.prepare('SELECT * FROM wam_reviews WHERE wam_id = ?').all(w.id) as {
          user_id: number;
          rating: number | null;
          score_snapshot: number | null;
        }[];
        const commitments = db
          .prepare('SELECT scope, label, done FROM wam_commitments WHERE wam_id = ? ORDER BY sort_order ASC, id ASC')
          .all(w.id) as { scope: string; label: string; done: number }[];
        const punishments = db
          .prepare(
            `SELECT label, done, author_user_id, assigned_user_id, due_wam_id, completed_at, created_at, updated_at
             FROM wam_punishments WHERE source_wam_id = ? ORDER BY id ASC`
          )
          .all(w.id) as {
          label: string;
          done: number;
          author_user_id: number;
          assigned_user_id: number;
          due_wam_id: number | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        }[];
        return {
          id: w.id,
          week: w.week,
          status: w.status,
          wins: w.wins,
          misses: w.misses,
          blockers: w.blockers,
          lessonsLearned: w.lessons_learned,
          notes: w.notes,
          adjustmentNotes: w.adjustment_notes,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          completedAt: w.completed_at,
          reviews: reviews.map((r) => ({
            userId: r.user_id,
            isMe: r.user_id === userId,
            rating: r.rating,
            scoreSnapshot: r.score_snapshot,
          })),
          commitments: commitments.map((c) => ({ scope: c.scope, label: c.label, done: c.done === 1 })),
          punishments: punishments.map((p) => ({
            label: p.label,
            done: p.done === 1,
            authorUserId: p.author_user_id,
            isAuthorMe: p.author_user_id === userId,
            assignedUserId: p.assigned_user_id,
            isAssignedMe: p.assigned_user_id === userId,
            dueWamId: p.due_wam_id,
            completedAt: p.completed_at,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          })),
        };
      })
    : [];

  res.setHeader('Content-Disposition', `attachment; filename="12-week-dashboard-export-${userId}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    user: { ...profile, createdAt: createdAtRow.created_at },
    settings: { theme: settings?.theme ?? 'dark' },
    cycles,
    partnership: partnershipExport,
    weeklyAccountabilityMeetings: wams,
  });
});
