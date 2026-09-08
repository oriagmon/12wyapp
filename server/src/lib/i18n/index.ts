import type { Request } from 'express';
import type { Locale, TParams } from './core.js';
import { fallbackLocale, isLocale, negotiateLocale, translate } from './core.js';
import { dictionaries } from './dict/index.js';

export type { Locale, TParams, Dict, AreaDict } from './core.js';
export { LOCALES, DEFAULT_LOCALE, fallbackLocale, isLocale, negotiateLocale } from './core.js';
export { dictionaries };

/** Translates a key into an explicit locale. Use this for emails. */
export function t(locale: Locale, key: string, params?: TParams): string {
  return translate(dictionaries, locale, key, params);
}

/**
 * The language to answer a request in.
 *
 * The client sends `Accept-Language` on every call, so an in-flight language switch is
 * reflected immediately without waiting for the preference to be saved. When the header is
 * missing or asks for something we don't speak, we fall back to the signed-in user's saved
 * choice, then to the deployment default.
 */
export function localeFromRequest(req: Request): Locale {
  const negotiated = negotiateLocale(req?.headers?.['accept-language'] ?? null);
  if (negotiated) return negotiated;

  const stored = (req as Request & { user?: { locale?: unknown } }).user?.locale;
  if (isLocale(stored)) return stored;

  return fallbackLocale();
}

/** Translates a key in the language of the current request. */
export function tReq(req: Request, key: string, params?: TParams): string {
  return t(localeFromRequest(req), key, params);
}
