import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TacticForm } from '../components/TacticForm';

afterEach(cleanup);

const tactic = {
  id: 1,
  title: 'Base',
  weekdays: [0],
  startWeek: 1,
  endWeek: 12,
  completions: [],
  overrides: [],
};

describe('TacticForm adaptation scope', () => {
  it('defaults to the current week only and can apply through the rest of the cycle', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    const { rerender } = render(
      <TacticForm
        initial={tactic}
        currentWeek={3}
        onSubmit={onSubmit}
        onCancel={() => undefined}
        submitLabel="שמירה"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'currentWeek' })));

    onSubmit.mockClear();
    rerender(
      <TacticForm
        initial={tactic}
        currentWeek={3}
        onSubmit={onSubmit}
        onCancel={() => undefined}
        submitLabel="שמירה"
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /להחיל רק בשבוע הנוכחי/ }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'restOfCycle' }))
    );
  });

  it('initializes from the effective current-week override', () => {
    render(
      <TacticForm
        initial={{
          ...tactic,
          overrides: [{ week: 3, title: 'Current version', weekdays: [2, 4] }],
        }}
        currentWeek={3}
        onSubmit={vi.fn()}
        onCancel={() => undefined}
        submitLabel="שמירה"
      />
    );

    expect(screen.getByRole('textbox', { name: 'שם הטקטיקה' })).toHaveValue('Current version');
    expect(screen.getByRole('button', { name: 'ג׳' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ה׳' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes after a successful void-returning adaptation save', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <TacticForm
        initial={tactic}
        currentWeek={3}
        onSubmit={onSubmit}
        onCancel={onCancel}
        submitLabel="שמירה"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });
});
