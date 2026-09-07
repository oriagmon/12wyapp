import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

/**
 * The app ships English-first, but this suite was written against the original Hebrew
 * interface and its assertions are a genuinely valuable regression net - rewriting ~700
 * expectations into English would throw that away and prove nothing extra.
 *
 * So the suite pins Hebrew as the ambient locale. Components read it through
 * `resolveInitialLocale()`, which checks storage first. English is covered separately by
 * the dictionary parity test and by tests that mount `LocaleProvider` with an explicit
 * locale, so both languages stay exercised.
 */
window.localStorage.setItem('12wy.locale', 'he');

beforeEach(() => {
  window.localStorage.setItem('12wy.locale', 'he');
});
