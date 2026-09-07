import type Database from 'better-sqlite3';

export type AccessLevel = 'owner' | 'partner' | 'none';

/**
 * Determines what access `viewerId` has to `targetUserId`'s dashboard data.
 * - owner: viewerId === targetUserId
 * - partner: a mutual partnership exists between the two users (read-only)
 * - none: no relationship
 */
export function resolveAccess(db: Database.Database, viewerId: number, targetUserId: number): AccessLevel {
  if (viewerId === targetUserId) return 'owner';
  const row = db
    .prepare(
      `SELECT id FROM partnerships
       WHERE (initiator_id = ? AND invitee_id = ?) OR (initiator_id = ? AND invitee_id = ?)
       LIMIT 1`
    )
    .get(viewerId, targetUserId, targetUserId, viewerId);
  return row ? 'partner' : 'none';
}

export interface PartnerInfo {
  id: number;
  email: string;
  /** Empty when never set. Callers render it through the app-wide "display name, falling
   *  back to the email" convention rather than treating the email as the primary label. */
  displayName: string;
  partnershipId: number;
}

/** Returns the single partner for a user, if any (app enforces max one — see routes/partnerships.ts). */
export function getAcceptedPartner(db: Database.Database, userId: number): PartnerInfo | undefined {
  const row = db
    .prepare(
      `SELECT u.id as id, u.email as email, COALESCE(u.display_name, '') as displayName, p.id as partnershipId
       FROM partnerships p
       JOIN users u ON u.id = (CASE WHEN p.initiator_id = ? THEN p.invitee_id ELSE p.initiator_id END)
       WHERE p.initiator_id = ? OR p.invitee_id = ?
       LIMIT 1`
    )
    .get(userId, userId, userId) as PartnerInfo | undefined;
  return row;
}

