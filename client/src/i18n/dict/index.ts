import type { AreaDict, Dict, Locale } from '../locales';
import { LOCALES } from '../locales';
import { common } from './common';
import { auth } from './auth';
import { dashboard } from './dashboard';
import { goals } from './goals';
import { week } from './week';
import { wams } from './wams';
import { insights } from './insights';
import { social } from './social';

/**
 * Every area dictionary, keyed by area name. Adding a feature area means adding a file
 * next to this one and registering it here - nothing else needs to change.
 */
export const AREAS: Record<string, AreaDict> = {
  common,
  auth,
  dashboard,
  goals,
  week,
  wams,
  insights,
  social,
};

function mergeArea(locale: Locale): Dict {
  const merged: Dict = {};
  for (const [areaName, area] of Object.entries(AREAS)) {
    for (const [key, value] of Object.entries(area[locale])) {
      if (key in merged) {
        throw new Error(`[i18n] duplicate key "${key}" redefined by area "${areaName}"`);
      }
      merged[key] = value;
    }
  }
  return merged;
}

export const dictionaries: Record<Locale, Dict> = LOCALES.reduce(
  (acc, locale) => {
    acc[locale] = mergeArea(locale);
    return acc;
  },
  {} as Record<Locale, Dict>
);
