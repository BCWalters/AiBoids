import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import { type Boid, BoidSpecies } from '../../sim/Boid';
import { computeFishtankRoomBounds, placeFishtankEnvironment, TANK_VISUAL_SCALE } from '../styles/fishtank/environment';
import { getSharkTailPivotY, createSharkGeometries } from '../styles/fishtank/geometry/sharkGeometry';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FishtankEnvironment } from '../styles/fishtank/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import { disposeCreatureGeometries } from '../geometry/sharedGeometry';
import { createButterflyfishGeometries } from '../styles/fishtank/geometry/butterflyfishGeometry';
import { createSeaHorseGeometries } from '../styles/fishtank/geometry/seaHorseGeometry';
import { createFishGeometries } from '../styles/fishtank/geometry/smallFishGeometry';
import { type CreatureSize, createCreatureSizer } from './creatureSizing';
import {
  PredatorSpecies,
  type SceneCreatureMaterialDefaults,
  type SceneEnvironmentToggles,
  type ScenePresentationSettings,
  type SceneRendererHooks,
  type ColourStrategy,
  type MotionConfig,
  type PredatorRenderFlags,
  type StyleFlags,
  type BoidMotionStyleFlags,
  type BoidSpeciesConfig,
  type SceneBoidInstanceConfig,
  type ScenePredatorInstanceConfig,
  type SpeciesColorSet,
  type CreatureLabels,
} from './createSceneRendererHooks';

// --- Fishtank creature sizing: every fishtank creature is a factor of this
// single base creature size (the standard fish/boid). No fishtank creature is
// sized relative to another creature or to another scene.
const FISHTANK_BASE_CREATURE: CreatureSize = { length: 9.1, width: 6.24 };
const fishtankSize = createCreatureSizer(FISHTANK_BASE_CREATURE);

export const FISHTANK_CREATURE_SIZES = {
  fish: fishtankSize(1),
  butterflyfish: fishtankSize(1),
  // Sparrow reskin — smaller darting fish.
  sparrow: fishtankSize(0.525),
  // Shark — a large torpedo-shaped hunter, 36 x 15.84 world units.
  shark: fishtankSize(36 / FISHTANK_BASE_CREATURE.length, 15.84 / FISHTANK_BASE_CREATURE.width),
  // Sea horse (unicorn reskin) — 36 x 14.85 world units.
  seahorse: fishtankSize(36 / FISHTANK_BASE_CREATURE.length, 14.85 / FISHTANK_BASE_CREATURE.width),
} as const;

// Blood-splatter burst world size for fishtank catches. Owned per-scene so it
// can be tuned independently of the other scenes.
const FISHTANK_BLOOD_SPLATTER_SCALE = 6.3;

// --- Fishtank style color constants
// Butterflyfish (parrot reskin) color patterns: real-world butterflyfish often use
// yellow/white/orange/blue striped combinations.
const BUTTERFLYFISH_COLOR_PATTERNS: SpeciesColorSet[] = [
  // Yellow longnose-style: golden body, blue accents
  { body: new THREE.Color(0xf5c518), wing: new THREE.Color(0x1f6fd8), tail: new THREE.Color(0xf5c518) },
  // Orange/white banded
  { body: new THREE.Color(0xf07a1f), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0xf07a1f) },
  // Blue-and-yellow (raccoon-style)
  { body: new THREE.Color(0x2f8fd0), wing: new THREE.Color(0xf5c518), tail: new THREE.Color(0x2f8fd0) },
  // White with orange accents
  { body: new THREE.Color(0xf2ede0), wing: new THREE.Color(0xf07a1f), tail: new THREE.Color(0xf2ede0) },
  // Orange-and-blue (copperband-style)
  { body: new THREE.Color(0xe8981a), wing: new THREE.Color(0x2f6fdc), tail: new THREE.Color(0xe8981a) },
];

// Shark predator (fishtank dragon-geometry variant): medium gray hide
const SHARK_PREDATOR_BASE = new THREE.Color(0x6e7278); // medium slate-gray hide
const SHARK_PREDATOR_HUNT = new THREE.Color(0xa8adb3); // lighter, brighter gray when locked on

// Shark-specific motion constants
const SHARK_FLAP_FREQUENCY = 2.2;
const SHARK_FLAP_IDLE_AMPLITUDE = 0.05;
const SHARK_FLAP_SPEED_AMPLITUDE = 0.09;
const SHARK_TAIL_SWAY_AMPLITUDE = 0.5; // radians; a visibly wide side-to-side beat
const SHARK_TAIL_SWAY_FREQUENCY = 3.4; // faster than the subtle fin wobble — the main swimming motion
const SHARK_FIN_REST_TILT_RAD = 0.4;
const FISHTANK_FISH_MESH_BOOST = 2.2;
const FISHTANK_SHARK_MESH_BOOST = 0.55;
// Reference length fed to getSharkTailPivotY for the tail-sway pivot. This is
// an independent motion-tuning value, intentionally NOT the shark's geometry
// length (see FISHTANK_CREATURE_SIZES.shark) — preserved as-is.
const SHARK_TAIL_PIVOT_REFERENCE_LENGTH = 4.0;

// Utility function for deterministic per-creature hashing (used for variant selection)
function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface FishtankSceneRendererDependencies {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  driftingClouds: DriftingClouds;
  fishtankCenter: THREE.Vector3;
  fishtankEnv: FishtankEnvironment;
  natureEnv: { setVisible: (visible: boolean) => void };
}

export class FishtankSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: FishtankSceneRendererDependencies;

  // Fishtank owns and disposes its own creature geometries, sized from
  // FISHTANK_CREATURE_SIZES. No other scene knows about these.
  private readonly boidGeometries: CreatureGeometries;
  private readonly sparrowGeometries: CreatureGeometries;
  private readonly butterflyfishGeometries: CreatureGeometries;
  private readonly sharkPredatorGeometries: CreatureGeometries;
  private readonly unicornPredatorGeometries: CreatureGeometries;

  constructor(deps: FishtankSceneRendererDependencies) {
    this.deps = deps;
    this.boidGeometries = createFishGeometries(FISHTANK_CREATURE_SIZES.fish.length, FISHTANK_CREATURE_SIZES.fish.width);
    this.sparrowGeometries = createFishGeometries(FISHTANK_CREATURE_SIZES.sparrow.length, FISHTANK_CREATURE_SIZES.sparrow.width);
    this.butterflyfishGeometries = createButterflyfishGeometries(FISHTANK_CREATURE_SIZES.butterflyfish.length, FISHTANK_CREATURE_SIZES.butterflyfish.width);
    this.sharkPredatorGeometries = createSharkGeometries(FISHTANK_CREATURE_SIZES.shark.length, FISHTANK_CREATURE_SIZES.shark.width);
    this.unicornPredatorGeometries = createSeaHorseGeometries(FISHTANK_CREATURE_SIZES.seahorse.length, FISHTANK_CREATURE_SIZES.seahorse.width);
  }

  setStyleVisibility(): void {
    this.deps.natureEnv.setVisible(false);
    this.deps.fishtankEnv.setVisible(true);
    this.deps.driftingClouds.setVisible(false);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
  ): void {
    const fishtankBounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    const center = new THREE.Vector3(sim.width / 2, fishtankBounds.tankCenterY, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6 * TANK_VISUAL_SCALE,
      center.y + maxDim * 0.4 * TANK_VISUAL_SCALE,
      center.z + maxDim * 0.9 * TANK_VISUAL_SCALE,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  applyStyleTransition(
    sim: Simulation,
    maxDim: number,
    wasFishtank: boolean,
  ): void {
    const fishtankBounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    this.deps.controls.maxDistance = fishtankBounds.maxCameraDistance;
    this.deps.controls.minPolarAngle = Math.PI / 2 - fishtankBounds.cameraTiltUpRad;
    this.deps.controls.maxPolarAngle = Math.PI / 2 + fishtankBounds.cameraTiltDownRad;
    if (wasFishtank) return;
    const center = new THREE.Vector3(sim.width / 2, fishtankBounds.tankCenterY, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6 * TANK_VISUAL_SCALE,
      center.y + maxDim * 0.4 * TANK_VISUAL_SCALE,
      center.z + maxDim * 0.9 * TANK_VISUAL_SCALE,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  updateEnvironment(elapsed: number): void {
    this.deps.fishtankEnv.update(elapsed);
  }

  updateTransientEffects(_sim: Simulation, _elapsed: number): void {}

  configureEnvironmentAnchors(sim: Simulation, _center: THREE.Vector3, _maxDim: number): void {
    placeFishtankEnvironment(this.deps.fishtankEnv, sim.width, sim.height, params.worldDepth);
  }

  updateFrameAnchors(sim: Simulation): void {
    this.deps.fishtankCenter.set(sim.width / 2, 0, params.worldDepth / 2);
  }

  private computeFishtankMaxDistance(sim: Simulation): number {
    const bounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    const polarAngle = this.deps.controls.getPolarAngle();
    const elevation = Math.abs(polarAngle - Math.PI / 2);
    const distToCeiling = bounds.roomFloorY + bounds.roomHeight - bounds.tankCenterY;
    const distToFloor = bounds.tankCenterY - bounds.roomFloorY;
    const vertClearance = polarAngle < Math.PI / 2 ? distToCeiling : distToFloor;
    const sinE = Math.sin(elevation);
    const cosE = Math.cos(elevation);
    const vertCap = sinE > 1e-4 ? (vertClearance / sinE) * 0.92 : Infinity;
    const horizCap = (bounds.wallMargin / Math.max(cosE, 1e-4)) * 0.92;
    return Math.min(vertCap, horizCap);
  }

  updateCameraClamp(sim: Simulation): void {
    this.deps.controls.maxDistance = this.computeFishtankMaxDistance(sim);
  }

  applyEnvironmentToggles(toggles: SceneEnvironmentToggles): void {
    this.deps.fishtankEnv.setFogEnabled(toggles.fogEnabled);
    this.deps.fishtankEnv.setTimeOfDay(toggles.timeOfDay);
    this.deps.fishtankEnv.setWaterEffectsEnabled(toggles.waterEffectsEnabled);
  }

  setShadowsEnabled(enabled: boolean): void {
    this.deps.fishtankEnv.keyLight.castShadow = enabled;
  }

  setGalleryCreatureActive(active: boolean): void {
    this.deps.fishtankEnv.setRoomVisible(!active);
  }

  getPresentationSettings(): ScenePresentationSettings {
    return {
      bloomEnabled: false,
      afterimageEnabled: false,
      boundsHelperVisible: false,
      ambientLightIntensity: 0.55,
      keyLightVisible: false,
    };
  }

  getWorldScale(): number {
    return TANK_VISUAL_SCALE;
  }

  getBloodSplatterScale(): number {
    return FISHTANK_BLOOD_SPLATTER_SCALE;
  }

  mapPositionToRenderSpace(x: number, y: number, z: number, target: THREE.Vector3): void {
    const scale = TANK_VISUAL_SCALE;
    const c = this.deps.fishtankCenter;
    target.set(
      c.x + (x - c.x) * scale,
      c.y + (y - c.y) * scale,
      c.z + (z - c.z) * scale,
    );
  }

  getCreatureMaterialDefaults(): SceneCreatureMaterialDefaults {
    return {
      bodyEmissive: 0x000000,
      bodyEmissiveIntensity: 0,
      bodyRoughness: (isMonster: boolean) => isMonster ? 0.65 : 0.9,
      wingEmissive: 0x000000,
      wingEmissiveIntensity: 0,
      wingRoughness: (isMonster: boolean) => isMonster ? 0.65 : 0.9,
      wingColor: (isMonster: boolean, _isFishtank: boolean) => isMonster ? 0xb8bcc0 : 0xffffff,
    };
  }

  getPredatorColourStrategy(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): ColourStrategy {
    switch (species) {
      case PredatorSpecies.Horse: {
        const FISHTANK_SEAHORSE_COLORS = { body: new THREE.Color(0xf0d070), wing: new THREE.Color(0xf0d070), tail: new THREE.Color(0xf0d070) };
        return {
          baseColor: new THREE.Color(0xf0d070),
          highlightColor: new THREE.Color(0xfffacd),
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          getSpeciesColors: () => FISHTANK_SEAHORSE_COLORS,
        };
      }
      
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        return {
          baseColor: SHARK_PREDATOR_BASE,
          highlightColor: SHARK_PREDATOR_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getPredatorMotionConfig(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): MotionConfig {
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          flapFrequency: 3.2,
          flapIdleAmplitude: 0.22,
          flapSpeedAmplitude: 0.5,
          keepUpright: true,
          uprightStyle: 'unicorn',
          tailSwayAxis: new THREE.Vector3(1, 0, 0), // MODEL_RIGHT_AXIS
          worldScale: TANK_VISUAL_SCALE,
          meshScaleBoost: FISHTANK_FISH_MESH_BOOST,
        };
      
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        // Both map to shark motion in the fishtank
        return {
          flapFrequency: SHARK_FLAP_FREQUENCY,
          flapIdleAmplitude: SHARK_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: SHARK_FLAP_SPEED_AMPLITUDE,
          keepUpright: true,
          uprightStyle: 'shark',
          finRestBiasRad: SHARK_FIN_REST_TILT_RAD,
          tailSwayAxis: new THREE.Vector3(0, 1, 0), // MODEL_UP_AXIS
          tailSwayAmplitude: SHARK_TAIL_SWAY_AMPLITUDE,
          tailSwayFrequency: SHARK_TAIL_SWAY_FREQUENCY,
          tailSwayPivotY: getSharkTailPivotY(SHARK_TAIL_PIVOT_REFERENCE_LENGTH),
          worldScale: TANK_VISUAL_SCALE,
          meshScaleBoost: FISHTANK_FISH_MESH_BOOST * FISHTANK_SHARK_MESH_BOOST,
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getBoidColourStrategy(species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): ColourStrategy {
    // Fishtank boids have simpler coloring than nature (no panic jitter)
    const getColors = config.getColors;
    const isParrot = species === BoidSpecies.Multicolor;
    return {
      baseColor: config.natureBase, // Use nature base in fishtank (they're aquatic variants)
      highlightColor: new THREE.Color(0xffff00), // Yellow highlight for fishtank
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: false, // Fishtank fish have consistent coloring
      getSpeciesColors: isParrot
        ? (creature) => this.getButterflyfishColorVariant(creature)
        : getColors
          ? (creature) => getColors(creature, _flags)
          : (config.colors ? () => config.colors! : undefined),
      beakColor: config.beakColor,
      bakedWingPalette: true,
    };
  }

  getBoidMotionConfig(_species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags, _boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const tailSwayPivot = config.tailSwayPivotY ?? 0;
    
    return {
      flapFrequency: 3.0, // Fishtank fish flap a bit slower
      flapIdleAmplitude: 0.15,
      flapSpeedAmplitude: 0.4,
      getScale: (creature) => (creature as Boid).scale,
      tailSwayAxis: new THREE.Vector3(0, 1, 0), // Vertical oscillation (tail side-to-side)
      tailSwayAmplitude: 0.06,
      tailSwayFrequency: 2.2,
      tailSwayPivotY: tailSwayPivot,
      worldScale: TANK_VISUAL_SCALE,
      meshScaleBoost: FISHTANK_FISH_MESH_BOOST,
      preferUpright: false,
    };
  }

  getParrotColourStrategy(config: BoidSpeciesConfig, _flags: StyleFlags, bakedWingPalette: boolean): ColourStrategy {
    return {
      baseColor: config.natureBase,
      highlightColor: new THREE.Color(0xffff00), // Yellow highlight for fishtank
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: (creature) => this.getButterflyfishColorVariant(creature),
      beakColor: config.beakColor,
      bakedWingPalette,
      useNatureParrotPalette: false,
    };
  }

  private getButterflyfishColorVariant(creature: Boid | Predator): SpeciesColorSet {
    const baseIndex = Math.floor(idHash(creature.id, 42) * BUTTERFLYFISH_COLOR_PATTERNS.length) % BUTTERFLYFISH_COLOR_PATTERNS.length;
    if (params.galleryCreature === 'multicolor') {
      const cycleStep = Math.floor(performance.now() / 3200);
      return BUTTERFLYFISH_COLOR_PATTERNS[(baseIndex + cycleStep) % BUTTERFLYFISH_COLOR_PATTERNS.length];
    }
    return BUTTERFLYFISH_COLOR_PATTERNS[baseIndex];
  }

  getParrotGeometryProfile(_entity: Boid | Predator, _flags: StyleFlags): string {
    return 'neutral';
  }

  getParrotProfileNames(_flags: StyleFlags): string[] {
    return [];
  }

  getParrotProfileInstanceConfig(_profile: string, _flags: StyleFlags): SceneBoidInstanceConfig {
    return { geometries: this.butterflyfishGeometries, bodyVertexColors: true };
  }

  getBoidInstanceConfig(_species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): SceneBoidInstanceConfig {
    if (config.useSmallGeometry) {
      return { geometries: this.sparrowGeometries, bodyVertexColors: true };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.butterflyfishGeometries, bodyVertexColors: true };
    }
    return { geometries: this.boidGeometries, bodyVertexColors: true };
  }

  getPredatorInstanceConfig(
    species: PredatorSpecies,
    _flags: StyleFlags,
    _renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (species) {
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        // Both map to shark geometry in the fishtank
        return {
          geometries: this.sharkPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case PredatorSpecies.Horse:
        return {
          geometries: this.unicornPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getCreatureLabels(): CreatureLabels {
    return {
      boid: {
        normal: 'Fish',
        multicolor: 'Butterflyfish',
        gold: 'Goldfish',
        red: 'Clownfish',
        blue: 'Blue Tang',
      },
      predator: {
        normal: 'Shark',
        monster: 'Shark',
        horse: 'Sea Horse',
      },
    };
  }

  dispose(): void {
    this.deps.fishtankEnv.dispose();
    disposeCreatureGeometries(this.boidGeometries);
    disposeCreatureGeometries(this.sparrowGeometries);
    disposeCreatureGeometries(this.butterflyfishGeometries);
    disposeCreatureGeometries(this.sharkPredatorGeometries);
    disposeCreatureGeometries(this.unicornPredatorGeometries);
  }
}

// Export fishtank-style color constants and types for use in Renderer3D
export {
  BUTTERFLYFISH_COLOR_PATTERNS,
  SHARK_PREDATOR_BASE,
  SHARK_PREDATOR_HUNT,
  type SpeciesColorSet,
};
