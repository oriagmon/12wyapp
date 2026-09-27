import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompetitionBanner } from '../components/CompetitionBanner';

afterEach(cleanup);

const user = {
  id: 1,
  email: 'ori@example.test',
  displayName: 'Ori',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  successStreak: 0,
};

const partner = {
  id: 2,
  email: 'partner@example.test',
  displayName: 'Partner',
  hasAvatar: false,
  avatarVersion: 0,
  partnershipId: 1,
};

describe('CompetitionBanner', () => {
  it('keeps the signed-in user first and challenges them to close a deficit', () => {
    render(
      <CompetitionBanner
        user={user}
        partner={partner}
        ownAverage={72.5}
        partnerAverage={81}
      />
    );

    const competitors = screen.getAllByText(/72.5%|81%/);
    expect(competitors.map((item) => item.textContent)).toEqual(['72.5%', '81%']);
    expect(screen.getByText('חסרות לך 8.5 נקודות. זה השבוע לסגור את הפער.')).toBeInTheDocument();
  });

  it('handles a tie and missing averages without inventing a winner', () => {
    const { rerender } = render(
      <CompetitionBanner user={user} partner={partner} ownAverage={85} partnerAverage={85} />
    );
    expect(screen.getByText('יש תיקו. הטקטיקה הבאה שתושלם תיקח את ההובלה.')).toBeInTheDocument();

    rerender(
      <CompetitionBanner user={user} partner={partner} ownAverage={null} partnerAverage={85} />
    );
    expect(screen.getByText('התחרות מתחילה ברגע שלשניכם יש ציון.')).toBeInTheDocument();
  });
});
