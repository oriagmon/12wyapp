import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "api" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `api.`.
 * - Use {name} placeholders for interpolation.
 */
export const api: AreaDict = {
  en: {},
  he: {},
};
