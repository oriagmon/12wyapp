import { DEFAULT_LOCALE, type Dict, type Locale } from './locales';

const PARAM_PATTERN = /\{(\w+)\}/g;

export type TParams = Record<string, string | number | undefined>;

export type Translator = (key: string, params?: TParams) => string;

/**
 * Plural keys use a `_one` / `_other` suffix. Hebrew has richer plural rules than
 * English, but every string in this app is either "1 thing" or "N things", so two
 * forms cover it without pulling in a full CLDR plural engine.
 */
function lookup(dict: Dict | undefined, key: string, params?: TParams): string | undefined {
  if (!dict) return undefined;
  const count = params?.count;
  if (typeof count === 'number') {
    const suffixed = count === 1 ? `${key}_one` : `${key}_other`;
    const plural = dict[suffixed];
    if (plural !== undefined) return plural;
  }
  return dict[key];
}

export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(PARAM_PATTERN, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return;
  console.warn(`[i18n] ${message}`);
}

/**
 * Falls back to English before falling back to the raw key, so a missing Hebrew
 * translation degrades to readable English rather than to `some.dotted.key`.
 * The dictionary parity test is what stops that from happening silently.
 */
export function createTranslator(
  dictionaries: Record<Locale, Dict>,
  locale: Locale
): Translator {
  return (key, params) => {
    const direct = lookup(dictionaries[locale], key, params);
    if (direct !== undefined) return interpolate(direct, params);

    const fallback = lookup(dictionaries[DEFAULT_LOCALE], key, params);
    if (fallback !== undefined) {
      warnOnce(`missing "${locale}" translation for "${key}"`);
      return interpolate(fallback, params);
    }

    warnOnce(`missing translation for "${key}"`);
    return key;
  };
}

/** Resets the warn-once cache. Test-only. */
export function resetTranslatorWarnings() {
  warned.clear();
}
