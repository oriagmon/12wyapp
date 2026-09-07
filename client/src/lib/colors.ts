import type { GoalColor } from './types';

export const GOAL_COLOR_HEX: Record<GoalColor, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  gold: '#d4a017',
};

/** Translation keys, not labels - pass through `t()` before showing to anyone. */
export const GOAL_COLOR_LABEL_KEYS: Record<GoalColor, string> = {
  emerald: 'common.color.emerald',
  blue: 'common.color.blue',
  purple: 'common.color.purple',
  gold: 'common.color.gold',
};
