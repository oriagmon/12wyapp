import { resolveInitialLocale } from './resolveLocale';
import type { Locale } from './locales';

/**
 * The active locale, outside React.
 *
 * `api.ts` needs the current language to set `Accept-Language`, and a few plain modules
 * produce user-facing error text. They have no access to context, so the provider mirrors
 * its choice here.
 *
 * Until the provider has rendered, fall back to the same resolution the provider itself
 * would do. Without this, anything that fires before the first render - or outside a
 * provider entirely - would silently answer in the default language rather than the one
 * the reader actually picked.
 */
let chosenLocale: Locale | null = null;

export function getActiveLocale(): Locale {
  return chosenLocale ?? resolveInitialLocale();
}

export function setActiveLocale(locale: Locale): void {
  chosenLocale = locale;
}
