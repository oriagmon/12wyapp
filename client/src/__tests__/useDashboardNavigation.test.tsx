import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardNavigation } from '../hooks/useDashboardNavigation';
import { DASHBOARD_SECTIONS, type BoardRouteContext } from '../lib/dashboardRoute';

const context = { ownUserId: 1, partnerId: 2 as number | null, partnershipsLoading: false, partnershipsError: null as string | null };
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('URL-backed dashboard navigation', () => {
  it('keeps root compatible and writes the first explicit menu selection with a stable board ID', () => {
    const { result } = renderHook(() => useDashboardNavigation(context));
    expect(result.current.activeSection).toBe('home');
    expect(result.current.targetUserId).toBe(1);
    expect(window.location.search).toBe('');
    act(() => result.current.navigate('profile'));
    expect(window.location.search).toBe('?page=profile&board=1');
    expect(result.current.activeSection).toBe('profile');
  });

  it.each(DASHBOARD_SECTIONS)('restores bookmarked menu page %s', (page) => {
    window.history.replaceState(null, '', `/?page=${page}&board=2&week=8`);
    const { result } = renderHook(() => useDashboardNavigation(context));
    expect(result.current.activeSection).toBe(page);
    expect(result.current.targetUserId).toBe(2);
    expect(result.current.viewedWeek).toBe(8);
  });

  it('waits for the exact bookmarked partner after async loading and never rewrites the requested board', () => {
    window.history.replaceState(null, '', '/?page=goals&board=2&week=5');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const loadingContext: BoardRouteContext = { ...context, partnerId: null, partnershipsLoading: true };
    const { result, rerender } = renderHook((props) => useDashboardNavigation(props), {
      initialProps: loadingContext,
    });
    expect(result.current.targetUserId).toBeNull();
    expect(result.current.resolvingBoard).toBe(true);
    expect(result.current.viewingOwn).toBe(false);
    rerender(context);
    expect(result.current.targetUserId).toBe(2);
    expect(result.current.resolvingBoard).toBe(false);
    expect(result.current.viewedWeek).toBe(5);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows unavailable for removed/changed partners and preserves the requested context until explicit recovery', () => {
    window.history.replaceState(null, '', '/?page=week&board=2&week=7');
    const { result, rerender } = renderHook((props) => useDashboardNavigation(props), { initialProps: context });
    rerender({ ...context, partnerId: 3 });
    expect(result.current.targetUserId).toBeNull();
    expect(result.current.routeError).toContain('אינו זמין');
    expect(window.location.search).toContain('board=2');
    act(() => result.current.resetToOwnHome());
    expect(result.current.targetUserId).toBe(1);
    expect(result.current.routeError).toBeNull();
    expect(window.location.search).toBe('?page=home&board=1');
  });

  // A malformed address is a typo or a stale bookmark, not a permission problem: it used to
  // strand the user on an error card *and* silently deaden every menu item, because commit()
  // refuses to write a new URL while the current one is unparsable.
  it('silently repairs an unparsable route to the own home board instead of erroring', () => {
    window.history.replaceState(null, '', '/?page=week&board=nope');
    const { result } = renderHook(() => useDashboardNavigation(context));
    expect(result.current.routeError).toBeNull();
    expect(result.current.targetUserId).toBe(1);
    expect(window.location.search).not.toContain('board=nope');
    expect(window.location.search).toContain('page=home');
    // ...and navigation still works from there, rather than being dead for the whole session.
    act(() => result.current.navigate('profile'));
    expect(window.location.search).toContain('page=profile');
    expect(result.current.targetUserId).toBe(1);
  });

  it('keeps selected weeks through menu and board changes, and clears incompatible detail targets', () => {
    const { result } = renderHook(() => useDashboardNavigation(context));
    act(() => {
      result.current.navigate('week');
      result.current.setViewedWeek(9);
      result.current.switchBoard(false);
    });
    expect(window.location.search).toBe('?page=week&board=2&week=9');
    act(() => result.current.openArchiveResult({ kind: 'cycle', userId: 2, cycleId: 77, week: 4, goalId: 8 }));
    expect(result.current.archiveTarget).toEqual({ kind: 'cycle', userId: 2, cycleId: 77, week: 4, goalId: 8 });
    act(() => result.current.navigate('history'));
    expect(result.current.archiveTarget).toBeNull();
    expect(result.current.targetUserId).toBe(2);
    expect(result.current.viewedWeek).toBe(4);
    expect(window.location.search).not.toContain('cycle=');
  });

  it('updates exact detail open/back/week/highlight changes without loops', () => {
    const { result } = renderHook(() => useDashboardNavigation(context));
    const target = { kind: 'cycle' as const, userId: 2, cycleId: 43, week: 2, tacticId: 9 };
    act(() => result.current.setArchiveTarget(target));
    act(() => result.current.setArchiveTarget({ ...target, week: 11 }));
    expect(window.location.search).toBe('?page=cycleHistory&board=2&week=11&cycle=43&tactic=9');
    act(() => result.current.setArchiveTarget({ ...target, week: 11, tacticId: undefined }));
    expect(window.location.search).not.toContain('tactic=');
    act(() => result.current.setArchiveTarget(null));
    expect(result.current.activeSection).toBe('cycleHistory');
    expect(result.current.archiveTarget).toBeNull();
    expect(window.location.search).not.toContain('cycle=');
  });

  it('restores complete WAM details and the selected week album context after remount (refresh)', () => {
    const first = renderHook(() => useDashboardNavigation(context));
    act(() => first.result.current.openArchiveResult({
      kind: 'wam', userId: 2, wamId: 88, week: 3, cycleId: null, punishmentId: 7,
    }));
    first.unmount();
    const second = renderHook(() => useDashboardNavigation(context));
    expect(second.result.current.archiveTarget).toEqual({
      kind: 'wam', userId: 2, wamId: 88, week: 3, cycleId: null, punishmentId: 7,
    });
    act(() => { second.result.current.navigate('week'); second.result.current.setViewedWeek(2); });
    second.unmount();
    const third = renderHook(() => useDashboardNavigation(context));
    expect(third.result.current.viewedWeek).toBe(2);
    expect(third.result.current.targetUserId).toBe(1);
    expect(third.result.current.activeSection).toBe('week');
    expect(third.result.current.archiveTarget).toBeNull();
  });

  it('opens WAMs by exact ID without needing a fabricated meeting week or changing board context', () => {
    window.history.replaceState(null, '', '/?page=wams&board=2&week=7');
    const first = renderHook(() => useDashboardNavigation(context));
    act(() => first.result.current.openWam(32));
    expect(first.result.current.selectedWamId).toBe(32);
    expect(window.location.search).toBe('?page=wams&board=2&week=7&wam=32');
    first.unmount();
    const second = renderHook(() => useDashboardNavigation(context));
    expect(second.result.current.selectedWamId).toBe(32);
    act(() => second.result.current.setArchiveTarget(null));
    expect(second.result.current.selectedWamId).toBeNull();
    expect(second.result.current.activeSection).toBe('wams');
    expect(second.result.current.viewedWeek).toBe(7);
  });

  it('uses the actual startMeeting response ID/week and clears old archive-only highlighting', () => {
    const { result } = renderHook(() => useDashboardNavigation(context));
    act(() => result.current.openArchiveResult({
      kind: 'wam', userId: 2, wamId: 88, week: 3, cycleId: 43, punishmentId: 7,
    }));
    act(() => result.current.openWam(91, 9));
    expect(window.location.search).toBe('?page=wams&board=1&week=9&wam=91');
    expect(result.current.selectedWamId).toBe(91);
    expect(result.current.archiveTarget).toEqual({ kind: 'wam', userId: 1, wamId: 91, cycleId: null, week: 9 });
    act(() => { expect(() => result.current.openWam(0)).toThrow(RangeError); });
    expect(result.current.selectedWamId).toBe(91);
  });

  it('responds to real browser Back and Forward without adding history entries during popstate', async () => {
    const { result } = renderHook(() => useDashboardNavigation(context));
    act(() => result.current.navigate('profile'));
    act(() => result.current.navigate('reminders'));
    const push = vi.spyOn(window.history, 'pushState');
    act(() => window.history.back());
    await waitFor(() => expect(result.current.activeSection).toBe('profile'));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.activeSection).toBe('reminders'));
    expect(push).not.toHaveBeenCalled();
  });

  it('handles popstate to an exact prior board/week and ignores component rerenders', () => {
    const { result, rerender } = renderHook(() => useDashboardNavigation(context));
    const push = vi.spyOn(window.history, 'pushState');
    act(() => {
      window.history.replaceState(null, '', '/?page=week&board=2&week=12');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    rerender();
    expect(result.current.targetUserId).toBe(2);
    expect(result.current.viewedWeek).toBe(12);
    expect(push).not.toHaveBeenCalled();
  });

  it('avoids duplicate history entries and unsubscribes on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useDashboardNavigation(context));
    act(() => result.current.navigate('profile'));
    const push = vi.spyOn(window.history, 'pushState');
    act(() => result.current.navigate('profile'));
    expect(push).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('dashboard-route-changed', expect.any(Function));
  });

  it('does not switch to an unresolved partner when clicked while loading', () => {
    const { result } = renderHook(() => useDashboardNavigation({ ...context, partnershipsLoading: true, partnerId: null }));
    act(() => result.current.switchBoard(false));
    expect(window.location.search).toBe('');
    expect(result.current.targetUserId).toBe(1);
  });

  it('keeps independent hook consumers in sync after a history write', () => {
    const first = renderHook(() => useDashboardNavigation(context));
    const second = renderHook(() => useDashboardNavigation(context));
    act(() => first.result.current.navigate('search'));
    expect(second.result.current.activeSection).toBe('search');
  });
});
