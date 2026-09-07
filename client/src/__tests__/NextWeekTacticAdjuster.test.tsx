import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextWeekTacticAdjuster, type NextWeekTactic } from '../components/NextWeekTacticAdjuster';

afterEach(cleanup);

const ONGOING: NextWeekTactic = {
  id: 7,
  goalId: 1,
  goalTitle: 'כושר',
  title: 'אימון כוח',
  weekdays: [0, 2, 4],
  adapted: false,
  baseTitle: 'אימון כוח',
  baseWeekdays: [0, 2, 4],
  nextWeekOnly: false,
};

function setup(overrides: Partial<Parameters<typeof NextWeekTacticAdjuster>[0]> = {}) {
  const onAdapt = vi.fn().mockResolvedValue(undefined);
  const onResetAdaptation = vi.fn().mockResolvedValue(undefined);
  const onAddNextWeekTactic = vi.fn().mockResolvedValue(undefined);
  render(
    <NextWeekTacticAdjuster
      targetWeek={3}
      tactics={[ONGOING]}
      goals={[{ id: 1, title: 'כושר' }]}
      editable
      onAdapt={onAdapt}
      onResetAdaptation={onResetAdaptation}
      onAddNextWeekTactic={onAddNextWeekTactic}
      {...overrides}
    />
  );
  return { onAdapt, onResetAdaptation, onAddNextWeekTactic };
}

describe('NextWeekTacticAdjuster', () => {
  it('scopes a load change to the upcoming week instead of the whole cycle', async () => {
    const { onAdapt } = setup();

    fireEvent.click(screen.getByRole('button', { name: /התאמת "אימון כוח" לשבוע 3/ }));
    // Drop one of the three sessions — the exact case this section exists for.
    fireEvent.click(screen.getByRole('button', { name: 'ה׳' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירה לשבוע 3' }));

    await waitFor(() => expect(onAdapt).toHaveBeenCalledTimes(1));
    expect(onAdapt).toHaveBeenCalledWith(7, { title: 'אימון כוח', weekdays: [0, 2] });
  });

  it('creates an extra tactic that lives only in the upcoming week', async () => {
    const { onAddNextWeekTactic } = setup();

    fireEvent.click(screen.getByRole('button', { name: /הוספת טקטיקה לשבוע 3 בלבד/ }));
    fireEvent.change(screen.getByLabelText('מה עושים'), { target: { value: 'לארוז לטיול' } });
    fireEvent.click(screen.getByRole('button', { name: 'ד׳' }));
    fireEvent.click(screen.getByRole('button', { name: 'הוספה לשבוע 3' }));

    await waitFor(() => expect(onAddNextWeekTactic).toHaveBeenCalledTimes(1));
    expect(onAddNextWeekTactic).toHaveBeenCalledWith({ goalId: 1, title: 'לארוז לטיול', weekdays: [3] });
  });

  it('lets an adaptation be taken back, showing what the tactic reverts to', async () => {
    const { onResetAdaptation } = setup({
      tactics: [{ ...ONGOING, adapted: true, title: 'אימון כוח קליל', weekdays: [0] }],
    });

    expect(screen.getByText('מותאם לשבוע 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /התאמת "אימון כוח קליל" לשבוע 3/ }));
    fireEvent.click(screen.getByRole('button', { name: /חזרה למקורי/ }));

    await waitFor(() => expect(onResetAdaptation).toHaveBeenCalledWith(7));
  });

  it('marks a one-week tactic and offers no revert, since removing it is a plain delete', async () => {
    setup({ tactics: [{ ...ONGOING, nextWeekOnly: true, adapted: false }] });

    expect(screen.getByText('לשבוע 3 בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /התאמת "אימון כוח" לשבוע 3/ }));
    expect(screen.queryByRole('button', { name: /חזרה למקורי/ })).not.toBeInTheDocument();
  });

  it('offers nothing to change when the viewer cannot edit', () => {
    setup({ editable: false });

    expect(screen.getByText('אימון כוח')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /התאמת/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הוספת טקטיקה/ })).not.toBeInTheDocument();
  });

  it('refuses to save an adaptation that empties the week', async () => {
    const { onAdapt } = setup();

    fireEvent.click(screen.getByRole('button', { name: /התאמת "אימון כוח" לשבוע 3/ }));
    for (const day of ['א׳', 'ג׳', 'ה׳']) {
      fireEvent.click(screen.getByRole('button', { name: day }));
    }

    expect(screen.getByRole('button', { name: 'שמירה לשבוע 3' })).toBeDisabled();
    expect(onAdapt).not.toHaveBeenCalled();
  });
});
