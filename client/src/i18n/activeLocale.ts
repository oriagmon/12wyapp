import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * The active locale, outside React.
 *
 * `api.ts` needs the current language to set `Accept-Language`, but it is a plain module
 * with no access to context. Keeping the value here (rather than importing the provider)
 * means the API layer never has to depend on React.
 */
let activeLocale: Locale = DEFAULT_LOCALE;

export function getActiveLocale(): Locale {
  return activeLocale;
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}
