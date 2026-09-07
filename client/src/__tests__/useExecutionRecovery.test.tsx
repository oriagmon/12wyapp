import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExecutionRecovery } from '../hooks/useExecutionRecovery';
import { api } from '../lib/api';
import type { ExecutionRiskAssessment } from '../hooks/useExecutionRecovery';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      putBinary: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRisk(overrides: Partial<ExecutionRiskAssessment> = {}): ExecutionRiskAssessment {
  return {
    week: 3,
    israelWeekday: 3,
    eligibleToTrigger: true,
    dueScheduled: 10,
    dueCompleted: 5,
    dueCompletionRate: 50,
    totalScheduled: 14,
    remainingScheduled: 4,
    maximumAchievableScore: 64,
    reasons: ['due_completion_below_threshold'],
    triggered: true,
    ...overrides,
  };
}

const RESPONSE = { access: 'owner' as const, cycle: { id: 1, week: 3 }, risk: makeRisk(), plan: null };
const PLAN = {
  id: 1,
  cycleId: 1,
  week: 3,
  strategy: 'reduce_next_week' as const,
  note: '',
  status: 'resolved' as const,
  adjustment: null,
  createdAt: '',
  updatedAt: '',
  resolvedAt: '2026-01-01T00:00:00.000Z',
};

describe('useExecutionRecovery: initial load', () => {
  it('starts idle, then loading, then ready with the fetched data', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useExecutionRecovery(1));

    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.risk).toEqual(RESPONSE.risk);
    expect(result.current.plan).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/execution-recovery/1');
  });

  it('does nothing (stays idle) when userId is null', () => {
    const { result } = renderHook(() => useExecutionRecovery(null));
    expect(result.current.loadStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('useExecutionRecovery: non-destructive background refresh', () => {
  it('does not flip loadStatus back to "loading" for a refreshSignal-triggered reload after the first successful load', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    const { result, rerender } = renderHook(({ signal }) => useExecutionRecovery(1, signal), {
      initialProps: { signal: 1 },
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    // Change the refresh signal (simulating an unrelated dashboard mutation completing) —
    // a background reload fires, but loadStatus must never dip back to 'loading' along the
    // way (checked by asserting it stays 'ready' immediately after triggering a re-render,
    // not just eventually).
    rerender({ signal: 2 });
    expect(result.current.loadStatus).toBe('ready');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(result.current.loadStatus).toBe('ready');
  });

  it('shows loading again when userId itself changes (switching target user)', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    const { result, rerender } = renderHook(({ userId }) => useExecutionRecovery(userId), {
      initialProps: { userId: 1 },
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    let resolveSecond: (() => void) | undefined;
    vi.mocked(api.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = () => resolve(RESPONSE);
        })
    );
    rerender({ userId: 2 });
    expect(result.current.loadStatus).toBe('loading'); // a genuinely new target user
    await act(async () => {
      resolveSecond?.();
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
  });

  it('clears a stale loadError once a later refresh succeeds', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network down'));
    const { result, rerender } = renderHook(({ signal }) => useExecutionRecovery(1, signal), {
      initialProps: { signal: 1 },
    });
    await waitFor(() => expect(result.current.loadStatus).toBe('error'));
    expect(result.current.loadError).toBeTruthy();

    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    rerender({ signal: 2 });
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
    expect(result.current.loadError).toBeNull();
  });
});

describe('useExecutionRecovery: reduceNextWeek refresh composition (onReduced)', () => {
  it('calls onReduced after a successful reduceNextWeek', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    vi.mocked(api.post).mockResolvedValue({ access: 'owner', plan: PLAN });
    const onReduced = vi.fn();
    const { result } = renderHook(() => useExecutionRecovery(1, undefined, onReduced));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await act(async () => {
      await result.current.reduceNextWeek({ tactics: [{ tacticId: 10, weekdays: [0] }] });
    });

    expect(onReduced).toHaveBeenCalledTimes(1);
    expect(result.current.plan).toEqual(PLAN);
  });

  it('does NOT call onReduced when reduceNextWeek fails, and the error propagates', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    vi.mocked(api.post).mockRejectedValue(new Error('שגיאת אימות'));
    const onReduced = vi.fn();
    const { result } = renderHook(() => useExecutionRecovery(1, undefined, onReduced));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await expect(
      act(async () => {
        await result.current.reduceNextWeek({ tactics: [{ tacticId: 10, weekdays: [0] }] });
      })
    ).rejects.toThrow('שגיאת אימות');

    expect(onReduced).not.toHaveBeenCalled();
  });

  it('works fine with no onReduced callback provided at all', async () => {
    vi.mocked(api.get).mockResolvedValue(RESPONSE);
    vi.mocked(api.post).mockResolvedValue({ access: 'owner', plan: PLAN });
    const { result } = renderHook(() => useExecutionRecovery(1));
    await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

    await act(async () => {
      await result.current.reduceNextWeek({ tactics: [{ tacticId: 10, weekdays: [0] }] });
    });
    expect(result.current.plan).toEqual(PLAN);
  });
});
