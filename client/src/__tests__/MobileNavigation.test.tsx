import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileNavigation, type MobileNavigationItem } from '../components/MobileNavigation';

afterEach(() => cleanup());

const items: MobileNavigationItem[] = [
  { id: 'home', label: 'דף הבית' },
  { id: 'week', label: 'מעקב שבועי' },
  { id: 'wams', label: 'פגישות WAM' },
  { id: 'profile', label: 'הפרופיל שלי' },
  { id: 'goals', label: 'מטרות וטקטיקות', disabled: true },
  { id: 'history', label: 'ההיסטוריה וההתקדמות לאורך כל השבועות והמחזורים הקודמים' },
];

describe('MobileNavigation', () => {
  it('keeps Home/Week/Goals/Meeting primary and all remaining sections in More', () => {
    const navigate = vi.fn();
    render(<MobileNavigation activeId="home" onNavigate={navigate} items={items} />);
    expect(screen.getByRole('button', { name: 'בית' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation').querySelectorAll('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'השבוע' }));
    expect(navigate).toHaveBeenCalledWith('week');
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    const dialog = screen.getByRole('dialog', { name: 'לאן ממשיכים?' });
    expect(within(dialog).getByRole('button', { name: items[5].label })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'הפרופיל שלי' }));
    expect(navigate).toHaveBeenLastCalledWith('profile');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עוד' })).toHaveFocus();
  });

  it('supports no-active-cycle and disabled items without disabling discovery of WAM', () => {
    const navigate = vi.fn();
    render(<MobileNavigation activeId="home" onNavigate={navigate} items={items.filter((item) => item.id !== 'week')} />);
    expect(screen.getByRole('button', { name: 'השבוע' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'פגישה משותפת' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'השבוע' }));
    const goals = screen.getByRole('button', { name: 'מטרות' });
    expect(goals).toBeDisabled();
    fireEvent.click(goals);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses the same compact desktop navigation with grouped secondary destinations', () => {
    render(<MobileNavigation layout="desktop" activeId="profile" onNavigate={vi.fn()}
      items={items.map((item) => ({ ...item, group: item.id === 'profile' ? 'חשבון' : 'התקדמות' }))} />);
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' }).querySelectorAll('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'עוד' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getByRole('region', { name: 'חשבון' })).toHaveTextContent('הפרופיל שלי');
    expect(screen.getByRole('region', { name: 'התקדמות' })).toHaveTextContent(items[5].label);
  });

  it('moves focus into the sheet, traps both Tab directions, and restores focus on Escape', () => {
    render(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} />);
    const more = screen.getByRole('button', { name: 'עוד' });
    more.focus();
    fireEvent.click(more);
    const close = screen.getByRole('button', { name: 'סגירת תפריט ניווט' });
    const last = screen.getByRole('button', { name: items[5].label });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on external navigation, restores scroll, and marks More when a secondary route is active', () => {
    const view = render(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<MobileNavigation activeId="profile" onNavigate={vi.fn()} items={items} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עוד' })).toHaveAttribute('aria-current', 'page');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes and restores focus on backdrop clicks', () => {
    render(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עוד' })).toHaveFocus();
  });

  it('disables all navigation when loading and cleans up scroll locks on unmount', () => {
    const view = render(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} disabled />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    view.rerender(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes an open sheet when resizing to desktop', () => {
    render(<MobileNavigation activeId="home" onNavigate={vi.fn()} items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

/**
 * The overflow sheet scrolls when its contents do not fit, and a row left half-clipped by that
 * scroll container has its centre point *outside* the sheet — so a real mouse click on it lands
 * on the backdrop and merely closes the menu. That made the last destination behave like a dead
 * link in production while every fireEvent-based test passed, because synthetic events skip hit
 * testing entirely. jsdom has no layout engine, so this locks the structural guarantee instead:
 * a dismissal must come from the backdrop itself and never from anything inside the sheet.
 */
describe('MobileNavigation: the backdrop must not swallow menu activations', () => {
  it('navigates on a click that bubbles from a row, and never treats it as a dismissal', () => {
    const onNavigate = vi.fn();
    render(
      <MobileNavigation
        activeId="home"
        onNavigate={onNavigate}
        items={[
          { id: 'home', label: 'בית' },
          { id: 'monitoring', label: 'בריאות המערכת', group: 'חשבון ומערכת' },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /עוד/ }));
    const dialog = screen.getByRole('dialog', { name: 'לאן ממשיכים?' });
    const row = within(dialog).getByRole('button', { name: 'בריאות המערכת' });

    fireEvent.click(row);

    expect(onNavigate).toHaveBeenCalledWith('monitoring');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('closes only when the backdrop itself is the click target', () => {
    const onNavigate = vi.fn();
    render(
      <MobileNavigation
        activeId="home"
        onNavigate={onNavigate}
        items={[
          { id: 'home', label: 'בית' },
          { id: 'monitoring', label: 'בריאות המערכת', group: 'חשבון ומערכת' },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /עוד/ }));
    const dialog = screen.getByRole('dialog', { name: 'לאן ממשיכים?' });

    // A click that originates inside the sheet must leave the menu open.
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: 'לאן ממשיכים?' })).toBeInTheDocument();

    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole('dialog', { name: 'לאן ממשיכים?' })).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
