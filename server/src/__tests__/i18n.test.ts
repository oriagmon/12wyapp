import { describe, it, expect } from 'vitest';
import { dictionaries, errors, emails, wams, archiveSearch, api } from '../lib/i18n/dict/index.js';
import { LOCALES, negotiateLocale, t, type AreaDict } from '../lib/i18n/index.js';

const AREAS: Array<[string, AreaDict]> = [
  ['errors', errors],
  ['emails', emails],
  ['wams', wams],
  ['archiveSearch', archiveSearch],
  ['api', api],
];

function placeholders(value: string): string[] {
  return (value.match(/\{(\w+)\}/g) ?? []).sort();
}

describe('server dictionaries', () => {
  it('has the same keys in every language', () => {
    const en = Object.keys(dictionaries.en).sort();
    const he = Object.keys(dictionaries.he).sort();
    expect(he).toEqual(en);
  });

  it.each(AREAS)('namespaces every %s key under its area', (name, area) => {
    for (const locale of LOCALES) {
      for (const key of Object.keys(area[locale])) {
        expect(key.startsWith(`${name}.`), `"${key}" should start with "${name}."`).toBe(true);
      }
    }
  });

  it('has no empty values', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('');
      }
    }
  });

  it('uses the same placeholders in both languages', () => {
    for (const [key, english] of Object.entries(dictionaries.en)) {
      expect(placeholders(dictionaries.he[key] ?? ''), key).toEqual(placeholders(english));
    }
  });

  it('defines both halves of every plural pair', () => {
    for (const locale of LOCALES) {
      for (const key of Object.keys(dictionaries[locale])) {
        if (key.endsWith('_one')) {
          expect(dictionaries[locale][`${key.slice(0, -4)}_other`], key).toBeDefined();
        }
        if (key.endsWith('_other')) {
          expect(dictionaries[locale][`${key.slice(0, -6)}_one`], key).toBeDefined();
        }
      }
    }
  });

  it('leaves no Hebrew in the English dictionary', () => {
    for (const [key, value] of Object.entries(dictionaries.en)) {
      expect(/[\u0590-\u05FF]/.test(value), `${key}: "${value}"`).toBe(false);
    }
  });
});

describe('translate', () => {
  it('interpolates parameters', () => {
    expect(t('en', 'Hello {name}', { name: 'Ori' })).toBe('Hello Ori');
  });

  it('returns unknown keys unchanged so plain text passes through', () => {
    expect(t('en', 'Some literal message')).toBe('Some literal message');
  });
});

describe('negotiateLocale', () => {
  it('picks the highest-quality supported language', () => {
    expect(negotiateLocale('fr,he;q=0.9,en;q=0.8')).toBe('he');
    expect(negotiateLocale('en-US,en;q=0.9')).toBe('en');
  });

  it('ignores languages we do not speak', () => {
    expect(negotiateLocale('fr-FR,de;q=0.8')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
  });

  it('skips languages explicitly refused with q=0', () => {
    expect(negotiateLocale('he;q=0,en;q=0.5')).toBe('en');
  });
});
