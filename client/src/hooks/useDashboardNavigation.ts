import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';
import {
  archiveTargetFromRoute, encodeDashboardRoute, normalizeDashboardSection, parseDashboardRoute,
  resolveDashboardBoard, rootDashboardRoute, routeFromArchiveTarget,
  type BoardRouteContext, type DashboardRoute,
} from '../lib/dashboardRoute';

const ROUTE_CHANGED = 'dashboard-route-changed';
const getSnapshot = () => window.location.search;
const getServerSnapshot = () => '';
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(ROUTE_CHANGED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(ROUTE_CHANGED, listener);
  };
}

export function useDashboardNavigation(context: BoardRouteContext) {
  const { ownUserId, partnerId, partnershipsLoading, partnershipsError } = context;
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const parsed = useMemo(() => parseDashboardRoute(search), [search]);
  // A malformed or hand-edited query string is a navigation dead end, not something worth
  // confronting someone with: every menu action below refuses to act on an unparsable URL, so
  // the address bar is silently rewritten back to the personal home board (below) and the
  // personal home board is what renders in the meantime. Genuine *authorization* problems —
  // a board that exists but is not shared with you — still surface as a message.
  const route = parsed.ok ? parsed.route : rootDashboardRoute();
  const board = resolveDashboardBoard(route.boardId, context);
  const targetUserId = board.userId;

  // Actions read the current URL rather than a render closure, so two actions in one event
  // compose correctly. Data reloads never call this writer or add browser-history entries.
  const commit = useCallback((
    update: (current: DashboardRoute) => DashboardRoute,
    options: { replace?: boolean; recoverInvalid?: boolean } = {},
  ) => {
    const current = parseDashboardRoute(window.location.search);
    if (!current.ok && !options.recoverInvalid) return;
    const base = current.ok ? current.route : rootDashboardRoute();
    const next = update({ ...base, boardId: base.boardId ?? ownUserId });
    const query = encodeDashboardRoute(next);
    const href = `${window.location.pathname}${query}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === href) return;
    if (options.replace) window.history.replaceState(window.history.state, '', href);
    else window.history.pushState(window.history.state, '', href);
    window.dispatchEvent(new Event(ROUTE_CHANGED));
  }, [ownUserId]);

  const navigate = useCallback((section: string) => {
    const page = normalizeDashboardSection(section);
    if (!page) throw new RangeError('Unknown dashboard section');
    commit((current) => ({ ...current, page, detail: null }));
  }, [commit]);
  const switchBoard = useCallback((viewingOwn: boolean) => {
    if (!viewingOwn && (partnershipsLoading || partnershipsError || partnerId === null)) return;
    commit((current) => ({
      ...current, boardId: viewingOwn ? ownUserId : partnerId, detail: null,
    }), { recoverInvalid: viewingOwn });
  }, [commit, ownUserId, partnerId, partnershipsLoading, partnershipsError]);
  const setViewedWeek = useCallback((week: number) => {
    commit((current) => ({ ...current, week }));
  }, [commit]);
  const openArchiveResult = useCallback((target: ArchiveSearchTarget) => {
    commit((current) => routeFromArchiveTarget(current, target));
  }, [commit]);
  const setArchiveTarget = useCallback((target: ArchiveSearchTarget | null) => {
    if (target) openArchiveResult(target);
    else commit((current) => ({ ...current, detail: null }));
  }, [commit, openArchiveResult]);
  const openWam = useCallback((wamId: number, week?: number) => {
    commit((current) => ({
      ...current, page: 'wams', week: week ?? current.week,
      detail: { kind: 'wam', wamId, cycleId: null },
    }));
  }, [commit]);
  const resetToOwnHome = useCallback((options: { replace?: boolean } = {}) => {
    commit(() => ({ ...rootDashboardRoute(), boardId: ownUserId }), { ...options, recoverInvalid: true });
  }, [commit, ownUserId]);
  useEffect(() => {
    if (!parsed.ok) resetToOwnHome({ replace: true });
  }, [parsed.ok, resetToOwnHome]);
  const archiveTarget = useMemo(() =>
    route && targetUserId !== null ? archiveTargetFromRoute(route, targetUserId, ownUserId) : null,
  [route, targetUserId, ownUserId]);

  return {
    route,
    activeSection: route.page,
    targetUserId,
    viewingOwn: board.viewingOwn,
    resolvingBoard: board.status === 'loading',
    routeError: board.status === 'unavailable' ? board.error : null,
    viewedWeek: route.week,
    archiveTarget,
    selectedWamId: targetUserId !== null && route.detail?.kind === 'wam' ? route.detail.wamId : null,
    navigate, switchBoard, setViewedWeek, openArchiveResult, setArchiveTarget,
    openWam, resetToOwnHome,
  };
}
