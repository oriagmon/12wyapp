import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_DIR,
  LOCALE_TAGS,
  isLocale,
  negotiateLocale,
  type Locale,
} from './locales';
import { dictionaries } from './dict';
import { setActiveLocale } from './activeLocale';
import { createTranslator, type Translator } from './translate';

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

function storeLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

/**
 * An explicit choice wins. Otherwise we honour the browser's languages, which means a
 * Hebrew-speaking visitor gets Hebrew on their first ever visit without touching settings.
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

export type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  dir: 'ltr' | 'rtl';
  /** BCP-47 tag, for `Intl` formatters. */
  tag: string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale,
  onLocaleChange,
}: {
  children: ReactNode;
  initialLocale?: Locale;
  /** Fired on an explicit user change, so the choice can be persisted server-side for emails. */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? resolveInitialLocale());

  // Set during render, not in the effect: `api.ts` reads this for `Accept-Language`, and a
  // request can fire from a child's effect, which runs before this component's own effect.
  setActiveLocale(locale);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = LOCALE_TAGS[locale];
    root.dir = LOCALE_DIR[locale];
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState((current) => {
        if (current === next) return current;
        storeLocale(next);
        onLocaleChange?.(next);
        return next;
      });
    },
    [onLocaleChange]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(dictionaries, locale),
      dir: LOCALE_DIR[locale],
      tag: LOCALE_TAGS[locale],
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Falls back to a locale-appropriate translator when used outside a provider. That keeps
 * focused component tests from each needing a wrapper, while the app itself always has one.
 * The fallback re-resolves the locale rather than hardcoding the default, so a test suite
 * can pin a language by seeding storage once in its setup file.
 */
const fallbackCache = new Map<Locale, LocaleContextValue>();

function fallbackFor(locale: Locale): LocaleContextValue {
  let cached = fallbackCache.get(locale);
  if (!cached) {
    cached = {
      locale,
      setLocale: () => undefined,
      t: createTranslator(dictionaries, locale),
      dir: LOCALE_DIR[locale],
      tag: LOCALE_TAGS[locale],
    };
    fallbackCache.set(locale, cached);
  }
  return cached;
}

export function useTranslation(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context) return context;
  return fallbackFor(resolveInitialLocale());
}
