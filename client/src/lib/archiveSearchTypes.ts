export const ARCHIVE_SEARCH_CATEGORIES = ['cycles', 'goals', 'tactics', 'wams', 'commitments', 'punishments', 'reminders'] as const;
export type ArchiveSearchCategory = typeof ARCHIVE_SEARCH_CATEGORIES[number];

/** Resolve exact IDs, not a week in the current cycle. A WAM may predate a user's first cycle.
 * Goal/tactic IDs identify the matching row within a cycle; commitment/punishment IDs within a WAM. */
export type ArchiveSearchTarget =
  | { kind: 'cycle'; userId: number; cycleId: number; week: number; goalId?: number; tacticId?: number }
  | { kind: 'wam'; userId: number; cycleId: number | null; wamId: number; week: number; commitmentId?: number; punishmentId?: number }
  | { kind: 'reminder'; reminderId: number };

export interface ArchiveSearchItem {
  id: number;
  title: string;
  snippet: string;
  matchedField: string;
  cycleName: string | null;
  isArchived: boolean | null;
  ownership: 'mine' | 'partner' | 'shared';
  target: ArchiveSearchTarget;
}

export interface ArchiveSearchGroup {
  category: ArchiveSearchCategory;
  count: number;
  hasMore: boolean;
  items: ArchiveSearchItem[];
}

export interface ArchiveSearchResponse {
  query: string;
  limit: number;
  totalCount: number;
  groups: ArchiveSearchGroup[];
}
