/**
 * Server-side translation.
 *
 * The server needs its own dictionary for two reasons the client cannot cover:
 *  - API error messages, which are rendered by the client but authored here, and must come
 *    back in whatever language the user is currently reading.
 *  - Emails, which are composed by cron jobs with no browser and no request attached.
 *
 * Request-driven responses resolve the language from `Accept-Language`. Emails resolve it
 * from the recipient's stored `users.locale`.
 */

export type Locale = 'en' | 'he';

export const LOCALES: readonly Locale[] = ['en', 'he'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language to use when a request tells us nothing about who is reading.
 *
 * Defaults to English. A deployment whose users all read Hebrew can set `APP_DEFAULT_LOCALE=he`
 * and skip the negotiation entirely.
 */
export function fallbackLocale(): Locale {
  const configured = process.env.APP_DEFAULT_LOCALE;
  return isLocale(configured) ? configured : DEFAULT_LOCALE;
}

/** Picks the best supported locale out of an `Accept-Language` header. */
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

export type Dict = Record<string, string>;
export type AreaDict = { en: Dict; he: Dict };
export type TParams = Record<string, string | number | undefined>;

const PARAM_PATTERN = /\{(\w+)\}/g;

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(PARAM_PATTERN, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function lookup(dict: Dict | undefined, key: string, params?: TParams): string | undefined {
  if (!dict) return undefined;
  const count = params?.count;
  if (typeof count === 'number') {
    const plural = dict[count === 1 ? `${key}_one` : `${key}_other`];
    if (plural !== undefined) return plural;
  }
  return dict[key];
}

/**
 * Translates a key.
 *
 * Anything that is not a known key is returned unchanged. That is deliberate: it lets a value
 * that is already human text (a legacy inline message, or a Zod message that has not been
 * converted to a key yet) pass through safely instead of surfacing as `some.dotted.key`.
 */
export function translate(
  dictionaries: Record<Locale, Dict>,
  locale: Locale,
  key: string,
  params?: TParams
): string {
  const direct = lookup(dictionaries[locale], key, params);
  if (direct !== undefined) return interpolate(direct, params);

  const fallback = lookup(dictionaries[DEFAULT_LOCALE], key, params);
  if (fallback !== undefined) return interpolate(fallback, params);

  return interpolate(key, params);
}
