import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyGrid } from '../components/WeeklyGrid';
import type { Goal } from '../lib/types';

afterEach(cleanup);
const goals: Goal[] = [{
  id: 1, title: 'בריאות', color: 'emerald', tactics: [{
    id: 10, title: 'הרגל יומי', weekdays: [0, 1], startWeek: 1, endWeek: 12, evidenceWeeks: [1],
    completions: [{ week: 1, weekday: 0, done: true, hasEvidence: true }],
  }],
}];

describe('WeeklyGrid', () => {
  it('shows an empty state with no tactics', () => {
    render(<WeeklyGrid goals={[]} week={1} isOwner onToggle={vi.fn()} />);
    expect(screen.getByText(/אין עדיין טקטיקות/)).toBeInTheDocument();
  });
  it('preserves daily completion callbacks and never puts attachment actions in tactic rows', () => {
    const onToggle = vi.fn();
    render(<WeeklyGrid goals={goals} week={1} isOwner onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'הרגל יומי — ב׳, לביצוע' }));
    expect(onToggle).toHaveBeenCalledWith(10, 1, true);
    expect(screen.getAllByLabelText('לא מתוזמן')).toHaveLength(5);
    expect(screen.queryByText(/📎|צרופות/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
  it('keeps partner completions read-only and uses the selected week', () => {
    render(<WeeklyGrid goals={goals} week={2} isOwner={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'הרגל יומי — א׳, לביצוע' })).toBeDisabled();
    expect(screen.queryByText(/📎|צרופות/)).not.toBeInTheDocument();
  });
});
