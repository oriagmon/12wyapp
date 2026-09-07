import { api } from './api';
import type { Locale } from '../i18n/locales';

/**
 * Mirrors the language choice to the server.
 *
 * The UI reads its language from local storage, which is instant and works logged out.
 * But reminder and BROOST emails are composed by a cron job with no browser attached, so
 * the server needs its own copy of the preference to know which language to write them in.
 *
 * Best-effort by design: a signed-out or offline user still gets their language switched
 * locally, they just will not have moved their email language until the next time it syncs.
 */
export function persistLocalePreference(locale: Locale): void {
  void api.patch('/profile', { locale }).catch(() => undefined);
}
