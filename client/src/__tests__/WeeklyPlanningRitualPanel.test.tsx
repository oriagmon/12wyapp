import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningRitualPanel } from '../components/WeeklyPlanningRitualPanel';
import type { Cycle, Goal, WeekScore } from '../lib/types';
import type { WeeklyPlanningRitual } from '../hooks/useWeeklyPlanningRitual';

afterEach(cleanup);

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 1,
    name: 'מחזור 1',
    currentWeek: 2,
    isActive: true,
    vision: '',
    successDefinition: '',
    whyItMatters: '',
    blockers: '',
    risks: '',
    lagMeasures: '',
    leadMeasures: '',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
        {
          id: 10,
          title: 'ריצה',
          weekdays: [1, 3],
          startWeek: 1,
          endWeek: 12,
          overrides: [{ week: 3, title: 'ריצה קלה', weekdays: [2] }],
          completions: [],
        },
      ],
    },
  ];
}

function makeWeekScores(): WeekScore[] {
  return Array.from({ length: 12 }, (_, i) => ({ week: i + 1, scheduled: 2, completed: 1, score: 50 }));
}

function makeRitual(overrides: Partial<WeeklyPlanningRitual> = {}): WeeklyPlanningRitual {
  return {
    id: 1,
    cycleId: 1,
    targetWeek: 3,
    workedWell: '',
    improveNext: '',
    tacticsReviewed: false,
    weeklyFocus: '',
    commitment: '',
    status: 'draft',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

describe('WeeklyPlanningRitualPanel (cycle finished)', () => {
  it('shows a friendly message instead of a week-13 ritual when the cycle is at week 12', () => {
    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 12 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner
        ritual={null}
        loadStatus="idle"
        loadError={null}
        onSaveDraft={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onNavigateToTactics={noop}
      />
    );

    expect(screen.getByText(/המחזור הגיע לשבוע 12/)).toBeInTheDocument();
    expect(screen.queryByText(/שלב 1/)).not.toBeInTheDocument();
  });
});

describe('WeeklyPlanningRitualPanel (owner, draft)', () => {
  it('shows the current week score and the effective target-week tactics (using overrides)', () => {
    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 2 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner
        ritual={null}
        loadStatus="ready"
        loadError={null}
        onSaveDraft={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onNavigateToTactics={noop}
      />
    );

    expect(screen.getByText('ציון שבוע 2: 50%')).toBeInTheDocument();
    // target week is 3, which has an override on the tactic
    expect(screen.getByText('ריצה קלה')).toBeInTheDocument();
    expect(screen.getByText('כושר')).toBeInTheDocument();
  });

  it('disables completion until tactics-reviewed + focus + commitment are all filled, then calls saveDraft then complete', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(makeRitual());
    const onComplete = vi.fn().mockResolvedValue(makeRitual({ status: 'complete' }));
    const onNavigateToTactics = vi.fn();

    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 2 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner
        ritual={null}
        loadStatus="ready"
        loadError={null}
        onSaveDraft={onSaveDraft}
        onComplete={onComplete}
        onReopen={vi.fn()}
        onNavigateToTactics={onNavigateToTactics}
      />
    );

    const completeButton = screen.getByRole('button', { name: 'השלמת הטקס' });
    expect(completeButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'מעבר למטרות וטקטיקות לעדכון' }));
    expect(onNavigateToTactics).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'בדקתי והתאמתי את הטקטיקות לשבוע הבא' }));
    expect(completeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('המיקוד המרכזי'), { target: { value: 'להתמקד בבריאות' } });
    expect(completeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('ההתחייבות שלי לשבוע הבא'), { target: { value: 'לרוץ שלוש פעמים' } });
    expect(completeButton).not.toBeDisabled();

    fireEvent.click(completeButton);

    await screen.findByText('נשמר ✓');
    expect(onSaveDraft).toHaveBeenCalledWith({
      workedWell: '',
      improveNext: '',
      tacticsReviewed: true,
      weeklyFocus: 'להתמקד בבריאות',
      commitment: 'לרוץ שלוש פעמים',
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it('saves a draft explicitly via the save-draft button', async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(makeRitual({ workedWell: 'התמדתי' }));
    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 2 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner
        ritual={null}
        loadStatus="ready"
        loadError={null}
        onSaveDraft={onSaveDraft}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onNavigateToTactics={noop}
      />
    );

    fireEvent.change(screen.getByLabelText('מה עבד השבוע?'), { target: { value: 'התמדתי' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));

    await screen.findByText('נשמר ✓');
    expect(onSaveDraft).toHaveBeenCalledWith({
      workedWell: 'התמדתי',
      improveNext: '',
      tacticsReviewed: false,
      weeklyFocus: '',
      commitment: '',
    });
  });
});

describe('WeeklyPlanningRitualPanel (completed)', () => {
  it('shows a positive completed status and offers reopen for the owner, with fields read-only', () => {
    const onReopen = vi.fn();
    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 2 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner
        ritual={makeRitual({ status: 'complete', completedAt: '2026-01-02T00:00:00.000Z', weeklyFocus: 'מיקוד', commitment: 'התחייבות', tacticsReviewed: true })}
        loadStatus="ready"
        loadError={null}
        onSaveDraft={vi.fn()}
        onComplete={vi.fn()}
        onReopen={onReopen}
        onNavigateToTactics={noop}
      />
    );

    expect(screen.getByText('✓ הטקס הושלם')).toBeInTheDocument();
    expect(screen.getByLabelText('המיקוד המרכזי')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'שמירת טיוטה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'השלמת הטקס' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'פתיחה מחדש לעריכה' }));
    expect(onReopen).toHaveBeenCalled();
  });
});

describe('WeeklyPlanningRitualPanel (partner, read-only)', () => {
  it('never shows edit controls for the partner, regardless of ritual status', () => {
    render(
      <WeeklyPlanningRitualPanel
        cycle={makeCycle({ currentWeek: 2 })}
        goals={makeGoals()}
        weekScores={makeWeekScores()}
        isOwner={false}
        ritual={makeRitual({ weeklyFocus: 'מיקוד' })}
        loadStatus="ready"
        loadError={null}
        onSaveDraft={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onNavigateToTactics={noop}
      />
    );

    expect(screen.getByLabelText('המיקוד המרכזי')).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'בדקתי והתאמתי את הטקטיקות לשבוע הבא' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'שמירת טיוטה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'השלמת הטקס' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'פתיחה מחדש לעריכה' })).not.toBeInTheDocument();
    expect(screen.getByText(/צפייה בלבד/)).toBeInTheDocument();
  });
});
