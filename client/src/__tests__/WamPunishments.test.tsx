import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WamPunishments } from '../components/WamPunishments';
import type { WamDetail, WamPunishment } from '../lib/types';

afterEach(cleanup);

function makeWam(overrides: Partial<WamDetail> = {}): WamDetail {
  return {
    id: 1,
    week: 3,
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

function makePunishment(overrides: Partial<WamPunishment> = {}): WamPunishment {
  return {
    id: 1,
    label: 'לשטוף כלים',
    done: false,
    completedAt: null,
    dueWamId: null,
    authorUserId: 10,
    authorLabel: 'a@a.com',
    assignedUserId: 20,
    assigneeLabel: 'b@a.com',
    canEdit: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WamPunishments', () => {
  it('renders an empty state when there are no punishments yet', () => {
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('עדיין לא נכתבו עונשים בפגישה זו.')).toBeInTheDocument();
  });

  it('lets the caller add a punishment assigned to the partner by default, clearing the input on success', async () => {
    const onAdd = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={onAdd}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const input = screen.getByLabelText('טקסט עונש חדש');
    fireEvent.change(input, { target: { value: 'לקפל כביסה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(onAdd).toHaveBeenCalledWith('לקפל כביסה', 20); // default select is "partner" => userId 20
    await screen.findByDisplayValue('');
  });

  it('lets the caller switch the assignment to "me" before adding', async () => {
    const onAdd = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={onAdd}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('על מי מוטל העונש'), { target: { value: 'me' } });
    fireEvent.change(screen.getByLabelText('טקסט עונש חדש'), { target: { value: 'לנקות את המטבח' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(onAdd).toHaveBeenCalledWith('לנקות את המטבח', 10);
  });

  it('does not submit an empty/whitespace-only label', () => {
    const onAdd = vi.fn();
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={onAdd}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('טקסט עונש חדש'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('hides the composer entirely when canAdd is false (complete/historical WAM)', () => {
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment()] })}
        myUserId={10}
        sourceEditable
        canAdd={false}
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('טקסט עונש חדש')).not.toBeInTheDocument();
  });

  it('lets the author edit the label, reassign, and delete their own item', async () => {
    const onUpdateLabel = vi.fn().mockResolvedValue({});
    const onReassign = vi.fn().mockResolvedValue({});
    const onDelete = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={onUpdateLabel}
        onReassign={onReassign}
        onDelete={onDelete}
      />
    );

    const labelInput = screen.getByLabelText('טקסט העונש');
    fireEvent.change(labelInput, { target: { value: 'עונש מעודכן' } });
    fireEvent.blur(labelInput);
    await waitFor(() => expect(onUpdateLabel).toHaveBeenCalledWith(1, 'עונש מעודכן'));
    await waitFor(() => expect(screen.getByLabelText('שיוך מחדש של העונש')).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText('שיוך מחדש של העונש'), { target: { value: 'me' } });
    await waitFor(() => expect(onReassign).toHaveBeenCalledWith(1, 10));
    await waitFor(() => expect(screen.getByRole('button', { name: 'מחיקת עונש' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת עונש' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });

  it('renders a read-only row (no input/select/delete) when canEdit is false, e.g. the partner viewing an item they did not author', () => {
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: false })] })}
        myUserId={20} // the assignee/partner viewing, not the author
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const labelInput = screen.getByLabelText('טקסט העונש') as HTMLInputElement;
    expect(labelInput).toBeDisabled();
    expect(screen.queryByLabelText('שיוך מחדש של העונש')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'מחיקת עונש' })).not.toBeInTheDocument();
    expect(screen.getByText('על b@a.com')).toBeInTheDocument();
  });

  it('always shows the assignee chip even for the author who also gets a reassign select', () => {
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByLabelText('שיוך מחדש של העונש')).toBeInTheDocument();
    expect(screen.getByText('על b@a.com')).toBeInTheDocument();
  });

  it('disables the add composer entirely while a save is in flight, preventing a rapid double-click from double-submitting', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAdd = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAdd = () => resolve({});
        })
    );
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={onAdd}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('טקסט עונש חדש'), { target: { value: 'עונש כפול' } });
    const addButton = screen.getByRole('button', { name: 'הוספה' });
    fireEvent.click(addButton);
    expect(addButton).toBeDisabled();
    fireEvent.click(addButton); // rapid second click while saving — must be a no-op
    expect(onAdd).toHaveBeenCalledTimes(1);

    resolveAdd?.();
    await waitFor(() => expect(addButton).not.toBeDisabled());
  });

  it('rejects an empty/whitespace label on blur (no-op, not submitted) and disables all row controls while a save is in flight', async () => {
    let resolveEdit: (() => void) | undefined;
    const onUpdateLabel = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveEdit = () => resolve({});
        })
    );
    const onReassign = vi.fn();
    const onDelete = vi.fn();
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={onUpdateLabel}
        onReassign={onReassign}
        onDelete={onDelete}
      />
    );

    const labelInput = screen.getByLabelText('טקסט העונש');
    fireEvent.change(labelInput, { target: { value: 'עדכון בתהליך' } });
    fireEvent.blur(labelInput);
    expect(onUpdateLabel).toHaveBeenCalledTimes(1);

    // While the save is in flight, reassign and delete must both be disabled — a label save
    // and a reassign/delete on the same row must never overlap.
    expect(screen.getByLabelText('שיוך מחדש של העונש')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'מחיקת עונש' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת עונש' }));
    expect(onDelete).not.toHaveBeenCalled();

    resolveEdit?.();
    await waitFor(() => expect(screen.getByRole('button', { name: 'מחיקת עונש' })).not.toBeDisabled());
  });

  it('syncs the local label input when the punishment.label prop changes externally (e.g. a refresh)', () => {
    const { rerender } = render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ label: 'תווית ישנה', canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect((screen.getByLabelText('טקסט העונש') as HTMLInputElement).value).toBe('תווית ישנה');

    rerender(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ label: 'תווית מעודכנת מהשרת', canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect((screen.getByLabelText('טקסט העונש') as HTMLInputElement).value).toBe('תווית מעודכנת מהשרת');
  });

  it('enforces a maxLength of 300 on both the add and edit label inputs', () => {
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByLabelText('טקסט עונש חדש')).toHaveAttribute('maxLength', '300');
    expect(screen.getByLabelText('טקסט העונש')).toHaveAttribute('maxLength', '300');
  });

  it('shows an accessible "done" indicator on a source-side row when the due item is already completed', () => {
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true, done: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('בוצע');
  });

  it('requires explicit confirmation before reassigning a completed item, and cancelling leaves the assignment and record unchanged', async () => {
    const onReassign = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true, done: true, assignedUserId: 20, assigneeLabel: 'b@a.com' })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={onReassign}
        onDelete={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('שיוך מחדש של העונש'), { target: { value: 'me' } });
    expect(onReassign).not.toHaveBeenCalled(); // confirmation required first
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // The select stays bound to the actual (unconfirmed) server value.
    expect((screen.getByLabelText('שיוך מחדש של העונש') as HTMLSelectElement).value).toBe('partner');

    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onReassign).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((screen.getByLabelText('שיוך מחדש של העונש') as HTMLSelectElement).value).toBe('partner');

    fireEvent.change(screen.getByLabelText('שיוך מחדש של העונש'), { target: { value: 'me' } });
    fireEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(onReassign).toHaveBeenCalledWith(1, 10));
  });

  it('reassigns immediately without confirmation when the item is not yet done', () => {
    const onReassign = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true, done: false })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={onReassign}
        onDelete={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('שיוך מחדש של העונש'), { target: { value: 'me' } });
    expect(onReassign).toHaveBeenCalledWith(1, 10);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('requires explicit confirmation before deleting a completed item, and cancelling leaves it in place', async () => {
    const onDelete = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true, done: true })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת עונש' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת עונש' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });

  it('deletes immediately without confirmation when the item is not yet done', () => {
    const onDelete = vi.fn().mockResolvedValue({});
    render(
      <WamPunishments
        wam={makeWam({ punishments: [makePunishment({ canEdit: true, done: false })] })}
        myUserId={10}
        sourceEditable
        canAdd
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת עונש' }));
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows a concise read-only explanation when the source WAM is editable but adding is blocked because the next WAM is frozen', () => {
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable
        canAdd={false}
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('טקסט עונש חדש')).not.toBeInTheDocument();
    expect(screen.getByText(/לא ניתן להוסיף עונש חדש כרגע/)).toBeInTheDocument();
  });

  it('shows no blocked-hint explanation when the source WAM is not editable at all (complete/historical)', () => {
    render(
      <WamPunishments
        wam={makeWam()}
        myUserId={10}
        sourceEditable={false}
        canAdd={false}
        onAdd={vi.fn()}
        onUpdateLabel={vi.fn()}
        onReassign={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText(/לא ניתן להוסיף עונש חדש כרגע/)).not.toBeInTheDocument();
  });
});
