import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionHeatmap, ExecutionHeatmapGrid, heatmapCellLabel } from '../components/ExecutionHeatmap';
import { useExecutionHeatmap } from '../hooks/useExecutionHeatmap';
import { ProfilePage } from '../pages/ProfilePage';
import { heatmapFixture } from './executionHeatmapFixtures';

vi.mock('../hooks/useExecutionHeatmap', () => ({ useExecutionHeatmap: vi.fn() }));
vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 1, email: 'owner@example.test', displayName: 'בעל החשבון', bio: '', hasAvatar: false, avatarVersion: 0, successStreak: 0 },
    loadStatus: 'ready',
    loadError: null,
  }),
}));

const reload = vi.fn();
beforeEach(() => {
  vi.mocked(useExecutionHeatmap).mockReturnValue({ key: '1:active', data: heatmapFixture(), loadStatus: 'ready', loadError: null, reload });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ExecutionHeatmap Hebrew accessible interaction', () => {
  it('renders 84 individually labelled cells in a seven-day, twelve-week RTL grid', () => {
    const { container } = render(<ExecutionHeatmap userId={1} />);
    expect(screen.getByRole('region', { name: 'מפת הביצוע' })).toHaveAttribute('dir', 'rtl');
    const grid = screen.getByRole('grid', { name: 'מפת ביצוע: 12 שבועות, 7 ימים בשבוע' });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(84);
    expect(within(grid).getAllByRole('row')).toHaveLength(8);
    expect(within(grid).getAllByRole('rowheader')).toHaveLength(7);
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(13);
    const buttons = within(grid).getAllByRole('button');
    expect(buttons.every((button) => button.getAttribute('aria-label')?.includes('תאריך משוער'))).toBe(true);
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelector('button[aria-current="date"]')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText(/התאריכים משוערים: אין תאריך התחלה שמור/)).toBeVisible();
  });

  it('supports touch/click inspection in a persistent live summary, not just a hover tooltip', () => {
    const data = heatmapFixture();
    render(<ExecutionHeatmapGrid data={data} />);
    fireEvent.click(screen.getByRole('button', { name: heatmapCellLabel(data.days[0]) }));
    const detail = screen.getByRole('status');
    expect(detail).toHaveAttribute('aria-live', 'polite');
    expect(detail).toHaveTextContent('יום ראשון · שבוע 1');
    expect(detail).toHaveTextContent('1 מתוך 1 פעולות בוצעו · 100%');
    fireEvent.click(screen.getByRole('button', { name: heatmapCellLabel(data.days[1]) }));
    expect(detail).toHaveTextContent('מנוחה אינה קוטעת רצף');
    fireEvent.click(screen.getByRole('button', { name: heatmapCellLabel(data.days[4]) }));
    expect(detail).toHaveTextContent('יום עתידי — עדיין לא נספר');
  });

  it('supports spatial RTL arrow navigation, Home/End, and a single roving tab stop', () => {
    const data = heatmapFixture();
    const { container } = render(<ExecutionHeatmapGrid data={data} />);
    const today = screen.getByRole('button', { name: heatmapCellLabel(data.days[3]) });
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    const nextWeek = screen.getByRole('button', { name: heatmapCellLabel(data.days[10]) });
    expect(nextWeek).toHaveFocus();
    fireEvent.keyDown(nextWeek, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[11]) })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[4]) })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[81]) })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home', ctrlKey: true });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[0]) })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[0]) })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End', ctrlKey: true });
    expect(screen.getByRole('button', { name: heatmapCellLabel(data.days[83]) })).toHaveFocus();
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });

  it('keeps an unfinished current day distinct and explains the streak grace period', () => {
    render(<ExecutionHeatmapGrid data={heatmapFixture()} />);
    expect(screen.getByRole('status')).toHaveTextContent('היום עדיין פתוח');
    expect(screen.getByRole('status')).toHaveTextContent('הרצף נשמר עד סיום היום בישראל');
    const today = screen.getByRole('button', { name: /היום עוד פתוח.*היום טרם הסתיים/ });
    expect(today).toHaveAttribute('data-state', 'pending');
    expect(today).toHaveAttribute('aria-current', 'date');
  });

  it('communicates failure/partial/success without relying on color alone and displays exact summary', () => {
    const data = heatmapFixture();
    data.days[0] = { ...data.days[0], state: 'failed', completed: 0, score: 0, intensity: 0 };
    data.days[2] = { ...data.days[2], state: 'partial', completed: 84, scheduled: 100, score: 84, intensity: 3 };
    render(<ExecutionHeatmapGrid data={data} />);
    expect(screen.getByRole('button', { name: /שבוע 1, יום ראשון.*לא בוצע/ })).toHaveTextContent('−');
    expect(screen.getByRole('button', { name: /שבוע 1, יום שלישי.*ביצוע חלקי.*84%/ })).toHaveAttribute('data-intensity', '3');
    expect(screen.getByLabelText('מקרא מפת הביצוע')).toHaveTextContent('היעד הושג');
    expect(screen.getByLabelText('סיכום הביצוע היומי')).toHaveTextContent('הרצף הנוכחי2 ימי הצלחה');
    expect(screen.getByText('2 פעולות שכבר הפכו להתקדמות.')).toBeVisible();
  });

  it('passes archive/refresh props, labels partner access and distinguishes unplayed archive days', () => {
    const data = heatmapFixture();
    data.access = 'partner';
    data.cycle!.isActive = false;
    data.days[10] = { ...data.days[10], phase: 'outside-cycle', state: 'not-reached' };
    vi.mocked(useExecutionHeatmap).mockReturnValue({ key: '2:7', data, loadStatus: 'ready', loadError: null, reload });
    render(<ExecutionHeatmap userId={2} cycleId={7} refreshKey={99} />);
    expect(useExecutionHeatmap).toHaveBeenCalledWith(2, 7, 99);
    expect(screen.getByText(/מחזור בדיקה · מחזור שהסתיים · צפייה בלבד/)).toBeVisible();
    expect(screen.getByText('הרצף בסיום המחזור')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: heatmapCellLabel(data.days[10]) }));
    expect(screen.getByRole('status')).toHaveTextContent('המחזור הסתיים לפני השבוע הזה');
    expect(screen.queryByRole('button', { name: /שמירה|עריכה/ })).not.toBeInTheDocument();
  });

  it('shows an honest empty-plan state and no strongest-day claim when nothing was completed', () => {
    const data = heatmapFixture();
    data.days = data.days.map((day) => ({ ...day, state: 'unscheduled', scheduled: 0, completed: 0, score: null, intensity: 0 }));
    data.summary = { currentStreak: 0, bestStreak: 0, successfulDays: 0, completedOccurrences: 0, scheduledOccurrences: 0, strongestWeekday: null };
    render(<ExecutionHeatmapGrid data={data} />);
    expect(screen.getByText(/עדיין אין פעולות מתוכננות במחזור הזה/)).toBeVisible();
    expect(screen.queryByText(/מוביל:/)).not.toBeInTheDocument();
  });

  it('shows a no-cycle state without fabricated cells', () => {
    vi.mocked(useExecutionHeatmap).mockReturnValue({ key: '1:active', data: { ...heatmapFixture(), cycle: null, days: [] }, loadStatus: 'ready', loadError: null, reload });
    render(<ExecutionHeatmap userId={1} />);
    expect(screen.getByText(/עוד אין מחזור פעיל/)).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('exposes loading and recoverable failure instead of silently hiding the feature', () => {
    vi.mocked(useExecutionHeatmap).mockReturnValue({ key: '1:active', data: null, loadStatus: 'loading', loadError: null, reload });
    const { rerender } = render(<ExecutionHeatmap userId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('טוען');
    vi.mocked(useExecutionHeatmap).mockReturnValue({ key: '1:active', data: null, loadStatus: 'error', loadError: 'הגישה נדחתה', reload });
    rerender(<ExecutionHeatmap userId={1} />);
    expect(screen.getByRole('alert')).toHaveTextContent('הגישה נדחתה');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('mounts on the owner profile with the profile user ID', () => {
    render(<ProfilePage />);
    expect(useExecutionHeatmap).toHaveBeenCalledWith(1, undefined, undefined);
    expect(screen.getByRole('heading', { name: 'מפת הביצוע' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'פרטים אישיים' })).toBeVisible();
  });
});
