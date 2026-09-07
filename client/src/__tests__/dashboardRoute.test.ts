import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SECTIONS, archiveTargetFromRoute, encodeDashboardRoute, normalizeDashboardSection,
  parseDashboardRoute, resolveDashboardBoard, rootDashboardRoute, routeFromArchiveTarget,
  type DashboardRoute,
} from '../lib/dashboardRoute';
import type { ArchiveSearchTarget } from '../lib/archiveSearchTypes';

const context = { ownUserId: 1, partnerId: 2, partnershipsLoading: false, partnershipsError: null };

describe('dashboard URL codec', () => {
  it('preserves old root URLs without choosing a partner or week before data arrives', () => {
    expect(parseDashboardRoute('')).toEqual({ ok: true, route: rootDashboardRoute() });
    expect(parseDashboardRoute('?')).toEqual({ ok: true, route: rootDashboardRoute() });
  });

  it.each(DASHBOARD_SECTIONS)('round-trips menu page %s with stable board and selected week', (page) => {
    const route: DashboardRoute = { ...rootDashboardRoute(), page, boardId: 2, week: 9 };
    expect(parseDashboardRoute(encodeDashboardRoute(route))).toEqual({ ok: true, route });
  });

  it('aliases old personal planning links to the shared meeting without discarding board or week', () => {
    expect(normalizeDashboardSection('planningRitual')).toBe('wams');
    expect(parseDashboardRoute('?page=planningRitual&board=2&week=8')).toEqual({
      ok: true, route: { ...rootDashboardRoute(), page: 'wams', boardId: 2, week: 8 },
    });
    expect(DASHBOARD_SECTIONS).not.toContain('planningRitual');
    expect(DASHBOARD_SECTIONS).toContain('planning');
  });

  it.each([
    '?page=unknown', '?page=', '?board=partner', '?board=0', '?board=-1', '?board=1.5',
    '?board=1e2', '?board=01', '?board=9007199254740993', '?board=%202',
    '?week=0', '?week=13', '?week=Infinity', '?week=1&week=2', '?page=home&page=profile',
    '?typo=profile', '?token=private', '?page=week&cycle=2', '?page=goals&tactic=2',
    '?page=cycleHistory&goal=2', '?page=profile&wam=9', '?page=wams&commitment=3',
    '?page=wams&cycle=3', '?page=home&reminder=2', '?page=week&evidence=3',
    '?page=week&evidenceWeek=2', '?page=profile&evidence=3&evidenceWeek=2',
    '?page=week&evidence=3&evidenceWeek=13',
  ])('rejects invalid, ambiguous or context-inconsistent route %s', (query) => {
    expect(parseDashboardRoute(query).ok).toBe(false);
  });

  it('decodes URLSearchParams-encoded keys and values exactly once', () => {
    expect(parseDashboardRoute('?%70age=%77eek&board=%32&week=%31%32')).toEqual({
      ok: true, route: { ...rootDashboardRoute(), page: 'week', boardId: 2, week: 12 },
    });
    expect(parseDashboardRoute('?page=%2577eek').ok).toBe(false);
  });

  it.each<ArchiveSearchTarget>([
    { kind: 'cycle', userId: 2, cycleId: 99, week: 8, goalId: 12, tacticId: 45 },
    { kind: 'wam', userId: 1, cycleId: 22, wamId: 87, week: 4, commitmentId: 21 },
    { kind: 'wam', userId: 2, cycleId: null, wamId: 32, week: 12, punishmentId: 7 },
    { kind: 'reminder', reminderId: 51 },
  ])('round-trips exact archive targets without inferring a current-cycle ID: %j', (target) => {
    const route = routeFromArchiveTarget({ ...rootDashboardRoute(), boardId: 2 }, target);
    const decoded = parseDashboardRoute(encodeDashboardRoute(route));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(archiveTargetFromRoute(decoded.route, 2, 1)).toEqual(target);
  });

  it('supports a direct WAM-ID bookmark without requiring unrelated cycle metadata', () => {
    const decoded = parseDashboardRoute('?page=wams&wam=19&board=2');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(archiveTargetFromRoute(decoded.route, 2, 1)).toEqual({
      kind: 'wam', wamId: 19, userId: 1, cycleId: null, week: 1,
    });
  });

  it('rejects obsolete tactic-evidence URLs instead of ignoring a detail the week album cannot open', () => {
    expect(parseDashboardRoute('?page=week&board=2&week=8&evidence=31&evidenceWeek=2').ok).toBe(false);
  });

  it('refuses invalid programmatic weeks rather than serializing a changed context', () => {
    expect(() => encodeDashboardRoute({ ...rootDashboardRoute(), week: 13 })).toThrow(RangeError);
    expect(() => encodeDashboardRoute({ ...rootDashboardRoute(), boardId: -1 })).toThrow(RangeError);
  });

  it('serializes only identifiers, never extra runtime fields with private draft text', () => {
    const route = { ...rootDashboardRoute(), boardId: 2, note: 'private draft', token: 'secret', query: 'private query' };
    expect(encodeDashboardRoute(route)).toBe('?page=home&board=2');
  });
});

describe('stable board resolution', () => {
  it('allows legacy own/root links while partnership loading or failure is irrelevant', () => {
    expect(resolveDashboardBoard(null, { ...context, partnershipsLoading: true })).toEqual({
      status: 'ready', userId: 1, viewingOwn: true,
    });
    expect(resolveDashboardBoard(1, { ...context, partnershipsError: 'failed' }).status).toBe('ready');
  });

  it('never substitutes the own board while a bookmarked partner is loading', () => {
    expect(resolveDashboardBoard(2, { ...context, partnerId: null, partnershipsLoading: true })).toEqual({
      status: 'loading', userId: null, viewingOwn: false,
    });
    expect(resolveDashboardBoard(2, context)).toEqual({ status: 'ready', userId: 2, viewingOwn: false });
  });

  it('does not substitute a different partner after a relationship change', () => {
    expect(resolveDashboardBoard(2, { ...context, partnerId: 3 })).toMatchObject({ status: 'unavailable', userId: null });
    expect(resolveDashboardBoard(2, { ...context, partnerId: null })).toMatchObject({ status: 'unavailable', userId: null });
  });

  it('fails closed when partnerships cannot be verified, including stale cached partner state', () => {
    expect(resolveDashboardBoard(2, { ...context, partnershipsError: 'failed' })).toMatchObject({
      status: 'unavailable', userId: null,
    });
  });
});
