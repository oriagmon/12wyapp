import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrimaryGoalHero } from '../components/PrimaryGoalHero';
import type { Cycle } from '../lib/types';

afterEach(cleanup);

const baseCycle: Cycle = {
  id: 1,
  name: 'מחזור',
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
  createdAt: '',
  updatedAt: '',
};

const LONG_VISION =
  'עד 28 בנובמבר אהיה חזק יותר, אראה טוב ושרירי יותר - במיוחד באזור החזה, הכתפיים, ' +
  'הידיים והגב - ואבנה הרגלי אימון ותזונה שיישארו איתי גם אחרי סוף המחזור הזה.';

describe('PrimaryGoalHero', () => {
  it('uses cycle vision as the headline and shows primary goal metrics', () => {
    render(
      <PrimaryGoalHero
        cycle={{
          id: 1,
          name: 'מחזור',
          currentWeek: 2,
          isActive: true,
          vision: 'להתחזק באופן עקבי',
          successDefinition: '',
          whyItMatters: '',
          blockers: '',
          risks: '',
          lagMeasures: '',
          leadMeasures: '',
          notes: '',
          createdAt: '',
          updatedAt: '',
        }}
        goals={[
          {
            id: 1,
            title: 'כושר',
            color: 'emerald',
            tactics: [
              {
                id: 1,
                title: 'אימון',
                weekdays: [1],
                startWeek: 1,
                endWeek: 12,
                completions: [],
              },
            ],
          },
        ]}
        currentScore={75}
      />
    );

    expect(screen.getByRole('heading', { name: 'להתחזק באופן עקבי' })).toBeInTheDocument();
    expect(screen.getByText('כושר')).toBeInTheDocument();
    expect(screen.getByText('1 טקטיקה למטרה')).toBeInTheDocument();
    expect(screen.getByText('ביצוע השבוע: 75%')).toBeInTheDocument();
  });

  it('shows a long vision in full, with nothing hidden behind a toggle', () => {
    render(
      <PrimaryGoalHero
        cycle={{ ...baseCycle, vision: LONG_VISION }}
        goals={[{ id: 1, title: 'כושר', color: 'emerald', tactics: [] }]}
        currentScore={40}
      />
    );

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(LONG_VISION);
    expect(heading.textContent).not.toContain('...');
    expect(heading.textContent).not.toContain('\u2026');
    expect(screen.queryByRole('button', { name: /הצגת המטרה המלאה|הצגה מקוצרת/ })).not.toBeInTheDocument();
  });
});
