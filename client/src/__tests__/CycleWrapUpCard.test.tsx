import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CycleWrapUpCard } from '../components/CycleWrapUpCard';
import type { WeekScore } from '../lib/types';

afterEach(cleanup);

function scores(values: (number | null)[]): WeekScore[] {
  return values.map((score, index) => ({
    week: index + 1,
    scheduled: 10,
    completed: score === null ? 0 : Math.round((score / 100) * 10),
    score,
  }));
}

const FULL = scores([90, 80, 70, 95, 60, 85, 88, 92, 100, 75, 86, 90]);

describe('CycleWrapUpCard', () => {
  it('stays out of the way until the closing weeks of the cycle', () => {
    const { container } = render(<CycleWrapUpCard currentWeek={10} weekScores={FULL} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('summarises the cycle from the scores already on screen once week 11 arrives', () => {
    render(<CycleWrapUpCard currentWeek={11} weekScores={FULL} />);
    const card = screen.getByRole('region', { name: /מתקרבים לסיום/ });
    // (90+80+70+95+60+85+88+92+100+75+86+90)/12 = 84.25 -> 84
    expect(within(card, 'ממוצע ביצוע')).toBe('84%');
    expect(within(card, 'שבועות מעל היעד')).toBe('8/12');
    expect(within(card, 'השבוע הכי חזק')).toBe('100%');
    expect(screen.getByText('שבוע 9')).toBeVisible();
    expect(screen.getByText(/1% מתחת ליעד/)).toBeVisible();
  });

  it('switches to a closing headline in week 12', () => {
    render(<CycleWrapUpCard currentWeek={12} weekScores={FULL} />);
    expect(screen.getByRole('region', { name: /סיכום המחזור/ })).toBeVisible();
    expect(screen.getByText(/ב‑WAM האחרון/)).toBeVisible();
  });

  it('ignores unscored weeks instead of counting them as zeros', () => {
    render(<CycleWrapUpCard currentWeek={12} weekScores={scores([90, null, null, 80, null, null, null, null, null, null, null, null])} />);
    const card = screen.getByRole('region', { name: /סיכום המחזור/ });
    expect(within(card, 'ממוצע ביצוע')).toBe('85%');
    expect(within(card, 'שבועות מעל היעד')).toBe('1/2');
  });

  it('renders nothing when no week has been scored yet', () => {
    const { container } = render(<CycleWrapUpCard currentWeek={12} weekScores={scores(Array(12).fill(null))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names which half of the cycle was stronger', () => {
    render(<CycleWrapUpCard currentWeek={12} weekScores={scores([50, 50, 50, 50, 50, 50, 90, 90, 90, 90, 90, 90])} />);
    expect(screen.getByText('החצי השני היה חזק יותר: 50% בשישה הראשונים מול 90% בשישה האחרונים.')).toBeVisible();
  });
});

/** Reads the value rendered under a given stat label. */
function within(card: HTMLElement, label: string): string {
  const dt = Array.from(card.querySelectorAll('dt')).find((node) => node.textContent === label);
  return dt?.nextElementSibling?.textContent ?? '';
}
