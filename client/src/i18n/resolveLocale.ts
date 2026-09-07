import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from './locales';

const STORAGE_KEY = '12wy.locale';

export function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Private browsing and blocked storage should not break the app.
    return null;
  }
}

export function storeLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

/**
 * An explicit choice wins. Otherwise we honour the browser's languages, which means a
 * Hebrew-speaking visitor gets Hebrew on their first ever visit without touching settings.
 *
 * Deliberately free of React so the API client and other plain modules can resolve the
 * language without pulling the provider in.
 */
export function resolveInitialLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;

  const navigatorLanguages =
    typeof navigator === 'undefined'
      ? null
      : [navigator.language, ...(navigator.languages ?? [])].filter(Boolean).join(',');

  return negotiateLocale(navigatorLanguages) ?? DEFAULT_LOCALE;
}
