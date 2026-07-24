import type { TimeOfDayPreset, VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import * as THREE from 'three';
import type { computeFishtankRoomBounds } from '../styles/fishtank/environment';
import type { Predator } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import type { CreatureGeometries } from '../geometry/sharedGeometry';

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
  getIntensity: (entity: Predator | Boid) => number;
  /** Each entity gets a small HSL jitter + occasional rare morph around
   * baseColor (sparrow-style individual variation). Default false. */
  individualVariation?: boolean;
  /** Per-entity body/wing/tail hue function (parrot/hawk plumage).
   * Overrides individualVariation when provided. */
  getSpeciesColors?: (entity: Predator | Boid) => SpeciesColorSet | null;
  /** True for parrot profile variants whose geometry has baked vertex colours
   * on wings/tail/legs — passes white so the vertex palette shows through. */
  bakedWingPalette?: boolean;
  /** True for nature small songbirds with a SmallBirdPalette baked into body/
   * wing/tail geometry — passes white so the gradient shows through. */
  bakedBodyGradient?: boolean;
  /** Enables nature-parrot-specific palette lock/passthrough behavior. */
  useNatureParrotPalette?: boolean;
  /** Disables per-entity species jitter and preserves exact species colors. */
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
  getScale?: (entity: Predator | Boid) => number;
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

export type PredatorKind = 'hawk' | 'unicorn';
export const HAWK_PREDATOR_KIND: PredatorKind = 'hawk';
export const UNICORN_PREDATOR_KIND: PredatorKind = 'unicorn';
export const SCENE_STYLES: readonly VisualStyle[] = ['nature', 'fishtank', 'arcade'];
export const SCENE_PREDATOR_KINDS: readonly PredatorKind[] = [HAWK_PREDATOR_KIND, UNICORN_PREDATOR_KIND];

export interface PredatorRenderFlags {
  isDragon: boolean;
  isShark: boolean;
}

export interface StyleFlags {
  isNature: boolean;
  isFishtank: boolean;
  isOrganic: boolean;
}

export interface BoidMotionStyleFlags {
  isFishTail: boolean;
  isNatureParrot: boolean;
}

/** Minimal boid species configuration type used by boid rendering hooks.
 * Contains only the fields needed by colour and motion configuration.
 * Full BoidSpeciesConfig is defined in Renderer3D.
 */
export interface BoidSpeciesConfig {
  species: BoidSpecies;
  natureBase: THREE.Color;
  arcadeBase: THREE.Color;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
  getColors?: (entity: Boid | Predator, flags: StyleFlags) => SpeciesColorSet;
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
  bodyRoughness: (isDragon: boolean) => number;
  wingEmissive: number;
  wingEmissiveIntensity: number;
  wingRoughness: (isDragon: boolean) => number;
  wingColor: (isDragon: boolean, isFishtank: boolean) => number;
}

export interface SceneBoidInstanceConfig {
  geometries: CreatureGeometries;
  bodyVertexColors: boolean;
}

export interface ScenePredatorInstanceConfig {
  geometries: CreatureGeometries;
  rainbowWings: boolean;
  bodyVertexColors: boolean;
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
  getPredatorColourStrategy: (kind: PredatorKind, renderFlags: PredatorRenderFlags) => ColourStrategy;
  getPredatorMotionConfig: (kind: PredatorKind, renderFlags: PredatorRenderFlags) => MotionConfig;
  getBoidColourStrategy: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags) => ColourStrategy;
  getBoidMotionConfig: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags) => MotionConfig;
  getParrotColourStrategy: (config: BoidSpeciesConfig, flags: StyleFlags, bakedWingPalette: boolean) => ColourStrategy;
  getParrotGeometryProfile: (entity: Boid | Predator, flags: StyleFlags) => string;
  getParrotProfileNames: (flags: StyleFlags) => string[];
  getParrotProfileInstanceConfig: (profile: string, flags: StyleFlags) => SceneBoidInstanceConfig;
  getBoidInstanceConfig: (species: BoidSpecies, config: BoidSpeciesConfig, flags: StyleFlags) => SceneBoidInstanceConfig;
  getPredatorInstanceConfig: (kind: PredatorKind, flags: StyleFlags, renderFlags: PredatorRenderFlags) => ScenePredatorInstanceConfig;
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
