import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WamDuePunishments } from '../components/WamDuePunishments';
import type { WamDetail, WamDuePunishment } from '../lib/types';

afterEach(cleanup);

function makeWam(overrides: Partial<WamDetail> = {}): WamDetail {
  return {
    id: 2,
    week: 4,
    status: 'draft',
    isHistorical: false,
    wins: '',
    misses: '',
    blockers: '',
    lessonsLearned: '',
    notes: '',
    adjustmentNotes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    partnership: {
      id: 1,
      initiatorId: 10,
      inviteeId: 20,
      initiatorEmail: 'a@a.com',
      inviteeEmail: 'b@a.com',
    },
    mismatch: false,
    nextWam: { at: null, durationMinutes: null, sequence: 0 },
    calendarInvitations: {
      a: { status: null, error: null, sentAt: null },
      b: { status: null, error: null, sentAt: null },
    },
    reviews: {
      a: {
        userId: 10,
        email: 'a@a.com',
        rating: null,
        scoreSnapshot: null,
        live: { hasCycle: false, cycleId: null, cycleName: null, cycleIsActive: false, currentWeek: null, score: null, scheduled: 0, completed: 0 },
      },
      b: {
        userId: 20,
        email: 'b@a.com',
        rating: null,
        scoreSnapshot: null,
        live: { hasCycle: false, cycleId: null, cycleName: null, cycleIsActive: false, currentWeek: null, score: null, scheduled: 0, completed: 0 },
      },
    },
    commitments: [],
    punishments: [],
    duePunishments: [],
    canAddPunishment: true,
    duoStreak: {
      currentStreak: 0,
      bestStreak: 0,
      totalDuoWins: 0,
      latestDuoSuccess: null,
      participants: [
        { userId: 10, displayName: '', email: 'a@a.com', hasAvatar: false, avatarVersion: 0 },
        { userId: 20, displayName: '', email: 'b@a.com', hasAvatar: false, avatarVersion: 0 },
      ],
    },
    ...overrides,
  };
}

function makeDuePunishment(overrides: Partial<WamDuePunishment> = {}): WamDuePunishment {
  return {
    id: 1,
    label: 'לשטוף כלים',
    done: false,
    completedAt: null,
    sourceWamId: 1,
    sourceWeek: 3,
    authorUserId: 10,
    authorLabel: 'a@a.com',
    assignedUserId: 20,
    assigneeLabel: 'b@a.com',
    canToggle: true,
    ...overrides,
  };
}

describe('WamDuePunishments', () => {
  it('renders nothing at all when there are no due punishments (no empty-state clutter)', () => {
    const { container } = render(<WamDuePunishments wam={makeWam()} onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the checklist with author/assignee/source-week metadata for each due item', () => {
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment()] })} onToggle={vi.fn()} />);
    expect(screen.getByText('לשטוף כלים')).toBeInTheDocument();
    expect(screen.getByText('מאת a@a.com')).toBeInTheDocument();
    expect(screen.getByText('על b@a.com')).toBeInTheDocument();
    expect(screen.getByText('מפגישת שבוע 3')).toBeInTheDocument();
  });

  it('only enables the checkbox for the current assignee (canToggle) — disabled otherwise', () => {
    render(
      <WamDuePunishments
        wam={makeWam({
          duePunishments: [makeDuePunishment({ canToggle: true }), makeDuePunishment({ id: 2, canToggle: false })],
        })}
        onToggle={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0]).not.toBeDisabled();
    expect(checkboxes[1]).toBeDisabled();
  });

  it('calls onToggle with the punishment id and new checked state', () => {
    const onToggle = vi.fn().mockResolvedValue({});
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ id: 42 })] })} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(42, true);
  });

  it('shows a done status and cross-off styling once completed', () => {
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ done: true, completedAt: '2026-01-05T00:00:00.000Z' })] })} onToggle={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('בוצע');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('optimistically checks the box immediately on click, before the request resolves', () => {
    let resolveToggle: (() => void) | undefined;
    const onToggle = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveToggle = () => resolve({});
        })
    );
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ done: false })] })} onToggle={onToggle} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true); // optimistic — flips before the promise settles
    resolveToggle?.();
  });

  it('rolls back the optimistic checkbox to the last server-confirmed value when the toggle request fails', async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error('שגיאת שרת'));
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ done: false })] })} onToggle={onToggle} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true); // optimistic flip

    await waitFor(() => expect(checkbox.checked).toBe(false)); // rolled back after failure
    expect(await screen.findByText('שגיאת שרת')).toBeInTheDocument();
  });

  it('re-syncs the checkbox from a server-confirmed prop change even if it was toggled locally', () => {
    const { rerender } = render(
      <WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ id: 7, done: false })] })} onToggle={vi.fn()} />
    );
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);

    rerender(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ id: 7, done: true })] })} onToggle={vi.fn()} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('ignores a rapid second click while the first toggle request is still in flight (in-flight guard)', () => {
    let resolveToggle: (() => void) | undefined;
    const onToggle = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveToggle = () => resolve({});
        })
    );
    render(<WamDuePunishments wam={makeWam({ duePunishments: [makeDuePunishment({ done: false })] })} onToggle={onToggle} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox).toBeDisabled(); // disabled while busy, so a rapid re-click cannot fire
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(1);
    resolveToggle?.();
  });
});
