import type { TimeOfDayPreset, VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import * as THREE from 'three';
import type { Predator } from '../../sim/Predator';
import { PredatorSpecies } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import type { WingUndulationInstanceState } from '../styles/nature/wingUndulationShader';
import type { TailUndulationInstanceState } from '../styles/nature/tailUndulationShader';

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

/** All color-related parameters for one `updateInstances` call.
 * Bundled as a named-field object so call sites are self-documenting and
 * immune to positional-parameter order bugs.
 */
export interface ColorStrategy {
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
  /** Fraction of the wingbeat spent on the downstroke; <0.5 snaps down and eases up. */
  flapDownstrokeFraction?: number;
  /** Fore/aft leg swing half-angle in radians; 0 leaves legs welded to the body. */
  legSwingAmplitude?: number;
  /** Radians the legs are drawn back at full speed, on top of the swing. */
  legTuckRad?: number;
  /**
   * Raises the bottom of the wingbeat stroke by this many radians without
   * moving the top. At pose time the renderer derives a matching rest bias so
   * the top stays exactly at −amplitude for every speed. Pass 0 or omit to
   * preserve the symmetric [−A, +A] stroke (all creatures except the dragon).
   */
  flapBottomClipRad?: number;

  tailSwayAmplitude?: number;
  tailSwayFrequency?: number;
  /** Downstroke-only tail fan flare scale (0 disables). Applied as local X-scale about tail pivot. */
  tailFlareStrength?: number;
  worldScale?: number;
  meshScaleBoost?: number;
  preferUpright?: boolean;
  /**
   * When true, the render loop clamps the creature's world Y so its lowest
   * geometry vertex never sinks below the scene floor (render y=0). Needed for
   * tall, upright creatures whose model origin sits well above their base — the
   * fishtank seahorse in particular, whose body/tail extend far below the
   * origin the simulation positions it by, so at low swim heights it otherwise
   * clips through the tank floor. The clamp only engages near the floor, so the
   * creature's normal mid-water motion is unchanged. Because the flap pivots
   * about the vertical (Y) axis, this pure vertical lift leaves the fin
   * animation arcs untouched.
   */
  restOnFloor?: boolean;
  /**
   * When true, the render loop clamps the creature's world X/Z so its
   * orientation-rotated geometry stays within the tank's side glass walls.
   * Needed for long fishtank creatures — the shark in particular — whose
   * nose/tail extend well fore/aft of the model origin the simulation positions
   * them by, so swimming close to a side wall otherwise pokes the extremities
   * through the glass (see #167). The swim region's world image equals the glass
   * interior, so each inner wall sits at center ± center*worldScale. The clamp
   * only engages right at a wall, leaving normal mid-tank motion untouched. Only
   * meaningful when a scene applies a worldScale (fishtank).
   */
  containWithinTankWalls?: boolean;
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

export interface FishUndulationConfig {
  amplitudeFraction: number;
  wavesPerBody: number;
  baseOmega: number;
  speedOmegaScale: number;
}

export interface SceneBoidInstanceConfig {
  geometries: CreatureGeometries;
  bodyVertexColors: boolean;
  /** Optional per-species emissive color override (used by arcade for neon glow). */
  bodyEmissiveOverride?: THREE.Color;
  fishUndulation?: FishUndulationConfig;
}

export interface ScenePredatorInstanceConfig {
  geometries: CreatureGeometries;
  rainbowWings: boolean;
  bodyVertexColors: boolean;
  fishUndulation?: FishUndulationConfig;
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
  /**
   * Per-creature mesh-scale boost applied on top of `getWorldScale()` and the
   * entity's own scale when rendering (see MotionConfig.meshScaleBoost). Needed
   * by the POV camera to place itself at the creature's rendered nose instead of
   * inside its body (issue #159). `isPredator` disambiguates species strings that
   * collide between boids and predators (e.g. both have a `'normal'`).
   */
  getCreatureMeshScaleBoost: (species: PredatorSpecies | BoidSpecies, isPredator: boolean) => number;
  /** World-space scale for the blood-splatter burst spawned when a predator
   * catches prey in this scene. Owned per-scene so each can tune it (or size
   * it relative to that scene's base creature). */
  getBloodSplatterScale: () => number;
  mapPositionToRenderSpace: (x: number, y: number, z: number, target: Vector3) => void;
  getCreatureMaterialDefaults: () => SceneCreatureMaterialDefaults;
  getPredatorColorStrategy: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => ColorStrategy;
  getPredatorMotionConfig: (species: PredatorSpecies, renderFlags: PredatorRenderFlags) => MotionConfig;
  getBoidColorStrategy: (species: BoidSpecies, flags: StyleFlags) => ColorStrategy;
  getBoidMotionConfig: (species: BoidSpecies, flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags) => MotionConfig;
  getParrotColorStrategy: (flags: StyleFlags, bakedWingPalette: boolean) => ColorStrategy;
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
  /**
   * Optional hook to patch the body MeshStandardMaterial after it is
   * constructed in Renderer3D.buildRenderBatch. Called once per batch,
   * before the material is used for any InstancedMesh. Intended for
   * scene-specific onBeforeCompile injections (e.g. fishtank fish-scale
   * pattern). Scenes that don't need it can omit the method entirely.
   */
  patchBodyMaterial?: (material: THREE.MeshStandardMaterial, geometries: CreatureGeometries) => void;
  /**
   * Optional hook to patch the tail MeshStandardMaterial, called the same way
   * as patchBodyMaterial but only when the creature actually has a tail.
   *
   * The tail needs its own hook because it does NOT share the body's material:
   * Renderer3D clones the WING material for it (so monster tails read leathery
   * like the wings), so a body-only patch never reaches the tail. Any surface
   * treatment meant to run over the whole creature — the dragon's scales, say —
   * has to be applied here as well or it stops abruptly at the tail joint.
   */
  patchTailMaterial?: (material: THREE.MeshStandardMaterial, geometries: CreatureGeometries) => void;
  /**
   * Optional hook to patch the wing MeshStandardMaterial.
   *
   * IMPORTANT: this is invoked once per wing material INSTANCE, not once per
   * creature. The two wings do not share a material — the right wing gets a
   * clone — and THREE.Material.clone() copies neither onBeforeCompile nor
   * customProgramCacheKey, so a patch applied before cloning silently reaches
   * only the left wing.
   */
  patchWingMaterial?: (material: THREE.MeshStandardMaterial, geometries: CreatureGeometries) => void;

  /**
   * Optional hook to patch a leg part's MeshStandardMaterial.
   *
   * IMPORTANT: like patchWingMaterial, this is invoked once per leg part
   * material INSTANCE, not once per creature. Renderer3D clones the BODY
   * material for each leg part so the legs pick up matching per-instance
   * tinting — and THREE.Material.clone() copies neither onBeforeCompile nor
   * customProgramCacheKey. That means any patch installed by
   * patchBodyMaterial is dropped on the way to the legs, and a surface
   * treatment meant to run over the whole creature stops abruptly at the hip
   * unless it is re-applied here.
   *
   * The leg part's own geometry is passed as well as the creature's, because
   * each part is a separate mesh posed about its own joint and a pattern keyed
   * on the body's axis will not line up with it.
   */
  patchLegMaterial?: (
    material: THREE.MeshStandardMaterial,
    geometries: CreatureGeometries,
    legGeometry: THREE.BufferGeometry,
  ) => void;

  /**
  * Called after both wing InstancedMeshes have been created (and after
  * patchWingMaterial has already been applied to each wing material).
  * Should clone the wing geometries, attach a shared per-instance phase
  * attribute, and return the state object for the renderer to update per frame.
  *
  * THREE.Material.clone() drops onBeforeCompile — clone first (already done by
  * buildRenderBatch), THEN call this hook so the patch is applied exactly once
  * to each material instance that already exists.
  */
  setupWingUndulation?: (
   wingLeft: THREE.InstancedMesh,
   wingRight: THREE.InstancedMesh,
   geometries: CreatureGeometries,
  ) => WingUndulationInstanceState | undefined;

  /**
  * Called after the tail InstancedMesh has been created and patchTailMaterial
  * applied. Should clone the tail geometry, attach per-instance phase and
  * speed-fraction attributes, and return the state object for per-frame updates.
  * Return undefined (or omit) for non-unicorn batches.
  */
  setupTailUndulation?: (
   tail: THREE.InstancedMesh,
   geometries: CreatureGeometries,
  ) => TailUndulationInstanceState | undefined;

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
