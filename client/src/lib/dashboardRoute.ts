import type { ArchiveSearchTarget } from './archiveSearchTypes';
import { translateActive } from '../i18n';

export const DASHBOARD_SECTIONS = [
  'home', 'planning', 'week', 'goals', 'history', 'wams',
  'cycleHistory', 'broosts', 'profile', 'reminders', 'search', 'monitoring',
] as const;
export type DashboardSection = typeof DASHBOARD_SECTIONS[number];

export type DashboardRouteDetail =
  | { kind: 'cycle'; cycleId: number; goalId?: number; tacticId?: number }
  | { kind: 'wam'; wamId: number; userId?: number; cycleId: number | null; commitmentId?: number; punishmentId?: number }
  | { kind: 'reminder'; reminderId: number };

export interface DashboardRoute {
  page: DashboardSection;
  /** null means the authenticated user's board, only for legacy/root links. */
  boardId: number | null;
  /** null uses the loaded cycle's current week, without writing history on data reload. */
  week: number | null;
  detail: DashboardRouteDetail | null;
}

export type ParsedDashboardRoute =
  | { ok: true; route: DashboardRoute }
  | { ok: false; error: string };

const ROUTE_KEYS = [
  'page', 'board', 'week', 'cycle', 'goal', 'tactic', 'wam', 'targetUser',
  'commitment', 'punishment', 'reminder',
] as const;
const invalidRoute = (): ParsedDashboardRoute => ({
  ok: false, error: translateActive('common.route.invalid'),
});
const isId = (value: number) => Number.isSafeInteger(value) && value > 0;
const isWeek = (value: number) => isId(value) && value <= 12;

export function normalizeDashboardSection(page: string): DashboardSection | null {
  if (page === 'planningRitual') return 'wams';
  return DASHBOARD_SECTIONS.includes(page as DashboardSection) ? page as DashboardSection : null;
}

export function rootDashboardRoute(): DashboardRoute {
  return { page: 'home', boardId: null, week: null, detail: null };
}

/** Strictly decodes location.search, not a URL containing credentials or fragments. */
export function parseDashboardRoute(search: string): ParsedDashboardRoute {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!ROUTE_KEYS.includes(key as typeof ROUTE_KEYS[number]) || params.getAll(key).length !== 1) return invalidRoute();
  }
  const page = normalizeDashboardSection(params.get('page') ?? 'home');
  if (!page) return invalidRoute();
  const numbers: Record<string, number> = {};
  for (const key of ROUTE_KEYS) {
    if (key === 'page' || !params.has(key)) continue;
    const value = params.get(key)!;
    if (!/^[1-9]\d*$/.test(value) || !isId(Number(value))) return invalidRoute();
    numbers[key] = Number(value);
  }
  if (numbers.week !== undefined && !isWeek(numbers.week)) return invalidRoute();
  const has = (key: typeof ROUTE_KEYS[number]) => params.has(key);
  if (
    (has('cycle') && page !== 'cycleHistory' && page !== 'wams') ||
    ((has('goal') || has('tactic')) && (page !== 'cycleHistory' || !has('cycle'))) ||
    (has('wam') && page !== 'wams') ||
    ((has('targetUser') || has('commitment') || has('punishment')) && !has('wam')) ||
    (page === 'wams' && has('cycle') && !has('wam')) ||
    (has('reminder') && page !== 'reminders')
  ) return invalidRoute();

  let detail: DashboardRouteDetail | null = null;
  if (page === 'cycleHistory' && has('cycle')) {
    detail = { kind: 'cycle', cycleId: numbers.cycle,
      ...(has('goal') ? { goalId: numbers.goal } : {}),
      ...(has('tactic') ? { tacticId: numbers.tactic } : {}) };
  } else if (page === 'wams' && has('wam')) {
    detail = { kind: 'wam', wamId: numbers.wam, cycleId: numbers.cycle ?? null,
      ...(has('targetUser') ? { userId: numbers.targetUser } : {}),
      ...(has('commitment') ? { commitmentId: numbers.commitment } : {}),
      ...(has('punishment') ? { punishmentId: numbers.punishment } : {}) };
  } else if (page === 'reminders' && has('reminder')) {
    detail = { kind: 'reminder', reminderId: numbers.reminder };
  }
  return { ok: true, route: {
    page, boardId: numbers.board ?? null, week: numbers.week ?? null, detail,
  } };
}

/** Serializes only navigation identifiers. Drafts, labels, search bodies and auth data never enter the URL. */
export function encodeDashboardRoute(route: DashboardRoute): string {
  const params = new URLSearchParams({ page: route.page });
  const set = (key: string, value: number | null | undefined) => {
    if (value !== null && value !== undefined) params.set(key, String(value));
  };
  set('board', route.boardId);
  set('week', route.week);
  const detail = route.detail;
  if (detail?.kind === 'cycle') {
    set('cycle', detail.cycleId); set('goal', detail.goalId); set('tactic', detail.tacticId);
  } else if (detail?.kind === 'wam') {
    set('wam', detail.wamId); set('targetUser', detail.userId); set('cycle', detail.cycleId);
    set('commitment', detail.commitmentId); set('punishment', detail.punishmentId);
  } else if (detail?.kind === 'reminder') {
    set('reminder', detail.reminderId);
  }
  const search = `?${params.toString()}`;
  if (!parseDashboardRoute(search).ok) throw new RangeError('Invalid dashboard route');
  return search;
}

export interface BoardRouteContext {
  ownUserId: number;
  partnerId: number | null;
  partnershipsLoading: boolean;
  partnershipsError?: string | null;
}
export type ResolvedDashboardBoard =
  | { status: 'ready'; userId: number; viewingOwn: boolean }
  | { status: 'loading'; userId: null; viewingOwn: false }
  | { status: 'unavailable'; userId: null; viewingOwn: false; error: string };

/** Do not translate "partner" into today's partner: bookmarks bind to one immutable user ID. */
export function resolveDashboardBoard(boardId: number | null, context: BoardRouteContext): ResolvedDashboardBoard {
  if (boardId === null || boardId === context.ownUserId) {
    return { status: 'ready', userId: context.ownUserId, viewingOwn: true };
  }
  if (context.partnershipsLoading) return { status: 'loading', userId: null, viewingOwn: false };
  if (context.partnershipsError) {
    return { status: 'unavailable', userId: null, viewingOwn: false,
      error: translateActive('common.route.unverifiable') };
  }
  if (boardId === context.partnerId) return { status: 'ready', userId: boardId, viewingOwn: false };
  return { status: 'unavailable', userId: null, viewingOwn: false,
    error: translateActive('common.route.unavailable') };
}

export function archiveTargetFromRoute(route: DashboardRoute, userId: number, ownUserId: number): ArchiveSearchTarget | null {
  const detail = route.detail;
  if (!detail) return null;
  if (detail.kind === 'reminder') return detail;
  if (detail.kind === 'cycle') return { ...detail, userId, week: route.week ?? 1 };
  return { ...detail, userId: detail.userId ?? ownUserId, week: route.week ?? 1 };
}

export function routeFromArchiveTarget(route: DashboardRoute, target: ArchiveSearchTarget): DashboardRoute {
  if (target.kind === 'cycle') {
    const { userId, week, ...detail } = target;
    return { ...route, page: 'cycleHistory', boardId: userId, week, detail };
  }
  if (target.kind === 'wam') {
    const { week, ...detail } = target;
    return { ...route, page: 'wams', week, detail };
  }
  return { ...route, page: 'reminders', detail: target };
}
