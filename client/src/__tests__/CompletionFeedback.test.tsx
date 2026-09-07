import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayList } from '../components/TodayList';
import { WeeklyGrid } from '../components/WeeklyGrid';
import { ScoreSummary } from '../components/ScoreSummary';
import type { Goal } from '../lib/types';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const goals: Goal[] = [{
  id: 1, title: 'מטרה ארוכה בעברית שצריכה להישבר לשורות בלי להרחיב את הדף', color: 'emerald',
  tactics: [{ id: 10, title: 'הצעד הבא שלי', weekdays: [0], startWeek: 1, endWeek: 12, completions: [] }],
}];

describe.each(['today', 'week'] as const)('confirmed feedback in %s', (type) => {
  function subject(onToggle: () => Promise<void>, isOwner = true) {
    return type === 'today'
      ? <TodayList goals={goals} currentWeek={1} isOwner={isOwner} onToggle={onToggle} />
      : <WeeklyGrid goals={goals} week={1} isOwner={isOwner} onToggle={onToggle} />;
  }

  it('blocks duplicate saves and pops only after success, then cleans up timers', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const view = render(subject(save));
    const button = screen.getByRole('button', { name: /הצעד הבא שלי — א׳/ });
    expect(button).not.toHaveClass('completion-pop');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button).not.toHaveClass('completion-pop');
    await act(async () => { resolve(); await Promise.resolve(); });
    expect(button).toHaveClass('completion-pop');
    expect(button).not.toBeDisabled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps failed saves retryable with a friendly alert and no pop', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    render(subject(save));
    const button = screen.getByRole('button', { name: /הצעד הבא שלי — א׳/ });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('alert')).toHaveTextContent('הסימון לא נשמר');
    expect(button).not.toHaveClass('completion-pop');
    expect(button).not.toBeDisabled();
  });

  it('keeps partner controls disabled', () => {
    const save = vi.fn();
    render(subject(save, false));
    const button = screen.getByRole('button', { name: /הצעד הבא שלי — א׳/ });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});

it('score navigation and initial gold scores never create celebratory particles', () => {
  const view = render(<ScoreSummary week={1} score={30} />);
  view.rerender(<ScoreSummary week={2} score={100} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByText('100%')).toBeVisible();
  expect(screen.queryByTestId('celebration-particles')).not.toBeInTheDocument();
  expect(document.querySelector('canvas')).toBeNull();
});
