import { describe, expect, it } from 'vitest';
import { AREAS, dictionaries } from '../dict';
import { LOCALES } from '../locales';
import { createTranslator, interpolate } from '../translate';

describe('dictionary integrity', () => {
  it('defines identical key sets in every language, for every area', () => {
    for (const [areaName, area] of Object.entries(AREAS)) {
      const enKeys = Object.keys(area.en).sort();
      const heKeys = Object.keys(area.he).sort();

      const missingHe = enKeys.filter((k) => !heKeys.includes(k));
      const missingEn = heKeys.filter((k) => !enKeys.includes(k));

      expect(missingHe, `area "${areaName}" is missing Hebrew for: ${missingHe.join(', ')}`).toEqual(
        []
      );
      expect(missingEn, `area "${areaName}" is missing English for: ${missingEn.join(', ')}`).toEqual(
        []
      );
    }
  });

  it('namespaces every key under its area name', () => {
    for (const [areaName, area] of Object.entries(AREAS)) {
      for (const key of Object.keys(area.en)) {
        expect(key.startsWith(`${areaName}.`), `"${key}" should start with "${areaName}."`).toBe(
          true
        );
      }
    }
  });

  it('never leaves a translation empty', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.trim(), `"${key}" is empty in "${locale}"`).not.toBe('');
      }
    }
  });

  it('uses the same interpolation placeholders in both languages', () => {
    const placeholders = (value: string) =>
      (value.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1)).sort();

    for (const [areaName, area] of Object.entries(AREAS)) {
      for (const key of Object.keys(area.en)) {
        expect(
          placeholders(area.he[key]),
          `"${key}" in area "${areaName}" has mismatched placeholders`
        ).toEqual(placeholders(area.en[key]));
      }
    }
  });

  it('defines both plural forms whenever it defines one', () => {
    for (const locale of LOCALES) {
      for (const key of Object.keys(dictionaries[locale])) {
        if (key.endsWith('_one')) {
          expect(
            dictionaries[locale][`${key.slice(0, -4)}_other`],
            `"${key}" has no matching _other form in "${locale}"`
          ).toBeDefined();
        }
        if (key.endsWith('_other')) {
          expect(
            dictionaries[locale][`${key.slice(0, -6)}_one`],
            `"${key}" has no matching _one form in "${locale}"`
          ).toBeDefined();
        }
      }
    }
  });

  it('leaves no Hebrew text stranded in the English dictionary', () => {
    const hebrew = /[\u0590-\u05FF]/;
    const stranded = Object.entries(dictionaries.en)
      .filter(([, value]) => hebrew.test(value))
      // The language switcher intentionally labels Hebrew in Hebrew.
      .filter(([key]) => key !== 'common.language.he');

    expect(stranded.map(([key]) => key)).toEqual([]);
  });

  it('leaves no untranslated English stranded in the Hebrew dictionary', () => {
    const hebrew = /[\u0590-\u05FF]/;
    // A Hebrew value with no Hebrew letters in it is almost always a copy-paste of the
    // English one. The exceptions are values that are the same in every language.
    const languageNeutral = /^[\s\d%✓✨🏆🔥⚪+\-–—·:.,()[\]{}/]*$/u;

    const suspicious = Object.entries(dictionaries.he)
      .filter(([, value]) => !hebrew.test(value))
      .filter(([, value]) => !languageNeutral.test(value))
      // Product names we deliberately keep in Latin script in both languages.
      .filter(([, value]) => !/^(12wyapp|WAM|BROOST|Duo|English)$/.test(value.trim()))
      .filter(([key]) => key !== 'common.language.en');

    expect(suspicious.map(([key, value]) => `${key}: ${value}`)).toEqual([]);
  });
});

describe('translator', () => {
  it('interpolates named parameters', () => {
    expect(interpolate('Week {week} of {total}', { week: 3, total: 12 })).toBe('Week 3 of 12');
  });

  it('leaves unknown placeholders untouched rather than printing undefined', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  it('selects plural forms by count', () => {
    const t = createTranslator(
      { en: { 'x.day_one': '{count} day', 'x.day_other': '{count} days' }, he: {} },
      'en'
    );
    expect(t('x.day', { count: 1 })).toBe('1 day');
    expect(t('x.day', { count: 4 })).toBe('4 days');
  });

  it('falls back to English when a Hebrew string is missing', () => {
    const t = createTranslator({ en: { 'x.a': 'English' }, he: {} }, 'he');
    expect(t('x.a')).toBe('English');
  });

  it('returns the key itself when no language has the string', () => {
    const t = createTranslator({ en: {}, he: {} }, 'en');
    expect(t('x.missing')).toBe('x.missing');
  });
});
