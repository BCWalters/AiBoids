import type { TimeOfDayPreset, VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import * as THREE from 'three';
import type { Predator } from '../../sim/Predator';
import { PredatorSpecies } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import type { CreatureGeometries } from '../geometry/sharedGeometry';

export { PredatorSpecies };

export interface SpeciesColorSet {
  body: THREE.Color;
  wing: THREE.Color;
  tail: THREE.Color;
}

/** Selects a dedicated per-family creature color path in the color applicator.
 * When omitted, the generic conditional color path is used. Each value routes
 * to that family's own straight-line applicator (see src/render/color/). */
export type CreatureColorMode = 'parrot' | 'smallBird' | 'dragon' | 'speciesTint' | 'songbird' | 'flat';

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
  /** Geometry bakes a per-part palette into wings/tail/legs (e.g. parrot profile
   * variants). Passes white for those parts so the vertex palette shows through. */
  preserveBakedPartPalette?: boolean;
  /** True for nature small songbirds with a SmallBirdPalette baked into body/
   * wing/tail geometry — passes white so the gradient shows through. */
  bakedBodyGradient?: boolean;
  /** Disables per-creature species jitter and preserves exact species colors. */
  lockSpeciesPalette?: boolean;
  beakColor?: THREE.Color;
  /** Routes this strategy to a dedicated per-family color path (e.g. 'parrot')
   * instead of the generic conditional applicator. */
  colorMode: CreatureColorMode;
}

/** Per-species animation/motion parameters for one `updateInstances` call.
 * The three flap fields are required — every scene owns and provides its own
 * creature flap tuning, so there is deliberately no shared fallback for them.
 * The remaining fields are optional; their defaults match the shared render
 * path's neutral behavior so call sites can omit anything they don't override.
 */
export interface MotionConfig {
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
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

const HAWK_PREDATOR_SPECIES: PredatorSpecies = PredatorSpecies.Normal;
const MONSTER_PREDATOR_SPECIES: PredatorSpecies = PredatorSpecies.Monster;
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
 * Render flags for a predator render batch. `isMonster` is true when the
 * species is PredatorSpecies.Monster — used by buildRenderBatch to select
 * the slightly glossier/darker material finish that reads well on dragon/shark
 * geometry. `isShark` additionally true in the fishtank scene (Monster in
 * fishtank → shark wing-material tint instead of dragon-wing purple).
 */
export interface PredatorRenderFlags {
  isMonster: boolean;
  isShark: boolean;
}

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
  ) => void;
  applyStyleTransition: (
    sim: Simulation,
    maxDim: number,
    wasFishtank: boolean,
  ) => void;
  updateEnvironment: (elapsed: number) => void;
  /**
   * Per-frame hook for scene-specific special creature effects (e.g. nature
   * dragons breathing fire). `dragonDisplayQuats` carries the smoothed
   * display orientations Renderer3D computes for 'dragon'-upright creatures
   * during instance update, which effect emitters can pose against. Scenes
   * without special creature effects (arcade/fishtank) implement a no-op.
   */
  updateSpecialCreatureEffects: (
    sim: Simulation,
    elapsed: number,
    dragonDisplayQuats: Map<number, THREE.Quaternion>,
  ) => void;
  configureEnvironmentAnchors: (sim: Simulation, center: Vector3, maxDim: number) => void;
  updateFrameAnchors: (sim: Simulation) => void;
  updateCameraClamp: (sim: Simulation) => void;
  applyEnvironmentToggles: (toggles: SceneEnvironmentToggles) => void;
  setShadowsEnabled: (enabled: boolean) => void;
  setGalleryCreatureActive: (active: boolean) => void;
  getPresentationSettings: () => ScenePresentationSettings;
  getWorldScale: () => number;
  /** World-space scale for the blood-splatter burst spawned when a predator
   * catches prey in this scene. Owned per-scene so each can tune it (or size
   * it relative to that scene's base creature). */
  getBloodSplatterScale: () => number;
  mapPositionToRenderSpace: (x: number, y: number, z: number, target: Vector3) => void;
  getCreatureMaterialDefaults: () => SceneCreatureMaterialDefaults;
  getPredatorColourStrategy: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => ColourStrategy;
  getPredatorMotionConfig: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => MotionConfig;
  getBoidColourStrategy: (species: BoidSpecies, flags: StyleFlags) => ColourStrategy;
  getBoidMotionConfig: (species: BoidSpecies, flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags) => MotionConfig;
  getParrotColourStrategy: (flags: StyleFlags, bakedWingPalette: boolean) => ColourStrategy;
  getParrotGeometryProfile: (creature: Boid | Predator, flags: StyleFlags) => string;
  getParrotProfileNames: (flags: StyleFlags) => string[];
  getParrotProfileInstanceConfig: (profile: string, flags: StyleFlags) => SceneBoidInstanceConfig;
  getBoidInstanceConfig: (species: BoidSpecies, flags: StyleFlags) => SceneBoidInstanceConfig;
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
