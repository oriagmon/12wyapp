import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DuoStreakCard } from '../components/DuoStreakCard';
import type { DuoStreakSummary } from '../lib/types';

afterEach(cleanup);

function makeDuoStreak(overrides: Partial<DuoStreakSummary> = {}): DuoStreakSummary {
  return {
    currentStreak: 0,
    bestStreak: 0,
    totalDuoWins: 0,
    latestDuoSuccess: null,
    participants: [
      { userId: 10, displayName: 'א', email: 'a@a.com', hasAvatar: false, avatarVersion: 0 },
      { userId: 20, displayName: 'ב', email: 'b@a.com', hasAvatar: false, avatarVersion: 0 },
    ],
    ...overrides,
  };
}

describe('DuoStreakCard', () => {
  it('renders nothing when duoStreak is null (no accepted partnership)', () => {
    const { container } = render(<DuoStreakCard duoStreak={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a motivating empty state when there has never been a duo success', () => {
    render(<DuoStreakCard duoStreak={makeDuoStreak()} />);
    expect(screen.getByText(/עדיין אין שבוע Duo מנצח/)).toBeInTheDocument();
    expect(screen.getByText('🔥 0')).toBeInTheDocument();
  });

  it('shows a "streak stopped" message when there was history but the current streak is 0', () => {
    render(<DuoStreakCard duoStreak={makeDuoStreak({ currentStreak: 0, bestStreak: 3, totalDuoWins: 4 })} />);
    expect(screen.getByText(/הרצף המשותף נעצר/)).toBeInTheDocument();
  });

  it('shows no motivational/empty-state copy at all while an active streak is running', () => {
    render(<DuoStreakCard duoStreak={makeDuoStreak({ currentStreak: 2, bestStreak: 2, totalDuoWins: 2 })} />);
    expect(screen.queryByText(/עדיין אין שבוע/)).not.toBeInTheDocument();
    expect(screen.queryByText(/הרצף המשותף נעצר/)).not.toBeInTheDocument();
  });

  it('renders current/best/total numbers and both participant avatars', () => {
    render(<DuoStreakCard duoStreak={makeDuoStreak({ currentStreak: 3, bestStreak: 5, totalDuoWins: 8 })} />);
    expect(screen.getByText('🔥 3')).toBeInTheDocument();
    expect(screen.getByText('🏆 5')).toBeInTheDocument();
    expect(screen.getByText('✅ 8')).toBeInTheDocument();
    // Both participants' initials-fallback avatars are rendered (no avatar uploaded).
    expect(screen.getAllByText('א')).toHaveLength(2);
    expect(screen.getAllByText('ב')).toHaveLength(2);
  });

  it('never hardcodes participant identities — reflects whatever displayName/email is provided', () => {
    render(
      <DuoStreakCard
        duoStreak={makeDuoStreak({
          participants: [
            { userId: 1, displayName: 'דני', email: 'danny@x.com', hasAvatar: false, avatarVersion: 0 },
            { userId: 2, displayName: 'רותי', email: 'ruti@x.com', hasAvatar: false, avatarVersion: 0 },
          ],
        })}
      />
    );
    expect(screen.getByText('דנ')).toBeInTheDocument(); // initials fallback from Avatar
    expect(screen.getByText('רו')).toBeInTheDocument();
  });

  it('shows unambiguous visible identities even when both fallback avatars have OR initials', () => {
    const data = makeDuoStreak();
    data.participants[0] = { ...data.participants[0], displayName: '', email: 'ori@example.test' };
    data.participants[1] = { ...data.participants[1], displayName: '', email: 'oren@example.test' };
    render(<DuoStreakCard duoStreak={data} />);
    expect(screen.getAllByText('OR')).toHaveLength(2);
    expect(screen.getByText('ori@example.test')).toBeVisible();
    expect(screen.getByText('oren@example.test')).toBeVisible();
  });

  it('adds email identifiers when two display names are identical', () => {
    const data = makeDuoStreak();
    data.participants.forEach((participant) => { participant.displayName = 'Same name'; });
    render(<DuoStreakCard duoStreak={data} />);
    expect(screen.getByText('a@a.com')).toBeVisible();
    expect(screen.getByText('b@a.com')).toBeVisible();
  });
});
