import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_COOLDOWN_MS, emptyCelebrationSession, selectCelebration, type SuccessEvent,
} from '../lib/celebrations';

const event: SuccessEvent = {
  accountId: 1, kind: 'completion', occurrenceId: 'completion:1:10:1:0',
  owner: true, success: true, completed: true,
};
const options = { accountId: 1, now: 1_000_000, random: 0.05, visible: true };

describe('surprise selector', () => {
  it('always celebrates a confirmed milestone without consuming surprise odds, cooldown or quota', () => {
    const state = { ...emptyCelebrationSession(), count: 4, lastAt: options.now };
    const milestone = { ...event, kind: 'milestone' as const, firstStep: true };
    const result = selectCelebration(milestone, state, { ...options, random: .99 });
    expect(result.choice).toMatchObject({ fireworks: true, title: expect.stringContaining('85%') });
    expect(result.state.count).toBe(4);
    expect(result.state.lastAt).toBe(state.lastAt);
    expect(selectCelebration(milestone, result.state, options).choice).toBeNull();
  });

  it('keeps milestones available with a bounded ledger after many prior completion events', () => {
    const state = { ...emptyCelebrationSession(), seen: Array.from({ length: 512 }, (_, index) => `old-${index}`) };
    const result = selectCelebration({ ...event, kind: 'milestone' }, state, options);
    expect(result.choice?.fireworks).toBe(true);
    expect(result.state.seen).toHaveLength(512);
    expect(result.state.seen.at(-1)).toBe(event.occurrenceId);
  });

  it('still suppresses hidden milestones and never replays them later', () => {
    const milestone = { ...event, kind: 'milestone' as const };
    const result = selectCelebration(milestone, emptyCelebrationSession(), { ...options, visible: false });
    expect(result.choice).toBeNull();
    expect(selectCelebration(milestone, result.state, options).choice).toBeNull();
  });

  it('is pure and deterministic for an injected clock and random draw', () => {
    const state = emptyCelebrationSession();
    expect(selectCelebration(event, state, options)).toEqual(selectCelebration(event, state, options));
    expect(selectCelebration(event, state, options).choice?.title).toBe('עוד הבטחה קטנה שקוימה');
    expect(state).toEqual(emptyCelebrationSession());
  });

  it('uses a rare, strict 16% selection window', () => {
    expect(selectCelebration(event, emptyCelebrationSession(), { ...options, random: 0.159 }).choice).not.toBeNull();
    for (const random of [0.16, 0.9, 1, NaN, -1]) {
      expect(selectCelebration(event, emptyCelebrationSession(), { ...options, random }).choice).toBeNull();
    }
  });

  it.each([
    { owner: false }, { success: false }, { completed: false }, { accountId: 2 },
    { occurrenceId: '' }, { occurrenceId: 'x'.repeat(161) },
  ])('ignores non-owner, failed, unchecked, foreign or invalid mutations: %j', (patch) => {
    const state = emptyCelebrationSession();
    const result = selectCelebration({ ...event, ...patch }, state, options);
    expect(result.choice).toBeNull();
    expect(result.state).toBe(state);
  });

  it('never repeats an occurrence, including a change of event kind', () => {
    const { state } = selectCelebration(event, emptyCelebrationSession(), options);
    expect(selectCelebration({ ...event, kind: 'milestone' }, state, {
      ...options, now: options.now + CELEBRATION_COOLDOWN_MS,
    }).choice).toBeNull();
  });

  it('consumes losing draws so toggle farming cannot reroll the same occurrence', () => {
    const { state } = selectCelebration(event, emptyCelebrationSession(), { ...options, random: .95 });
    expect(state.seen).toContain(event.occurrenceId);
    expect(selectCelebration(event, state, options).choice).toBeNull();
  });

  it('consumes cooldown events and never replays them after the cooldown expires', () => {
    const first = selectCelebration(event, emptyCelebrationSession(), options);
    const secondEvent = { ...event, occurrenceId: 'second' };
    const suppressed = selectCelebration(secondEvent, first.state, { ...options, now: options.now + 1 });
    expect(suppressed.choice).toBeNull();
    expect(selectCelebration(secondEvent, suppressed.state, { ...options, now: options.now + CELEBRATION_COOLDOWN_MS }).choice).toBeNull();
    expect(selectCelebration({ ...event, occurrenceId: 'third' }, suppressed.state, {
      ...options, now: options.now + CELEBRATION_COOLDOWN_MS,
    }).choice).not.toBeNull();
  });

  it('discards hidden or modal-blocked events rather than queueing them', () => {
    const result = selectCelebration(event, emptyCelebrationSession(), { ...options, visible: false });
    expect(result.choice).toBeNull();
    expect(selectCelebration(event, result.state, options).choice).toBeNull();
  });

  it('caps surprises at four per account session even with lucky draws', () => {
    let state = emptyCelebrationSession();
    for (let index = 0; index < 6; index++) {
      const result = selectCelebration({ ...event, occurrenceId: `step-${index}` }, state, {
        ...options, now: options.now + index * CELEBRATION_COOLDOWN_MS,
      });
      expect(Boolean(result.choice)).toBe(index < 4);
      state = result.state;
    }
  });

  it('keeps the dedup ledger bounded and fails closed once full', () => {
    const state = { ...emptyCelebrationSession(), seen: Array.from({ length: 512 }, (_, index) => String(index)) };
    expect(selectCelebration(event, state, options)).toEqual({ state, choice: null });
  });

  it('uses only explicitly supplied first-step or meaningful context copy', () => {
    expect(selectCelebration({ ...event, firstStep: true }, emptyCelebrationSession(), options).choice?.title).toContain('התחלה');
    expect(selectCelebration({ ...event, kind: 'broost' }, emptyCelebrationSession(), options).choice?.detail).toContain('נשלח');
    expect(selectCelebration({ ...event, kind: 'wam' }, emptyCelebrationSession(), options).choice?.detail).toContain('הפגישה נשמרה');
    expect(selectCelebration({ ...event, kind: 'milestone' }, emptyCelebrationSession(), options).choice?.detail).toContain('ליעד השבועי');
  });
});
