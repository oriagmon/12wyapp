import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningRitualHomeCard } from '../components/WeeklyPlanningRitualHomeCard';
import type { Cycle } from '../lib/types';
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

describe('WeeklyPlanningRitualHomeCard (owner)', () => {
  it('shows a pending status and CTA before the ritual is complete', () => {
    const onOpen = vi.fn();
    render(
      <WeeklyPlanningRitualHomeCard cycle={makeCycle()} isOwner ritual={null} loadStatus="ready" onOpen={onOpen} />
    );

    expect(screen.getByText(/באותו עמוד עם הפגישה המשותפת/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'פגישה משותפת' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows a positive completed status rather than hiding the card', () => {
    render(
      <WeeklyPlanningRitualHomeCard
        cycle={makeCycle()}
        isOwner
        ritual={makeRitual({ status: 'complete', weeklyFocus: 'בריאות' })}
        loadStatus="ready"
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText('✓ הטקס הושלם')).toBeInTheDocument();
    expect(screen.getByText('מיקוד: בריאות')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פגישה משותפת' })).toBeInTheDocument();
  });

  it('shows a friendly week-12 message instead of a broken next-week CTA', () => {
    render(
      <WeeklyPlanningRitualHomeCard
        cycle={makeCycle({ currentWeek: 12 })}
        isOwner
        ritual={null}
        loadStatus="idle"
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText(/המחזור בשבוע 12/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing while still loading (avoids a flash of the pending state)', () => {
    const { container } = render(
      <WeeklyPlanningRitualHomeCard cycle={makeCycle()} isOwner ritual={null} loadStatus="loading" onOpen={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('WeeklyPlanningRitualHomeCard (partner)', () => {
  it('shows nothing when the ritual is absent', () => {
    const { container } = render(
      <WeeklyPlanningRitualHomeCard cycle={makeCycle()} isOwner={false} ritual={null} loadStatus="ready" onOpen={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the ritual is only a draft', () => {
    const { container } = render(
      <WeeklyPlanningRitualHomeCard
        cycle={makeCycle()}
        isOwner={false}
        ritual={makeRitual({ status: 'draft' })}
        loadStatus="ready"
        onOpen={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a read-only completed summary with no controls when the ritual is complete', () => {
    render(
      <WeeklyPlanningRitualHomeCard
        cycle={makeCycle()}
        isOwner={false}
        ritual={makeRitual({ status: 'complete', weeklyFocus: 'בריאות' })}
        loadStatus="ready"
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText(/השותף\/ה השלים\/ה את טקס התכנון/)).toBeInTheDocument();
    expect(screen.getByText('מיקוד: בריאות')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
