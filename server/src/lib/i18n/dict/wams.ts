import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "wams" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `wams.`.
 * - Use {name} placeholders for interpolation.
 */
export const wams: AreaDict = {
  en: {},
  he: {},
};
