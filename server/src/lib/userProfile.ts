import type Database from 'better-sqlite3';
import { computeSuccessStreak } from './successStreak.js';
import { fallbackLocale, isLocale, type Locale } from './i18n/index.js';

export interface UserProfileResponse {
  id: number;
  email: string;
  displayName: string;
  bio: string;
  hasAvatar: boolean;
  avatarVersion: number;
  successStreak: number;
  /** Interface language. Also what emails to this user are written in. */
  locale: Locale;
}

interface UserProfileRow {
  id: number;
  email: string;
  display_name: string;
  bio: string;
  avatar_mime: string | null;
  avatar_version: number;
  locale: string;
}

/**
 * The single shared "profile-safe" user shape returned by every endpoint that hands the
 * client a user object: /auth/register, /auth/login, /auth/me, and the whole /api/profile
 * surface. Centralizing this avoids duplicating the profile fields + success-streak
 * computation logic across those routes. Never includes avatar bytes or the password hash.
 */
export function loadUserProfile(db: Database.Database, userId: number): UserProfileResponse | undefined {
  const row = db
    .prepare('SELECT id, email, display_name, bio, avatar_mime, avatar_version, locale FROM users WHERE id = ?')
    .get(userId) as UserProfileRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    bio: row.bio,
    hasAvatar: row.avatar_mime !== null,
    avatarVersion: row.avatar_version,
    successStreak: computeSuccessStreak(db, userId),
    locale: isLocale(row.locale) ? row.locale : fallbackLocale(),
  };
}
