import { getActiveLocale } from './activeLocale';
import { dictionaries } from './dict';
import { createTranslator, type TParams } from './translate';

/**
 * Translate outside React.
 *
 * A few modules produce user-facing text without being components or hooks — the API
 * client's fallback error message, and the routing guard's explanations. They can't call
 * `useTranslation()`, so they read the language from the module-level active locale that
 * the provider keeps up to date.
 *
 * Prefer `useTranslation()` anywhere it is available: it re-renders on a language change,
 * whereas this reads whatever the locale happened to be at call time.
 */
export function translateActive(key: string, params?: TParams): string {
  return createTranslator(dictionaries, getActiveLocale())(key, params);
}
