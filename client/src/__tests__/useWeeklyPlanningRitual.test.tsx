import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import { useWeeklyPlanningRitual, type WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';
import { WeeklyPlanningRitualPanel } from '../components/WeeklyPlanningRitualPanel';
import type { Cycle } from '../lib/types';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
  }
  return { ApiError, api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

type Response = { access: 'owner' | 'partner'; ritual: WeeklyPlanningRitual | null };
type Hook = ReturnType<typeof useWeeklyPlanningRitual>;
type Scope = { cycleId: number | null; targetWeek: number | null };
type Mutation = 'saveDraft' | 'complete' | 'reopen';
const mutations: Mutation[] = ['saveDraft', 'complete', 'reopen'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(cycleId: number, targetWeek: number, label: string, access: Response['access'] = 'owner'): Response {
  return { access, ritual: {
    id: cycleId * 100 + targetWeek, cycleId, targetWeek,
    workedWell: label, improveNext: label, weeklyFocus: label, commitment: label,
    tacticsReviewed: true, status: 'draft', completedAt: null,
    createdAt: '2026-01-01', updatedAt: label,
  } };
}
function invoke(hook: Hook, method: Mutation) {
  return method === 'saveDraft' ? hook.saveDraft({ workedWell: 'intended-A-patch' }) : hook[method]();
}
function expectCurrent(hook: Hook, expected: Response) {
  expect(hook).toMatchObject({ ...expected, loadStatus: 'ready', loadError: null });
}
function capture(promise: Promise<WeeklyPlanningRitual>) {
  return promise.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
}

const transitions = [
  { name: 'own to partner', from: [1, 2], to: [2, 2], oldAccess: 'owner', newAccess: 'partner' },
  { name: 'partner to own', from: [2, 2], to: [1, 2], oldAccess: 'partner', newAccess: 'owner' },
  { name: 'same cycle, different target week', from: [1, 2], to: [1, 3], oldAccess: 'owner', newAccess: 'owner' },
] as const;

describe.each(transitions)('ritual scope: $name', ({ from, to, oldAccess, newAccess }) => {
  it.each(['success', 'error'] as const)('ignores an older GET %s after the new scope succeeds', async (outcome) => {
    const old = deferred<Response>();
    const next = deferred<Response>();
    const newData = response(to[0], to[1], 'new-scope', newAccess);
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
      initialProps: { cycleId: from[0], targetWeek: from[1] } as Scope,
    });
    rerender({ cycleId: to[0], targetWeek: to[1] });
    expect(result.current).toMatchObject({ ritual: null, access: null, loadStatus: 'loading', loadError: null });
    await act(async () => next.resolve(newData));
    await act(async () => {
      if (outcome === 'success') old.resolve(response(from[0], from[1], 'old-scope', oldAccess));
      else old.reject(new ApiError('old-scope-error', 403));
    });
    expectCurrent(result.current, newData);
  });

  it('hides already-loaded old data during render, before passive effects can clear it', async () => {
    const next = deferred<Response>();
    vi.mocked(api.get).mockResolvedValueOnce(response(from[0], from[1], 'old-loaded', oldAccess)).mockReturnValueOnce(next.promise);
    const frames: { cycleId: number | null; targetWeek: number | null; ritual: Hook['ritual']; access: Hook['access']; status: Hook['loadStatus'] }[] = [];
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => {
      const hook = useWeeklyPlanningRitual(cycleId, targetWeek);
      useLayoutEffect(() => { frames.push({ cycleId, targetWeek, ritual: hook.ritual, access: hook.access, status: hook.loadStatus }); });
      return hook;
    }, { initialProps: { cycleId: from[0], targetWeek: from[1] } as Scope });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const boundary = frames.length;
    rerender({ cycleId: to[0], targetWeek: to[1] });
    expect(frames.slice(boundary).length).toBeGreaterThan(0);
    for (const frame of frames.slice(boundary)) {
      expect(frame).toMatchObject({ ritual: null, access: null, status: 'loading' });
    }
    await act(async () => next.resolve(response(to[0], to[1], 'new-loaded', newAccess)));
    expectCurrent(result.current, response(to[0], to[1], 'new-loaded', newAccess));
  });
});

describe('ritual generations and read ordering', () => {
  it.each(['success', 'error'] as const)('rejects old A/B GET %s after A -> B -> A', async (outcome) => {
    const oldA = deferred<Response>();
    const oldB = deferred<Response>();
    const newA = response(1, 2, 'new-generation-A');
    vi.mocked(api.get).mockReturnValueOnce(oldA.promise).mockReturnValueOnce(oldB.promise).mockResolvedValueOnce(newA);
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
      initialProps: { cycleId: 1, targetWeek: 2 } as Scope,
    });
    rerender({ cycleId: 2, targetWeek: 3 });
    rerender({ cycleId: 1, targetWeek: 2 });
    await waitFor(() => expectCurrent(result.current, newA));
    await act(async () => {
      if (outcome === 'success') { oldA.resolve(response(1, 2, 'old-A')); oldB.resolve(response(2, 3, 'old-B', 'partner')); }
      else { oldA.reject(new Error('old-A-error')); oldB.reject(new Error('old-B-error')); }
    });
    expectCurrent(result.current, newA);
  });

  it.each(['success', 'error'] as const)('keeps the latest same-scope reload after an older GET %s', async (outcome) => {
    const old = deferred<Response>();
    const current = response(1, 2, 'latest-reload');
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce(current);
    const { result } = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await act(async () => { await result.current.reload(); });
    await act(async () => {
      if (outcome === 'success') old.resolve(response(1, 2, 'old-read'));
      else old.reject(new ApiError('old-read-error', 403));
    });
    expectCurrent(result.current, current);
  });

  it.each([{ cycleId: null, targetWeek: 2 }, { cycleId: 1, targetWeek: null }, { cycleId: null, targetWeek: null }])(
    'clears synchronously and stays idle for disabled scope %j, including late requests',
    async (disabled) => {
      const old = deferred<Response>();
      vi.mocked(api.get).mockReturnValueOnce(old.promise);
      const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
        initialProps: { cycleId: 1, targetWeek: 2 } as Scope,
      });
      rerender(disabled);
      expect(result.current).toMatchObject({ ritual: null, access: null, loadStatus: 'idle', loadError: null });
      await act(async () => old.resolve(response(1, 2, 'old')));
      expect(result.current).toMatchObject({ ritual: null, access: null, loadStatus: 'idle', loadError: null });
      for (const method of mutations) await expect(invoke(result.current, method)).rejects.toThrow('אין שבוע יעד');
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.put).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    },
  );

  it('clears a current load error on scope change and only exposes a current-scope error', async () => {
    const next = deferred<Response>();
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError('A-error', 403)).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
      initialProps: { cycleId: 1, targetWeek: 2 } as Scope,
    });
    await waitFor(() => expect(result.current.loadError).toBe('A-error'));
    rerender({ cycleId: 2, targetWeek: 3 });
    expect(result.current).toMatchObject({ ritual: null, access: null, loadError: null, loadStatus: 'loading' });
    await act(async () => next.reject(new ApiError('B-error', 404)));
    expect(result.current).toMatchObject({ ritual: null, access: null, loadError: 'B-error', loadStatus: 'error' });
  });

  it('invalidates the first StrictMode lifetime even when the scope values are identical', async () => {
    const first = deferred<Response>();
    const current = response(1, 2, 'strict-current');
    vi.mocked(api.get).mockReturnValueOnce(first.promise).mockResolvedValueOnce(current);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useWeeklyPlanningRitual(1, 2), { wrapper });
    await waitFor(() => expectCurrent(result.current, current));
    await act(async () => first.resolve(response(1, 2, 'strict-old')));
    expectCurrent(result.current, current);
  });
});

describe.each(mutations)('ritual mutation %s', (method) => {
  it.each(['success', 'error'] as const)('preserves the original target/promise and ignores stale %s after switching scopes', async (outcome) => {
    const pending = deferred<Response>();
    const oldData = response(2, 3, 'old-partner-save', 'partner');
    const newData = response(1, 4, 'new-owner');
    const error = new ApiError('old mutation failed', 403);
    vi.mocked(api.get).mockResolvedValueOnce(oldData).mockResolvedValueOnce(newData);
    vi.mocked(api.put).mockReturnValue(pending.promise);
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
      initialProps: { cycleId: 2, targetWeek: 3 } as Scope,
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const settled = capture(invoke(result.current, method));
    rerender({ cycleId: 1, targetWeek: 4 });
    await waitFor(() => expectCurrent(result.current, newData));
    await act(async () => {
      if (outcome === 'success') pending.resolve(oldData);
      else pending.reject(error);
    });
    const answer = await settled;
    if (outcome === 'success') expect(answer.value).toBe(oldData.ritual);
    else expect(answer.error).toBe(error);
    expectCurrent(result.current, newData);
    if (method === 'saveDraft') expect(api.put).toHaveBeenCalledWith('/weekly-planning/2/3', { workedWell: 'intended-A-patch' });
    else expect(api.post).toHaveBeenCalledWith(`/weekly-planning/2/3/${method}`);
  });

  it('ignores an old mutation after A -> B -> A and leaves the new A generation untouched', async () => {
    const pending = deferred<Response>();
    vi.mocked(api.get).mockResolvedValueOnce(response(1, 2, 'A-old'))
      .mockResolvedValueOnce(response(2, 3, 'B')).mockResolvedValueOnce(response(1, 2, 'A-current'));
    vi.mocked(api.put).mockReturnValue(pending.promise);
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ cycleId, targetWeek }: Scope) => useWeeklyPlanningRitual(cycleId, targetWeek), {
      initialProps: { cycleId: 1, targetWeek: 2 } as Scope,
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const settled = capture(invoke(result.current, method));
    rerender({ cycleId: 2, targetWeek: 3 });
    await waitFor(() => expect(result.current.ritual?.workedWell).toBe('B'));
    rerender({ cycleId: 1, targetWeek: 2 });
    await waitFor(() => expect(result.current.ritual?.workedWell).toBe('A-current'));
    await act(async () => pending.resolve(response(1, 2, 'A-obsolete-mutation')));
    await settled;
    expectCurrent(result.current, response(1, 2, 'A-current'));
  });

  it('does not publish after unmount, but still resolves the original mutation result', async () => {
    const pending = deferred<Response>();
    vi.mocked(api.get).mockResolvedValue(response(1, 2, 'initial'));
    vi.mocked(api.put).mockReturnValue(pending.promise);
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const first = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await waitFor(() => expect(first.result.current.loadStatus).toBe('ready'));
    const settled = capture(invoke(first.result.current, method));
    first.unmount();
    vi.mocked(api.get).mockResolvedValue(response(1, 2, 'remounted'));
    const second = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await waitFor(() => expect(second.result.current.loadStatus).toBe('ready'));
    const saved = response(1, 2, 'unmounted-save');
    await act(async () => pending.resolve(saved));
    expect((await settled).value).toBe(saved.ritual);
    expectCurrent(second.result.current, response(1, 2, 'remounted'));
  });
});

describe('same-scope save/read ordering', () => {
  it.each(['success', 'error'] as const)('does not let an older GET %s overwrite a successful mutation', async (outcome) => {
    const oldGet = deferred<Response>();
    const saved = response(1, 2, 'saved');
    vi.mocked(api.get).mockReturnValue(oldGet.promise);
    vi.mocked(api.put).mockResolvedValue(saved);
    const { result } = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await act(async () => { await result.current.saveDraft({ workedWell: 'saved' }); });
    await act(async () => {
      if (outcome === 'success') oldGet.resolve(response(1, 2, 'old-read'));
      else oldGet.reject(new ApiError('old-read-error', 500));
    });
    expectCurrent(result.current, saved);
  });

  it('does not strand a pending load when the current mutation fails', async () => {
    const pending = deferred<Response>();
    const error = new ApiError('save failed', 400);
    vi.mocked(api.get).mockReturnValue(pending.promise);
    vi.mocked(api.put).mockRejectedValue(error);
    const { result } = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await expect(result.current.saveDraft({ workedWell: 'attempt' })).rejects.toBe(error);
    await act(async () => pending.resolve(response(1, 2, 'loaded')));
    expectCurrent(result.current, response(1, 2, 'loaded'));
  });

  it('keeps a newer mutation result when the earlier mutation succeeds last', async () => {
    const old = deferred<Response>();
    vi.mocked(api.get).mockResolvedValue(response(1, 2, 'initial'));
    vi.mocked(api.put).mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(1, 2, 'new-save'));
    const { result } = renderHook(() => useWeeklyPlanningRitual(1, 2));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    const settled = capture(result.current.saveDraft({ workedWell: 'old-save' }));
    await act(async () => { await result.current.saveDraft({ workedWell: 'new-save' }); });
    await act(async () => old.resolve(response(1, 2, 'old-save')));
    expect((await settled).value?.workedWell).toBe('old-save');
    expectCurrent(result.current, response(1, 2, 'new-save'));
  });
});

it('never places a late partner draft into the editable owner form or its save payload', async () => {
  const partnerGet = deferred<Response>();
  const ownerData = response(1, 4, 'OWNER-CONTENT');
  vi.mocked(api.get).mockReturnValueOnce(partnerGet.promise).mockResolvedValueOnce(ownerData);
  vi.mocked(api.put).mockResolvedValue(ownerData);
  function Panel({ cycleId, targetWeek, owner }: { cycleId: number; targetWeek: number; owner: boolean }) {
    const ritual = useWeeklyPlanningRitual(cycleId, targetWeek);
    const cycle: Cycle = {
      id: cycleId, currentWeek: targetWeek - 1, name: 'Synthetic cycle', isActive: true,
      vision: '', successDefinition: '', whyItMatters: '', blockers: '', risks: '', lagMeasures: '',
      leadMeasures: '', notes: '', createdAt: '', updatedAt: '',
    };
    return <WeeklyPlanningRitualPanel key={`${cycleId}:${targetWeek}`} cycle={cycle} goals={[]} weekScores={[]}
      isOwner={owner} ritual={ritual.ritual} loadStatus={ritual.loadStatus} loadError={ritual.loadError}
      onSaveDraft={ritual.saveDraft} onComplete={ritual.complete} onReopen={ritual.reopen} onNavigateToTactics={() => undefined} />;
  }
  const { rerender } = render(<Panel cycleId={2} targetWeek={3} owner={false} />);
  rerender(<Panel cycleId={1} targetWeek={4} owner />);
  expect(await screen.findByLabelText('מה עבד השבוע?')).toHaveValue('OWNER-CONTENT');
  await act(async () => partnerGet.resolve(response(2, 3, 'PARTNER-ONLY-CONTENT', 'partner')));
  expect(screen.getByLabelText('מה עבד השבוע?')).toHaveValue('OWNER-CONTENT');
  expect(screen.queryByDisplayValue('PARTNER-ONLY-CONTENT')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/weekly-planning/1/4', {
    workedWell: 'OWNER-CONTENT', improveNext: 'OWNER-CONTENT', weeklyFocus: 'OWNER-CONTENT',
    commitment: 'OWNER-CONTENT', tacticsReviewed: true,
  }));
  expect(api.put).toHaveBeenCalledTimes(1);
});
