import type { AreaDict, Dict, Locale } from '../core.js';
import { LOCALES } from '../core.js';
import { errors } from './errors.js';
import { emails } from './emails.js';
import { wams } from './wams.js';
import { archiveSearch } from './archiveSearch.js';
import { api } from './api.js';

const AREAS: AreaDict[] = [errors, emails, wams, archiveSearch, api];

function merge(locale: Locale): Dict {
  const merged: Dict = {};
  for (const area of AREAS) {
    for (const [key, value] of Object.entries(area[locale])) {
      if (key in merged) {
        throw new Error(`Duplicate translation key "${key}" in the ${locale} dictionary`);
      }
      merged[key] = value;
    }
  }
  return merged;
}

export const dictionaries: Record<Locale, Dict> = Object.fromEntries(
  LOCALES.map((locale) => [locale, merge(locale)])
) as Record<Locale, Dict>;

export { errors, emails, wams, archiveSearch, api };
