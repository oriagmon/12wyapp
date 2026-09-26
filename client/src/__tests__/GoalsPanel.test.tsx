import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalsPanel } from '../components/GoalsPanel';

afterEach(cleanup);

const callbacks = {
  onCreateGoal: vi.fn(),
  onRenameGoal: vi.fn(),
  onDeleteGoal: vi.fn(),
  onCreateTactic: vi.fn(),
  onUpdateTactic: vi.fn(),
  onDeleteTactic: vi.fn(),
};

describe('GoalsPanel week view', () => {
  it('toggles between current-week effective tactics and the full cycle plan', () => {
    render(
      <GoalsPanel
        goals={[
          {
            id: 1,
            title: 'Goal A',
            color: 'emerald',
            tactics: [
              {
                id: 10,
                title: 'Base tactic',
                weekdays: [0],
                startWeek: 1,
                endWeek: 12,
                completions: [],
                overrides: [{ week: 3, title: 'Week 3 tactic', weekdays: [2] }],
              },
              {
                id: 11,
                title: 'Later tactic',
                weekdays: [4],
                startWeek: 4,
                endWeek: 12,
                completions: [],
              },
            ],
          },
        ]}
        isOwner
        currentWeek={3}
        {...callbacks}
      />
    );

    expect(screen.getByText('Week 3 tactic')).toBeInTheDocument();
    expect(screen.queryByText('Base tactic')).not.toBeInTheDocument();
    expect(screen.queryByText('Later tactic')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'כל השבועות' }));

    expect(screen.getByText('Base tactic')).toBeInTheDocument();
    expect(screen.getByText('Later tactic')).toBeInTheDocument();
    expect(screen.queryByText('Week 3 tactic')).not.toBeInTheDocument();
  });
});
