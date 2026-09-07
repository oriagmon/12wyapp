export type Locale = 'en' | 'he';

export const LOCALES: readonly Locale[] = ['en', 'he'] as const;

/**
 * English is the default so the app is usable by anyone who finds it. Hebrew stays a
 * first-class option rather than a translation afterthought - it is what the app was
 * originally written in.
 */
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  he: 'rtl',
};

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  he: 'עברית',
};

/** BCP-47 tags for `Intl` formatters and the `lang` attribute. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en',
  he: 'he-IL',
};

export type Dict = Record<string, string>;

/**
 * Each feature area owns one of these. Splitting the dictionary by area (rather than
 * keeping one giant object) means two people editing different features never touch
 * the same file.
 */
export type AreaDict = { en: Dict; he: Dict };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from something like `he-IL,he;q=0.9,en;q=0.8`.
 * Used for both `navigator.language` and the server's `Accept-Language` header.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((c) => c.tag.length > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag, quality } of candidates) {
    if (quality <= 0) continue;
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return null;
}
