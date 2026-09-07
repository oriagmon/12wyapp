import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayList } from '../components/TodayList';
import type { Goal } from '../lib/types';

afterEach(cleanup);
const goals: Goal[] = [{
  id: 1, title: 'בריאות', color: 'emerald', tactics: [{
    id: 10, title: 'הרגל יומי', weekdays: [0, 1, 2, 3, 4, 5, 6], startWeek: 1, endWeek: 12,
    evidenceWeeks: [1], completions: [
      { week: 1, weekday: 0, done: true, hasEvidence: true },
      { week: 1, weekday: 1, done: true },
    ],
  }],
}];
describe('TodayList quick execution', () => {
  it('keeps the exact day count and daily toggles, with no tactic attachment controls', () => {
    const onToggle = vi.fn();
    render(<TodayList goals={goals} currentWeek={1} isOwner onToggle={onToggle} />);
    expect(screen.getByText('2/7 ימים')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הרגל יומי — ג׳, לא בוצע' }));
    expect(onToggle).toHaveBeenCalledWith(10, 2, true);
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.queryByText(/📎|צרופות/)).not.toBeInTheDocument();
  });
  it('keeps partner execution read-only', () => {
    render(<TodayList goals={goals} currentWeek={1} isOwner={false} onToggle={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
  it('does not show unscheduled tactics just because they have legacy evidence', () => {
    const later = [{ ...goals[0], tactics: [{ ...goals[0].tactics[0], startWeek: 2 }] }];
    render(<TodayList goals={later} currentWeek={1} isOwner onToggle={vi.fn()} />);
    expect(screen.getByText('אין טקטיקות מתוזמנות לשבוע הזה.')).toBeInTheDocument();
  });
});
