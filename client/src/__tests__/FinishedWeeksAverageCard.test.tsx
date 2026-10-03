import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FinishedWeeksAverageCard } from '../components/FinishedWeeksAverageCard';

afterEach(cleanup);

describe('FinishedWeeksAverageCard', () => {
  it('shows the average and explicitly excludes the current week', () => {
    render(<FinishedWeeksAverageCard average={82.5} currentWeek={4} measuredWeeks={3} />);

    expect(screen.getByText('82.5%')).toBeInTheDocument();
    expect(
      screen.getByText('מבוסס על 3 שבועות שהסתיימו. שבוע 4 עדיין בעיצומו ולכן לא נכלל.')
    ).toBeInTheDocument();
    expect(screen.getByText('חסרות 2.5 נקודות ליעד 85%')).toBeInTheDocument();
  });

  it('does not present the active first week as a zero average', () => {
    render(<FinishedWeeksAverageCard average={null} currentWeek={1} measuredWeeks={0} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('ממתין לשבוע שהסתיים')).toBeInTheDocument();
    expect(
      screen.getByText('שבוע 1 עדיין בעיצומו. הממוצע יתחיל אחרי שהשבוע יסתיים.')
    ).toBeInTheDocument();
  });
});
