import type { TimeOfDayPreset, VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import * as THREE from 'three';
import type { computeFishtankRoomBounds } from '../styles/fishtank/environment';
import type { Predator } from '../../sim/Predator';
import { PredatorSpecies } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import type { CreatureGeometries } from '../geometry/sharedGeometry';

export { PredatorSpecies };

export type FishtankBounds = ReturnType<typeof computeFishtankRoomBounds>;

export interface SpeciesColorSet {
  body: THREE.Color;
  wing: THREE.Color;
  tail: THREE.Color;
}

/** All colour-related parameters for one `updateInstances` call.
 * Bundled as a named-field object so call sites are self-documenting and
 * immune to positional-parameter order bugs.
 */
export interface ColourStrategy {
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Predator | Boid) => number;
  /** Each creature gets a small HSL jitter + occasional rare morph around
   * baseColor (sparrow-style individual variation). Default false. */
  individualVariation?: boolean;
  /** Per-creature body/wing/tail hue function (parrot/hawk plumage).
   * Overrides individualVariation when provided. */
  getSpeciesColors?: (creature: Predator | Boid) => SpeciesColorSet | null;
  /** True for parrot profile variants whose geometry has baked vertex colours
   * on wings/tail/legs — passes white so the vertex palette shows through. */
  bakedWingPalette?: boolean;
  /** True for nature small songbirds with a SmallBirdPalette baked into body/
   * wing/tail geometry — passes white so the gradient shows through. */
  bakedBodyGradient?: boolean;
  /** Enables nature-parrot-specific palette lock/passthrough behavior. */
  useNatureParrotPalette?: boolean;
  /** Disables per-creature species jitter and preserves exact species colors. */
  lockSpeciesPalette?: boolean;
  beakColor?: THREE.Color;
}

/** Per-species animation/motion parameters for one `updateInstances` call.
 * All fields are optional; defaults match the original parameter defaults so
 * call sites can omit anything they don't need to override.
 */
export interface MotionConfig {
  flapFrequency?: number;
  flapIdleAmplitude?: number;
  flapSpeedAmplitude?: number;
  getScale?: (creature: Predator | Boid) => number;
  keepUpright?: boolean;
  uprightStyle?: 'dragon' | 'unicorn' | 'shark';
  bankScale?: number;
  finRestBiasRad?: number;
  tailSwayAxis?: THREE.Vector3;
  tailSwayAmplitude?: number;
  tailSwayFrequency?: number;
  tailSwayPivotY?: number;
  worldScale?: number;
  meshScaleBoost?: number;
  preferUpright?: boolean;
}

export const HAWK_PREDATOR_SPECIES: PredatorSpecies = PredatorSpecies.Normal;
export const MONSTER_PREDATOR_SPECIES: PredatorSpecies = PredatorSpecies.Monster;
export const UNICORN_PREDATOR_SPECIES: PredatorSpecies = PredatorSpecies.Horse;
export const SCENE_STYLES: readonly VisualStyle[] = ['nature', 'fishtank', 'arcade'];
export const SCENE_PREDATOR_SPECIES: readonly PredatorSpecies[] = [
  HAWK_PREDATOR_SPECIES,
  MONSTER_PREDATOR_SPECIES,
  UNICORN_PREDATOR_SPECIES,
];

export function isPredatorSpecies(species: string): species is PredatorSpecies {
  return SCENE_PREDATOR_SPECIES.includes(species as PredatorSpecies);
}

/**
 * Render flags for a predator instance set. `isMonster` is true when the
 * species is PredatorSpecies.Monster — used by buildInstanceSet to select
 * the slightly glossier/darker material finish that reads well on dragon/shark
 * geometry. `isShark` additionally true in the fishtank scene (Monster in
 * fishtank → shark wing-material tint instead of dragon-wing purple).
 */
export interface PredatorRenderFlags {
  isMonster: boolean;
  isShark: boolean;
}

export const DEFAULT_PREDATOR_RENDER_FLAGS: PredatorRenderFlags = {
  isMonster: false,
  isShark: false,
};

export interface StyleFlags {
  isNature: boolean;
  isFishtank: boolean;
  isOrganic: boolean;
}

export function createStyleFlags(style: VisualStyle): StyleFlags {
  const isNature = style === 'nature';
  const isFishtank = style === 'fishtank';
  return {
    isNature,
    isFishtank,
    isOrganic: isNature || isFishtank,
  };
}

export function createPredatorRenderFlags(
  species: PredatorSpecies,
  flags: StyleFlags,
): PredatorRenderFlags {
  const isMonster = species === PredatorSpecies.Monster;
  const isShark = isMonster && flags.isFishtank;
  return { isMonster, isShark };
}

export function createPredatorInstanceKey(
  species: PredatorSpecies,
  count: number,
  style: VisualStyle,
): string {
  return `${count}:${style}:${species}`;
}

export interface BoidMotionStyleFlags {
  isProfiledParrot: boolean;
}

/** Minimal boid species configuration type used by boid rendering hooks.
 * Contains only the fields needed by colour and motion configuration.
 * Full BoidSpeciesConfig is defined in Renderer3D.
 */
export interface BoidSpeciesConfig {
  species: BoidSpecies;
  natureBase: THREE.Color;
  arcadeBase: THREE.Color;
  arcadeEmissive: THREE.Color;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
  getColors?: (creature: Boid | Predator, flags: StyleFlags) => SpeciesColorSet;
  colors?: SpeciesColorSet;
  beakColor?: THREE.Color;
  tailSwayPivotY?: number;
}

export interface SceneEnvironmentToggles {
  fogEnabled: boolean;
  timeOfDay: TimeOfDayPreset;
  lightShaftsEnabled: boolean;
  waterEffectsEnabled: boolean;
}

export interface ScenePresentationSettings {
  bloomEnabled: boolean;
  afterimageEnabled: boolean;
  boundsHelperVisible: boolean;
  ambientLightIntensity: number;
  keyLightVisible: boolean;
}

export interface SceneCreatureMaterialDefaults {
  bodyEmissive: number;
  bodyEmissiveIntensity: number;
  bodyRoughness: (isMonster: boolean) => number;
  wingEmissive: number;
  wingEmissiveIntensity: number;
  wingRoughness: (isMonster: boolean) => number;
  wingColor: (isMonster: boolean, isFishtank: boolean) => number;
}

export interface SceneBoidInstanceConfig {
  geometries: CreatureGeometries;
  bodyVertexColors: boolean;
  /** Optional per-species emissive color override (used by arcade for neon glow). */
  bodyEmissiveOverride?: THREE.Color;
}

export interface ScenePredatorInstanceConfig {
  geometries: CreatureGeometries;
  rainbowWings: boolean;
  bodyVertexColors: boolean;
}

/** Scene-specific display names for all canonical sim creature types.
 * Boid species use their canonical sim keys; predator species use their
 * canonical sim keys (normal, monster, horse). */
export interface CreatureLabels {
  boid: Record<BoidSpecies, string>;
  predator: Record<PredatorSpecies, string>;
}

export interface SceneRendererHooks {
  setStyleVisibility: () => void;
  configureInitialFraming: (
    sim: Simulation,
    maxDim: number,
    fishtankBounds: FishtankBounds,
  ) => void;
  applyStyleTransition: (
    sim: Simulation,
    maxDim: number,
    fishtankBounds: FishtankBounds,
    wasFishtank: boolean,
  ) => void;
  updateEnvironment: (elapsed: number) => void;
  updateTransientEffects: (sim: Simulation, elapsed: number) => void;
  configureEnvironmentAnchors: (sim: Simulation, center: Vector3, maxDim: number) => void;
  updateFrameAnchors: (sim: Simulation) => void;
  updateCameraClamp: (sim: Simulation) => void;
  applyEnvironmentToggles: (toggles: SceneEnvironmentToggles) => void;
  setShadowsEnabled: (enabled: boolean) => void;
  setGalleryCreatureActive: (active: boolean) => void;
  getPresentationSettings: () => ScenePresentationSettings;
  getWorldScale: () => number;
  mapPositionToRenderSpace: (x: number, y: number, z: number, target: Vector3) => void;
  getCreatureMaterialDefaults: () => SceneCreatureMaterialDefaults;
  getPredatorColourStrategy: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => ColourStrategy;
  getPredatorMotionConfig: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => MotionConfig;
  getBoidColourStrategy: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags) => ColourStrategy;
  getBoidMotionConfig: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags) => MotionConfig;
  getParrotColourStrategy: (config: BoidSpeciesConfig, flags: StyleFlags, bakedWingPalette: boolean) => ColourStrategy;
  getParrotGeometryProfile: (creature: Boid | Predator, flags: StyleFlags) => string;
  getParrotProfileNames: (flags: StyleFlags) => string[];
  getParrotProfileInstanceConfig: (profile: string, flags: StyleFlags) => SceneBoidInstanceConfig;
  getBoidInstanceConfig: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags) => SceneBoidInstanceConfig;
  getPredatorInstanceConfig: (species: PredatorSpecies, flags: StyleFlags, renderFlags: PredatorRenderFlags) => ScenePredatorInstanceConfig;
  /** Scene-specific display labels for each canonical sim creature type.
   * Used by the UI to show creature names appropriate to the current scene
   * (e.g. 'normal' boid → "Sparrow" in nature, "Fish" in fishtank, "Boid" in arcade).
   */
  getCreatureLabels: () => CreatureLabels;
  dispose: () => void;
}

interface SceneRendererHookCallbacks {
  nature: SceneRendererHooks;
  fishtank: SceneRendererHooks;
  arcade: SceneRendererHooks;
}

export function createSceneRendererHooks(
  callbacks: SceneRendererHookCallbacks,
): Record<VisualStyle, SceneRendererHooks> {
  return {
    nature: callbacks.nature,
    fishtank: callbacks.fishtank,
    arcade: callbacks.arcade,
  };
}
