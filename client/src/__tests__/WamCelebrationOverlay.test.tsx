import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WamCelebrationOverlay } from '../components/WamCelebrationOverlay';
import type { WamCelebration, CelebrationParticipant } from '../lib/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeParticipant(overrides: Partial<CelebrationParticipant> = {}): CelebrationParticipant {
  return {
    userId: 10,
    displayName: 'דני',
    email: 'danny@a.com',
    hasAvatar: false,
    avatarVersion: 0,
    score: 90,
    ...overrides,
  };
}

describe('WamCelebrationOverlay', () => {
  it('renders a dialog with an accessible label and a status region announcing the message', () => {
    render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('focuses the close button on mount and restores focus to the previously-focused element on unmount', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'סגירה' }));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('dismisses on close-button click', () => {
    const onClose = vi.fn();
    render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const onClose = vi.fn();
    render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('contains keyboard and programmatic focus and restores body scrolling on close', () => {
    const background = document.createElement('button');
    document.body.appendChild(background);
    document.body.style.overflow = 'auto';
    const { unmount } = render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'סגירה' });
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
    background.focus();
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
    background.remove();
  });

  it('uses the latest dismissal callback after a rerender', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={first} />);
    rerender(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={latest} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('does not dismiss via backdrop click immediately after mount (guards against the triggering click), but does after the short arming delay', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={onClose} />);
    const backdrop = container.firstElementChild as HTMLElement;

    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click on the dialog content itself never closes it (stopPropagation), even after the arming delay', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('variant content', () => {
    it('duo-success shows both participants, their scores, and the current streak', () => {
      const celebration: WamCelebration = {
        type: 'duo-success',
        participants: [makeParticipant({ userId: 1, score: 90 }), makeParticipant({ userId: 2, score: 95, displayName: 'רותי' })],
        currentStreak: 4,
      };
      render(<WamCelebrationOverlay celebration={celebration} onClose={vi.fn()} />);
      expect(screen.getByText('90%')).toBeInTheDocument();
      expect(screen.getByText('95%')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('דני')).toBeVisible();
      expect(screen.getByText('רותי')).toBeVisible();
      expect(screen.getByText(/85% ומעלה/)).toBeInTheDocument();
    });

    it('spotlight names the winner (never insulting the other participant)', () => {
      const celebration: WamCelebration = {
        type: 'spotlight',
        winner: makeParticipant({ userId: 1, displayName: 'דני', score: 95 }),
        other: makeParticipant({ userId: 2, displayName: 'רותי', score: 60 }),
      };
      render(<WamCelebrationOverlay celebration={celebration} onClose={vi.fn()} />);
      expect(screen.getByText(/דני/)).toBeInTheDocument();
      expect(screen.getAllByText(/95%/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/60%/).length).toBeGreaterThan(0);
    });

    it('tie shows both participants with equal scores and a balanced message', () => {
      const celebration: WamCelebration = {
        type: 'tie',
        participants: [makeParticipant({ userId: 1, score: 60 }), makeParticipant({ userId: 2, score: 60, displayName: 'רותי' })],
      };
      render(<WamCelebrationOverlay celebration={celebration} onClose={vi.fn()} />);
      expect(screen.getAllByText('60%')).toHaveLength(2);
      expect(screen.getByText('דני')).toBeVisible();
      expect(screen.getByText('רותי')).toBeVisible();
      expect(screen.getByText(/אותו ציון בדיוק השבוע/)).toBeInTheDocument();
    });

    it('encourages a lower-score winner without falsely claiming the target was met', () => {
      render(<WamCelebrationOverlay celebration={{
        type: 'spotlight',
        winner: makeParticipant({ score: 30 }),
        other: makeParticipant({ userId: 20, score: 20 }),
      }} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog', { name: 'ממשיכים קדימה יחד' })).toBeVisible();
      expect(screen.queryByText(/עמידה ביעד/)).not.toBeInTheDocument();
    });

    it('completion fallback shows a generic message with no scores/streak', () => {
      render(<WamCelebrationOverlay celebration={{ type: 'completion' }} onClose={vi.fn()} />);
      expect(screen.getByText(/הפגישה השבועית הושלמה בהצלחה/)).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });
  });
});
