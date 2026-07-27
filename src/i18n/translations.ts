// Assembler: imports per-domain partial dictionaries and merges them into the
// three flat `en`/`es`/`fr` objects that the rest of the app consumes.
// TranslationKey is still derived from `en`, so adding a new key to any
// partial automatically widens the union and TypeScript enforces coverage in
// all other languages.
//
// To add new UI text, edit only the relevant domain file under
// src/i18n/translations/ — this file never needs to change.

import type { Language } from './language';
import { getLanguage } from './language';

import * as common from './translations/common';
import * as population from './translations/population';
import * as behavior from './translations/behavior';
import * as worldBoundaries from './translations/worldBoundaries';
import * as visual from './translations/visual';
import * as camera from './translations/camera';
import * as diagnostics from './translations/diagnostics';
import * as gallery from './translations/gallery';
import * as alien from './translations/alien';

const en = {
  ...common.en,
  ...population.en,
  ...behavior.en,
  ...worldBoundaries.en,
  ...visual.en,
  ...camera.en,
  ...diagnostics.en,
  ...gallery.en,
  ...alien.en,
};

export type TranslationKey = keyof typeof en;
type TranslationDict = Record<TranslationKey, string>;

// Exported (in addition to the `t()` lookup helper below) so tests can
// assert on dictionary shape/content directly, e.g. checking that every
// language defines the same non-empty strings for each key.
export { en };

const es: TranslationDict = {
  ...common.es,
  ...population.es,
  ...behavior.es,
  ...worldBoundaries.es,
  ...visual.es,
  ...camera.es,
  ...diagnostics.es,
  ...gallery.es,
  ...alien.es,
};

const fr: TranslationDict = {
  ...common.fr,
  ...population.fr,
  ...behavior.fr,
  ...worldBoundaries.fr,
  ...visual.fr,
  ...camera.fr,
  ...diagnostics.fr,
  ...gallery.fr,
  ...alien.fr,
};

const translations: Record<Language, TranslationDict> = { en, es, fr };
export { translations };

/**
 * Looks up `key` in the current language's dictionary (see
 * language.ts's getLanguage()), substituting any `{name}` placeholders
 * from `vars`. Falls back to English if a key is ever missing at
 * runtime (shouldn't happen given the shared TranslationKey type, but
 * cheap insurance against a stale/partial dictionary).
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = translations[getLanguage()][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
