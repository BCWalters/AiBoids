import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getLanguage, setLanguage, onLanguageChange, SUPPORTED_LANGUAGES } from './language';

describe('language', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    setLanguage('en');
    localStorage.clear();
  });

  it('SUPPORTED_LANGUAGES lists each language under its own native name', () => {
    const values = SUPPORTED_LANGUAGES.map((l) => l.value);
    expect(values).toEqual(['en', 'es', 'fr']);
    expect(SUPPORTED_LANGUAGES.every((l) => l.nativeName.length > 0)).toBe(true);
  });

  it('setLanguage updates getLanguage() and persists to localStorage', () => {
    setLanguage('fr');
    expect(getLanguage()).toBe('fr');
    expect(localStorage.getItem('aiboids-language')).toBe('fr');
  });

  it('setLanguage is a no-op (no listener firing) when set to the already-active language', () => {
    setLanguage('en');
    let calls = 0;
    const unsubscribe = onLanguageChange(() => calls++);
    setLanguage('en');
    expect(calls).toBe(0);
    unsubscribe();
  });

  it('onLanguageChange notifies subscribers with the new language and can unsubscribe', () => {
    const seen: string[] = [];
    const unsubscribe = onLanguageChange((lang) => seen.push(lang));
    setLanguage('es');
    expect(seen).toEqual(['es']);
    unsubscribe();
    setLanguage('fr');
    // No further pushes after unsubscribing.
    expect(seen).toEqual(['es']);
  });
});
