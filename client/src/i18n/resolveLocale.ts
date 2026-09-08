import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

/**
 * Bumped when the default language changed from English to Hebrew.
 *
 * The old key was written by anyone who touched the language switcher back when English was
 * the default, including by accident — and a stored 'en' would quietly outrank the new
 * default forever. Retiring the key once clears those stale pins; any choice made from here
 * on is remembered as normal.
 */
const STORAGE_KEY = '12wy.locale.v2';

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
 * An explicit choice wins; otherwise everyone starts in Hebrew.
 *
 * The browser's own language list is deliberately NOT consulted. Reading it would hand English
 * to anyone whose phone or laptop is configured in English, which is most people here even when
 * Hebrew is what they actually read — the sign-in screen coming up in the wrong language was
 * exactly the complaint that led to this. Switching language is one visible control away, and
 * that choice is remembered.
 *
 * Deliberately free of React so the API client and other plain modules can resolve the
 * language without pulling the provider in.
 */
export function resolveInitialLocale(): Locale {
  return readStoredLocale() ?? DEFAULT_LOCALE;
}
