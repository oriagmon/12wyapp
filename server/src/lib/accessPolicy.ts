import { config } from '../config.js';

/** Operator-owned immutable user IDs, never email addresses supplied by a registrant.
 *  An absent setting is open only outside production; an explicitly empty setting is an
 *  error everywhere so a broken deployment cannot silently enable public registration. */
export function getAccessPolicy(): { allowedUserIds: ReadonlySet<number> | null; registrationOpen: boolean } {
  const raw = process.env.APP_ALLOWED_USER_IDS;
  if (raw === undefined && config.nodeEnv !== 'production') {
    return { allowedUserIds: null, registrationOpen: true };
  }
  const entries = raw?.split(',').map((entry) => entry.trim());
  if (!entries?.length || entries.some((entry) => !/^[1-9]\d*$/.test(entry) || !Number.isSafeInteger(Number(entry)))) {
    throw new Error('APP_ALLOWED_USER_IDS must contain a comma-separated list of operator-approved positive user IDs; required in production');
  }
  return { allowedUserIds: new Set(entries.map(Number)), registrationOpen: false };
}

export function isUserAdmitted(userId: number): boolean {
  const { allowedUserIds } = getAccessPolicy();
  return Number.isSafeInteger(userId) && userId > 0 && (allowedUserIds === null || allowedUserIds.has(userId));
}
