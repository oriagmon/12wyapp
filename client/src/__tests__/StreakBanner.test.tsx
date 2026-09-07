import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StreakBanner } from '../components/StreakBanner';
import { api } from '../lib/api';

afterEach(cleanup);

function heatmap(summary: Partial<{ currentStreak: number; bestStreak: number; successfulDays: number }>, isActive = true) {
  return {
    access: 'owner',
    cycle: { id: 1, name: 'סבב ראשון', currentWeek: 3, isActive },
    today: '2026-01-01',
    startDate: '2026-01-01',
    endDate: '2026-03-25',
    dateBasis: 'current-week-anchor',
    targetScore: 85,
    days: [],
    summary: {
      currentStreak: 0,
      bestStreak: 0,
      successfulDays: 0,
      completedOccurrences: 0,
      scheduledOccurrences: 0,
      strongestWeekday: null,
      ...summary,
    },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('StreakBanner on the home screen', () => {
  it('leads with the streak itself so it is the first thing seen', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(heatmap({ currentStreak: 4, bestStreak: 9, successfulDays: 12 }));
    render(<StreakBanner userId={1} />);

    const banner = await screen.findByRole('region', { name: 'רצף ימי ההצלחה' });
    expect(banner).toHaveTextContent('4');
    expect(banner).toHaveTextContent('ימי הצלחה ברצף');
    expect(banner).toHaveTextContent('9');
    expect(banner).toHaveTextContent('12');
  });

  it('celebrates a personal record instead of just printing a number', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(heatmap({ currentStreak: 9, bestStreak: 9, successfulDays: 20 }));
    render(<StreakBanner userId={1} />);

    expect(await screen.findByText('שיא אישי')).toBeInTheDocument();
    expect(screen.getByText(/הרצף הכי ארוך שלך/)).toBeInTheDocument();
  });

  it('turns a broken streak into a restart, naming the daily target', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(heatmap({ currentStreak: 0, bestStreak: 6, successfulDays: 10 }));
    render(<StreakBanner userId={1} />);

    expect(await screen.findByText(/יום אחד מעל 85% מתחיל רצף חדש/)).toBeInTheDocument();
    expect(screen.queryByText('שיא אישי')).not.toBeInTheDocument();
  });

  it('counts down to the record when it is within reach', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(heatmap({ currentStreak: 7, bestStreak: 8, successfulDays: 15 }));
    render(<StreakBanner userId={1} />);

    expect(await screen.findByText(/עוד 2 ימים ותשברו את השיא/)).toBeInTheDocument();
  });

  it('stays hidden until real numbers arrive, so it never flashes a zero streak', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => { resolve = r; }) as ReturnType<typeof api.get>);
    render(<StreakBanner userId={1} />);

    expect(screen.queryByRole('region', { name: 'רצף ימי ההצלחה' })).not.toBeInTheDocument();
    resolve(heatmap({ currentStreak: 2, bestStreak: 3, successfulDays: 5 }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'רצף ימי ההצלחה' })).toBeInTheDocument());
  });

  it('renders nothing when there is no cycle to have a streak in', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...heatmap({}), cycle: null });
    const { container } = render(<StreakBanner userId={1} />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });
});
