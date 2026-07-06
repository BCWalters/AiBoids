// Active-language state: detection, persistence, and change notification.
// Kept deliberately separate from sim/params.ts — language is a UI/display
// preference, not a simulation parameter, so it must survive "Restore
// defaults" (which only resets SimParams) and isn't reset by Simulation.reset().

export type Language = 'en' | 'es' | 'fr';

/** Native (untranslated) display names — a language picker always shows
 * each option in its own language, not translated into the current one. */
export const SUPPORTED_LANGUAGES: { value: Language; nativeName: string }[] = [
  { value: 'en', nativeName: 'English' },
  { value: 'es', nativeName: 'Español' },
  { value: 'fr', nativeName: 'Français' },
];

const STORAGE_KEY = 'aiboids-language';

function isSupportedLanguage(value: string): value is Language {
  return value === 'en' || value === 'es' || value === 'fr';
}

/**
 * Reads the browser's ranked language preferences (navigator.languages,
 * falling back to the single navigator.language) and picks the first
 * entry whose base subtag (e.g. "es" from "es-MX") matches a supported
 * language. Defaults to English if nothing matches.
 */
function detectBrowserLanguage(): Language {
  const candidates = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates ?? []) {
    const base = candidate.slice(0, 2).toLowerCase();
    if (isSupportedLanguage(base)) return base;
  }
  return 'en';
}

function loadStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isSupportedLanguage(stored) ? stored : null;
  } catch {
    // localStorage can throw in private-browsing/storage-disabled contexts.
    return null;
  }
}

// An explicit prior user choice (persisted) always wins over the
// browser's reported language; auto-detection only applies the first
// time a visitor ever loads the app.
let currentLanguage: Language = loadStoredLanguage() ?? detectBrowserLanguage();

type LanguageListener = (language: Language) => void;
const listeners = new Set<LanguageListener>();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language): void {
  if (language === currentLanguage) return;
  currentLanguage = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore — the choice just won't persist across reloads.
  }
  listeners.forEach((listener) => listener(language));
}

/** Subscribes to language changes; returns an unsubscribe function. */
export function onLanguageChange(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
