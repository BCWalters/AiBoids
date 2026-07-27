/**
 * Shared types for control-panel section builder modules.
 *
 * Each section lives in its own file (e.g. visualSection.ts) and receives a
 * SectionContext containing every helper and callback it might need so it can
 * be authored/edited without touching the central ControlPanel class.
 */

import type { SimParams, SimMode } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { TranslationKey } from '../../i18n/translations';
import type { CreatureLabels } from '../../render/sceneRenderers/createSceneRendererHooks';

// Keys of SimParams whose value is a boolean — used by buildBooleanToggle so
// a single helper can bind any on/off feature flag without per-flag builders.
export type BooleanParamKey = {
  [K in keyof SimParams]: SimParams[K] extends boolean ? K : never;
}[keyof SimParams];

export interface SliderSpec {
  key: keyof SimParams;
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
}

/**
 * Context object passed into every section builder function.
 * Provides shared helpers (buildSection, buildSlider, …) and the
 * callbacks/state that sections need to wire up controls correctly.
 */
export interface SectionContext {
  /** Builds a collapsible <details>/<summary> section, persisting open state. */
  buildSection(sectionKey: string, title: string, children: HTMLElement[], defaultOpen: boolean): HTMLElement;
  /** Builds a titled, outlined sub-group inside a section. */
  buildSubsection(title: string, children: HTMLElement[]): HTMLElement;
  /** Builds a labelled range slider wired to a SimParams key. */
  buildSlider(spec: SliderSpec, disabled?: boolean, labelOverride?: string): HTMLElement;
  /** Builds a generic boolean checkbox wired to a boolean SimParams key. */
  buildBooleanToggle(labelKey: TranslationKey, id: string, key: BooleanParamKey): HTMLElement;
  /** Flashes a temporary label on a button then restores the default. */
  flashButtonLabel(button: HTMLButtonElement, defaultLabel: string, flashLabel: string): void;

  sim: Simulation;
  onModeChange: (mode: SimMode) => void;
  getDeepLinkURL: () => string;
  onDownloadDiagnostics: () => 'downloaded' | 'no_data' | 'error';
  onClearDiagnostics: () => number;
  getCreatureLabels: () => CreatureLabels | null;
  /** Triggers a full panel re-render (e.g. after mode/style change). */
  render: () => void;
  /** Called by the population section builder to register the alien-invasion button ref. */
  setAlienButton: (btn: HTMLButtonElement | null) => void;
  /** Called by the population section builder to register the respawn button ref. */
  setRespawnButton: (btn: HTMLButtonElement | null) => void;
}
