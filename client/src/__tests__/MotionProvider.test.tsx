import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CelebrationProvider } from '../context/MotionProvider';
import { publishSuccess, type SuccessEvent } from '../lib/celebrations';

let account = 100;
const random = () => 0.01;
const now = () => Date.now();
const event = (patch: Partial<SuccessEvent> = {}): SuccessEvent => ({
  accountId: account, kind: 'completion', occurrenceId: 'cycle:1:tactic:1:week:1:day:0',
  owner: true, success: true, completed: true, ...patch,
});

beforeEach(() => {
  account += 10;
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('CelebrationProvider', () => {
  it('shows full milestone fireworks even on a losing surprise draw and restarts for another crossing', () => {
    render(<CelebrationProvider accountId={account} random={() => .99}>{null}</CelebrationProvider>);
    expect(screen.queryByTestId('milestone-fireworks')).not.toBeInTheDocument();
    act(() => publishSuccess(event({ kind: 'milestone', occurrenceId: 'crossing-one' })));
    expect(screen.getByRole('status')).toHaveTextContent('85%');
    expect(screen.getByTestId('milestone-fireworks').children).toHaveLength(25);
    act(() => vi.advanceTimersByTime(2200));
    expect(screen.queryByTestId('milestone-fireworks')).not.toBeInTheDocument();
    act(() => publishSuccess(event({ kind: 'milestone', occurrenceId: 'crossing-two' })));
    expect(screen.getByTestId('milestone-fireworks')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4400));
    expect(screen.queryByTestId('milestone-fireworks')).not.toBeInTheDocument();
  });

  it('keeps guaranteed milestone feedback static when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<CelebrationProvider accountId={account} random={() => .99}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event({ kind: 'milestone' })));
    expect(screen.getByRole('status')).toHaveTextContent('85%');
    expect(screen.queryByTestId('milestone-fireworks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('celebration-particles')).not.toBeInTheDocument();
  });

  it('does not celebrate initial render and never steals focus on a confirmed success', () => {
    render(<CelebrationProvider accountId={account} random={random}><button>המשך</button></CelebrationProvider>);
    const button = screen.getByRole('button');
    button.focus();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toHaveTextContent('הביצוע נשמר');
    expect(button).toHaveFocus();
    act(() => vi.advanceTimersByTime(4400));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('ignores failed, partner, unchecked and foreign events', () => {
    render(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => {
      publishSuccess(event({ success: false }));
      publishSuccess(event({ owner: false }));
      publishSuccess(event({ completed: false }));
      publishSuccess(event({ accountId: account + 10 }));
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not celebrate while logged out', () => {
    render(<CelebrationProvider accountId={null} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('clears on account switch, ignores late former-account events and preserves per-account dedup', () => {
    const view = render(<CelebrationProvider accountId={account} random={random} now={now}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    view.rerender(<CelebrationProvider accountId={account + 1} random={random} now={now}>{null}</CelebrationProvider>);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => publishSuccess(event({ accountId: account + 1 })));
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    view.rerender(<CelebrationProvider accountId={account} random={random} now={now}>{null}</CelebrationProvider>);
    act(() => { vi.advanceTimersByTime(100_000); publishSuccess(event()); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not reroll a losing draw after unmount/remount', () => {
    const view = render(<CelebrationProvider accountId={account} random={() => .9}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    view.unmount();
    render(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows static accessible copy with no particles in reduced motion and reacts to preference changes', () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    let reduced = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return reduced; },
      addEventListener: (_name: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_name: string, handler: () => void) => listeners.delete(handler),
    })));
    const view = render(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toHaveTextContent('הביצוע נשמר');
    expect(screen.queryByTestId('celebration-particles')).not.toBeInTheDocument();
    act(() => { reduced = false; listeners.forEach((listener) => listener()); });
    expect(screen.getByTestId('celebration-particles').children).toHaveLength(16);
    view.unmount();
    expect(listeners.size).toBe(0);
    const noticeTimer = setTimer.mock.calls.findIndex(([, delay]) => delay === 4400);
    expect(noticeTimer).toBeGreaterThanOrEqual(0);
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[noticeTimer].value);
  });

  it('drops hidden events and dismisses immediately on visibility loss without replay', () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    render(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); publishSuccess(event()); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => publishSuccess(event({ occurrenceId: 'another' })));
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    const noticeTimer = setTimer.mock.calls.findIndex(([, delay]) => delay === 4400);
    expect(noticeTimer).toBeGreaterThanOrEqual(0);
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[noticeTimer].value);
  });

  it('never overlays an open WAM modal and never queues a blocked event', () => {
    const view = render(<CelebrationProvider accountId={account} random={random}><div role="dialog" aria-modal="true">WAM</div></CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    view.rerender(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('dismisses an existing celebration when a modal opens', async () => {
    const view = render(<CelebrationProvider accountId={account} random={random}>{null}</CelebrationProvider>);
    act(() => publishSuccess(event()));
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    await act(async () => {
      view.rerender(<CelebrationProvider accountId={account} random={random}><div aria-modal="true" role="dialog">WAM</div></CelebrationProvider>);
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
