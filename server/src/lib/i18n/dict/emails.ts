import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "emails" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `emails.`.
 * - Use {name} placeholders for interpolation.
 */
export const emails: AreaDict = {
  en: {},
  he: {},
};
