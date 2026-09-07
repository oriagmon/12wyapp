import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionRecoveryCard } from '../components/ExecutionRecoveryCard';
import type { Goal } from '../lib/types';
import type { ExecutionRecoveryPlan, ExecutionRiskAssessment } from '../hooks/useExecutionRecovery';

afterEach(cleanup);

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
    reasons: ['due_completion_below_threshold', 'maximum_achievable_below_target'],
    triggered: true,
    ...overrides,
  };
}

function makePlan(overrides: Partial<ExecutionRecoveryPlan> = {}): ExecutionRecoveryPlan {
  return {
    id: 1,
    cycleId: 1,
    week: 3,
    strategy: 'maneuver',
    note: 'אעשה את הפעולות שנשארו הערב',
    status: 'active',
    adjustment: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeGoals(): Goal[] {
  return [
    {
      id: 1,
      title: 'כושר',
      color: 'emerald',
      tactics: [
        { id: 10, title: 'ריצה', weekdays: [0, 1, 2, 3, 4], startWeek: 1, endWeek: 12, completions: [] },
        { id: 11, title: 'שחייה', weekdays: [5, 6], startWeek: 1, endWeek: 12, completions: [] },
      ],
    },
  ];
}

function noop() {
  return Promise.resolve(makePlan());
}

describe('ExecutionRecoveryCard: owner, risk triggered, no plan yet', () => {
  it('shows the risk explanation with exact numbers and both CTAs', () => {
    const risk = makeRisk();
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={risk}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText(/5 מתוך 10/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/64%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צמצום המחויבות לשבוע הבא' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' })).toBeInTheDocument();
  });

  it('renders nothing when risk is not triggered and no plan exists', () => {
    const { container } = render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ triggered: false, reasons: [] })}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading, regardless of risk', () => {
    const { container } = render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={null}
        plan={null}
        loadStatus="loading"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('disables the reduce-next-week CTA at week 12 (only maneuver available)', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={12}
        goals={makeGoals()}
        risk={makeRisk({ week: 12 })}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByRole('button', { name: 'צמצום המחויבות לשבוע הבא' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' })).not.toBeDisabled();
  });
});

describe('ExecutionRecoveryCard: maneuver strategy flow', () => {
  it('opens the maneuver editor, requires non-empty text, and calls onSaveManeuver with the trimmed note', async () => {
    const onSaveManeuver = vi.fn(noop);
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={onSaveManeuver}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' }));

    const submitBtn = screen.getByRole('button', { name: 'שמירת מהלך החילוץ' });
    expect(submitBtn).toBeDisabled(); // empty note

    const textarea = screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע');
    fireEvent.change(textarea, { target: { value: '  אשלים הכל היום  ' } });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(onSaveManeuver).toHaveBeenCalledWith('אשלים הכל היום');
  });
});

describe('ExecutionRecoveryCard: reduce-next-week strategy flow', () => {
  it('presents every effective next-week tactic pre-filled with its current weekday selection, and disables submit until the total strictly decreases', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'צמצום המחויבות לשבוע הבא' }));

    expect(screen.getByText('ריצה')).toBeInTheDocument();
    expect(screen.getByText('שחייה')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /שמירת הצמצום/ });
    expect(submitBtn).toBeDisabled(); // nothing changed yet (5 + 2 = 7, same as before)
  });

  it('calls onReduceNextWeek with the tacticId/weekdays selections once the total decreases and at least one remains', () => {
    const onReduceNextWeek = vi.fn(noop);
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={onReduceNextWeek}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'צמצום המחויבות לשבוע הבא' }));

    // Remove "שחייה" (swimming) entirely for next week by toggling off both its active days.
    const group = screen.getAllByRole('group', { name: 'ימי השבוע' })[1];
    fireEvent.click(within(group).getByText('ו׳')); // Friday (weekday 5)
    fireEvent.click(within(group).getByText('ש׳')); // Saturday (weekday 6)

    const submitBtn = screen.getByRole('button', { name: /שמירת הצמצום/ });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(onReduceNextWeek).toHaveBeenCalledWith(
      expect.objectContaining({
        tactics: expect.arrayContaining([
          { tacticId: 10, weekdays: [0, 1, 2, 3, 4] },
          { tacticId: 11, weekdays: [] },
        ]),
      })
    );
  });
});

describe('ExecutionRecoveryCard: an already-existing plan stays pinned regardless of live risk', () => {
  it('shows the plan even when risk.triggered is now false (recovered)', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ triggered: false, reasons: [] })}
        plan={makePlan()}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText('אעשה את הפעולות שנשארו הערב')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סימון כטופל' })).toBeInTheDocument();
  });

  it('resolve calls onResolve; a resolved plan shows a positive status and a reopen control', async () => {
    const onResolve = vi.fn(async () => makePlan({ status: 'resolved', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    const { rerender } = render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan()}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={onResolve}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'סימון כטופל' }));
    expect(onResolve).toHaveBeenCalled();

    // Simulate the parent re-rendering with the now-resolved plan (as the real hook would).
    rerender(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan({ status: 'resolved', resolvedAt: '2026-01-02T00:00:00.000Z' })}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={onResolve}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText('✓ תוכנית חילוץ טופלה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פתיחה מחדש' })).toBeInTheDocument();
  });

  it('never auto-resolves merely because risk numbers improved — plan stays active until an explicit resolve call', () => {
    const onResolve = vi.fn(noop);
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ triggered: false, reasons: [] })}
        plan={makePlan()} // still active
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={onResolve}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText(/⚠ תוכנית חילוץ פעילה/)).toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('shows the reduce_next_week adjustment summary and NO controls at all (completed, one-way action — no reopen/resolve offered)', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan({
          strategy: 'reduce_next_week',
          status: 'resolved',
          resolvedAt: '2026-01-02T00:00:00.000Z',
          adjustment: {
            targetWeek: 4,
            before: [{ tacticId: 10, weekdays: [0, 1, 2, 3, 4] }],
            after: [{ tacticId: 10, weekdays: [0, 1] }],
          },
        })}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText(/צומצמו 5 פעולות מתוכננות לשבוע 4 ל-2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'סימון כטופל' })).not.toBeInTheDocument();
    // Reopen is never offered for a resolved reduce_next_week plan — it's a completed,
    // one-way action; the tactic_week_overrides it wrote are never undone, and the server
    // rejects a reopen attempt outright too.
    expect(screen.queryByRole('button', { name: 'פתיחה מחדש' })).not.toBeInTheDocument();
  });

  it('an active (edge-case/legacy) reduce_next_week plan still offers a way to resolve it — never leaves it with no controls', () => {
    const onResolve = vi.fn(noop);
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan({ strategy: 'reduce_next_week', status: 'active', resolvedAt: null })}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={onResolve}
        onReopen={vi.fn(noop)}
      />
    );
    const resolveBtn = screen.getByRole('button', { name: 'סימון כטופל' });
    fireEvent.click(resolveBtn);
    expect(onResolve).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'פתיחה מחדש' })).not.toBeInTheDocument();
  });
});

describe('ExecutionRecoveryCard: partner (read-only)', () => {
  it('shows nothing when no plan exists yet, even if risk is triggered', () => {
    const { container } = render(
      <ExecutionRecoveryCard
        isOwner={false}
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a read-only status once a plan exists, with no edit/resolve/reopen controls', () => {
    render(
      <ExecutionRecoveryCard
        isOwner={false}
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan()}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('אעשה את הפעולות שנשארו הערב')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a positive resolved status read-only', () => {
    render(
      <ExecutionRecoveryCard
        isOwner={false}
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan({ status: 'resolved' })}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText('✓ טופל')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ExecutionRecoveryCard: load error visibility (never silently hidden)', () => {
  it('owner: shows a compact inline error when there is no active cycle/risk at all and loading failed', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={null}
        plan={null}
        loadStatus="error"
        loadError="שגיאת רשת"
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאת רשת');
  });

  it('partner: also shows the inline error rather than silently hiding the feature', () => {
    render(
      <ExecutionRecoveryCard
        isOwner={false}
        currentWeek={3}
        goals={makeGoals()}
        risk={null}
        plan={null}
        loadStatus="error"
        loadError="שגיאת רשת"
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאת רשת');
  });

  it('shows the error banner ALONGSIDE last-known-good data when a background refresh fails after an earlier success', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={makePlan()}
        loadStatus="error"
        loadError="הרשת נפלה זמנית"
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('הרשת נפלה זמנית');
    // The last-known-good plan content is still fully visible, not replaced by the error.
    expect(screen.getByText('אעשה את הפעולות שנשארו הערב')).toBeInTheDocument();
  });

  it('renders nothing at all when there is no error, no risk, and no plan (genuinely no active cycle)', () => {
    const { container } = render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={null}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ExecutionRecoveryCard: maneuver editor closes only on success, and 0-due/0-remaining copy', () => {
  it('closes the maneuver editor after a successful save', async () => {
    const onSaveManeuver = vi.fn(async () => makePlan());
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={onSaveManeuver}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' }));
    fireEvent.change(screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע'), { target: { value: 'אשלים היום' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת מהלך החילוץ' }));

    await vi.waitFor(() => expect(onSaveManeuver).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(screen.queryByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע')).not.toBeInTheDocument()
    );
    // Back to showing the two CTAs.
    expect(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' })).toBeInTheDocument();
  });

  it('does NOT close the maneuver editor when the save fails — the typed draft is preserved', async () => {
    const onSaveManeuver = vi.fn(async () => {
      throw new Error('שגיאת שרת');
    });
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={onSaveManeuver}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' }));
    const textarea = screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע');
    fireEvent.change(textarea, { target: { value: 'טיוטה שלא נשמרה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת מהלך החילוץ' }));

    await vi.waitFor(() => expect(onSaveManeuver).toHaveBeenCalled());
    // The editor (and the typed draft) must still be present after a failed save.
    expect(screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע')).toHaveValue('טיוטה שלא נשמרה');
  });

  it('shows clear standalone copy when nothing has come due yet this week (dueScheduled = 0)', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ dueScheduled: 0, dueCompleted: 0, dueCompletionRate: null, remainingScheduled: 4, totalScheduled: 4 })}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText('עדיין לא הגיע מועד לאף פעולה מתוכננת השבוע.')).toBeInTheDocument();
  });

  it('shows clear standalone copy when nothing remains scheduled later this week (remainingScheduled = 0)', () => {
    render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ dueScheduled: 10, dueCompleted: 3, dueCompletionRate: 30, remainingScheduled: 0, totalScheduled: 10, maximumAchievableScore: 30 })}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    expect(screen.getByText('כל הפעולות המתוכננות השבוע כבר עברו את מועדן — הציון הסופי האפשרי לשבוע הוא 30%.')).toBeInTheDocument();
  });
});

describe('ExecutionRecoveryCard: draft preservation across a refreshSignal-triggered re-render (non-destructive refresh)', () => {
  it('a typed maneuver draft survives the parent re-rendering with the same loadStatus="ready" (simulating a background refresh)', () => {
    const { rerender } = render(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk()}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'יצירת מהלך חילוץ לשבוע הנוכחי' }));
    const textarea = screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע');
    fireEvent.change(textarea, { target: { value: 'טיוטה באמצע עריכה' } });

    // A background refresh completed (e.g. after an unrelated completion toggle elsewhere on
    // the dashboard) and produced a fresh `risk` object — but loadStatus never dipped back to
    // 'loading', so the component (and the in-progress draft inside it) must not unmount.
    rerender(
      <ExecutionRecoveryCard
        isOwner
        currentWeek={3}
        goals={makeGoals()}
        risk={makeRisk({ dueCompleted: 6 })}
        plan={null}
        loadStatus="ready"
        loadError={null}
        onSaveManeuver={vi.fn(noop)}
        onReduceNextWeek={vi.fn(noop)}
        onResolve={vi.fn(noop)}
        onReopen={vi.fn(noop)}
      />
    );

    expect(screen.getByLabelText('ההתחייבות הקונקרטית שלי להצלת השבוע')).toHaveValue('טיוטה באמצע עריכה');
  });
});
