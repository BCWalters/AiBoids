import { describe, it, expect, afterEach } from 'vitest';
import { t, translations } from './translations';
import { setLanguage, getLanguage } from './language';

describe('translations', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('every supported language defines the exact same set of keys', () => {
    const enKeys = Object.keys(translations.en).sort();
    for (const lang of ['es', 'fr'] as const) {
      expect(Object.keys(translations[lang]).sort()).toEqual(enKeys);
    }
  });

  it('no translation string is empty in any language', () => {
    for (const lang of ['en', 'es', 'fr'] as const) {
      for (const [key, value] of Object.entries(translations[lang])) {
        expect(value.length, `${lang}.${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('t() looks up the current language and substitutes {vars} placeholders', () => {
    setLanguage('en');
    expect(t('modeLabel')).toBe(translations.en.modeLabel);
  });

  it('t() switches dictionaries when the language changes', () => {
    setLanguage('es');
    expect(getLanguage()).toBe('es');
    expect(t('modeLabel')).toBe(translations.es.modeLabel);
    expect(t('modeLabel')).not.toBe(translations.en.modeLabel);
  });

  it('t() substitutes named {vars} placeholders in the resolved template', () => {
    setLanguage('en');
    expect(t('respawnButtonPending', { count: 3 })).toBe('Respawn now (3) 🐣');
  });

  it('t() leaves an unmatched placeholder as-is rather than throwing', () => {
    setLanguage('en');
    expect(t('respawnButtonPending', { other: 3 })).toContain('{count}');
  });
});
