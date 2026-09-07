import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from '../components/Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('shows initials from the display name when there is no avatar image', () => {
    render(
      <Avatar userId={1} displayName="אורי כהן" email="ori@a.com" hasAvatar={false} avatarVersion={0} successStreak={3} />
    );
    expect(screen.getByText('אכ')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'אורי כהן' })).not.toBeInTheDocument();
  });

  it('falls back to initials from the email when there is no display name', () => {
    render(<Avatar userId={1} displayName="" email="zed@a.com" hasAvatar={false} avatarVersion={0} successStreak={0} />);
    expect(screen.getByText('ZE')).toBeInTheDocument();
  });

  it('renders the authenticated avatar image, cache-busted by both user id and version', () => {
    render(
      <Avatar userId={7} displayName="אורי" email="ori@a.com" hasAvatar avatarVersion={4} successStreak={2} />
    );
    const img = screen.getByRole('img', { name: 'אורי' }) as HTMLImageElement;
    expect(img.src).toContain('/api/profile/avatar?u=7&v=4');
  });

  it('falls back to initials if the avatar image fails to load', () => {
    render(<Avatar userId={1} displayName="אורי" email="ori@a.com" hasAvatar avatarVersion={1} successStreak={2} />);
    const img = screen.getByRole('img', { name: 'אורי' });
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: 'אורי' })).not.toBeInTheDocument();
    expect(screen.getByText('או')).toBeInTheDocument();
  });

  it('exposes the success-streak chip via an accessible role and name (not just a title/aria-label attribute lookup)', () => {
    render(<Avatar userId={1} displayName="אורי" email="ori@a.com" hasAvatar={false} avatarVersion={0} successStreak={7} />);
    const chip = screen.getByRole('img', { name: 'רצף הצלחות: 7 שבועות רצופים בציון 85% ומעלה' });
    expect(chip).toHaveTextContent('7');
  });

  it('shows the chip even when the streak is 0 (does not hide a zero streak)', () => {
    render(<Avatar userId={1} displayName="אורי" email="ori@a.com" hasAvatar={false} avatarVersion={0} successStreak={0} />);
    expect(screen.getByRole('img', { name: /רצף הצלחות: 0/ })).toHaveTextContent('0');
  });

  it('uses singular wording for a streak of exactly 1 week', () => {
    render(<Avatar userId={1} displayName="אורי" email="ori@a.com" hasAvatar={false} avatarVersion={0} successStreak={1} />);
    expect(screen.getByRole('img', { name: 'רצף הצלחות: 1 שבוע רצוף בציון 85% ומעלה' })).toBeInTheDocument();
  });

  it('includes a different user id in the image URL, so two accounts never collide in the browser cache', () => {
    const { rerender } = render(
      <Avatar userId={1} displayName="A" email="a@a.com" hasAvatar avatarVersion={1} successStreak={0} />
    );
    expect((screen.getByRole('img', { name: 'A' }) as HTMLImageElement).src).toContain('/api/profile/avatar?u=1&v=1');

    rerender(<Avatar userId={2} displayName="B" email="b@a.com" hasAvatar avatarVersion={1} successStreak={0} />);
    expect((screen.getByRole('img', { name: 'B' }) as HTMLImageElement).src).toContain('/api/profile/avatar?u=2&v=1');
  });
});
