import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CycleProgressCard } from '../components/CycleProgressCard';

describe('CycleProgressCard', () => {
  afterEach(cleanup);

  it('shows how far the cycle has run and prompts the monthly review one week ahead', () => {
    render(<CycleProgressCard currentWeek={3} weekScore={40} />);

    const cycle = screen.getByRole('progressbar', { name: '25% מהמחזור מאחורינו' });
    expect(cycle).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/25% מהדרך/)).toHaveTextContent('נותרו 9 שבועות');
    expect(screen.getByText(/בשבוע הבא פגישת הסיכום החודשית 1/)).toBeInTheDocument();
    expect(screen.getByText(/שבוע 4 · לקבוע עכשיו/)).toBeInTheDocument();
  });

  // The two numbers used to live in separate stacked cards and read as rival versions of the
  // same percentage; both must stay legible, and distinct, side by side.
  it('reports this week against the 85% standard alongside the cycle position', () => {
    render(<CycleProgressCard currentWeek={3} weekScore={40} />);

    expect(screen.getByRole('progressbar', { name: 'ביצוע השבוע מול יעד 85%' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('נותרו 45% ליעד')).toBeInTheDocument();
    expect(screen.getByText(/שבוע 3/)).toHaveTextContent('מתוך 12');
  });

  it('celebrates a week already at or above the standard', () => {
    render(<CycleProgressCard currentWeek={5} weekScore={90} />);

    expect(screen.getByText('🏆 מעל היעד')).toBeInTheDocument();
    expect(screen.queryByText(/נותרו .* ליעד/)).not.toBeInTheDocument();
  });

  it('does not imply a zero week when nothing is scheduled at all', () => {
    render(<CycleProgressCard currentWeek={2} weekScore={null} />);

    expect(screen.getAllByText('אין טקטיקות מתוזמנות השבוע').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar', { name: 'ביצוע השבוע מול יעד 85%' }))
      .toHaveAttribute('aria-valuetext', 'אין טקטיקות מתוזמנות השבוע');
  });

  it('marks the final week as the last one rather than counting down to zero', () => {
    render(<CycleProgressCard currentWeek={12} weekScore={70} />);

    expect(screen.getByText(/100% מהדרך/)).toHaveTextContent('השבוע האחרון');
  });
});
