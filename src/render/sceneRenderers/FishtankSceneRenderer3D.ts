import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import { type Boid, BoidSpecies } from '../../sim/Boid';
import { computeFishtankRoomBounds, placeFishtankEnvironment, TANK_VISUAL_SCALE } from '../styles/fishtank/environment';
import { getSharkTailPivotY, createSharkGeometries } from '../styles/fishtank/geometry/sharkGeometry';
import { getBarracudaTailPivotY, createBarracudaGeometries } from '../styles/fishtank/geometry/barracudaGeometry';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FishtankEnvironment } from '../styles/fishtank/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import { disposeCreatureGeometries } from '../geometry/sharedGeometry';
import { createButterflyfishGeometries } from '../styles/fishtank/geometry/butterflyfishGeometry';
import { createSeaHorseGeometries, SEAHORSE_BODY_COLOR, SEAHORSE_HUNT_COLOR } from '../styles/fishtank/geometry/seaHorseGeometry';
import {
  createPlainFishGeometries,
  createGoldfishGeometries,
  createClownfishGeometries,
  createBlueTangGeometries,
} from '../styles/fishtank/geometry/smallFishGeometry';
import { type CreatureSize, createCreatureSizer } from './creatureSizing';
import {
  PredatorSpecies,
  type SceneCreatureMaterialDefaults,
  type SceneEnvironmentToggles,
  type ScenePresentationSettings,
  type SceneRendererHooks,
  type ColorStrategy,
  type MotionConfig,
  type PredatorRenderFlags,
  type StyleFlags,
  type BoidMotionStyleFlags,
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
  // The five small aquarium fish (Tetra / Goldfish / Clownfish / Blue Tang /
  // Butterflyfish) are sized from these factors. Body-depth (back-to-belly,
  // −25%) and flank-to-flank width (narrower, −25%) are handled as shape
  // proportions in smallFishGeometry.ts (SMALL_FISH_BODY_DEPTH_SCALE /
  // SMALL_FISH_SIDE_SQUASH_SCALE) so they don't also rescale the fins.
  //
  // Clownfish / Blue Tang — shared small-fish size factor.
  smallFish: fishtankSize(0.75),
  // Goldfish — half the smallFish factor so it reads as noticeably smaller.
  goldfish: fishtankSize(0.75 * 0.5),
  // Plain "Tetra" — doubled from the original sparrow-derived size so it
  // reads more visibly in the tank; previously ×0.525 × 0.75.
  plainFish: fishtankSize(0.525 * 0.75 * 2),
  // Barracuda (normal predator) — long/lean but clearly smaller than the monster shark.
  barracuda: fishtankSize(27 / FISHTANK_BASE_CREATURE.length, 9.6 / FISHTANK_BASE_CREATURE.width),
  // Shark — a large torpedo-shaped hunter, 36 x 15.84 world units.
  shark: fishtankSize(36 / FISHTANK_BASE_CREATURE.length, 15.84 / FISHTANK_BASE_CREATURE.width),
  // Sea horse (unicorn reskin) — 36 x 14.85 world units.
  seahorse: fishtankSize(36 / FISHTANK_BASE_CREATURE.length, 14.85 / FISHTANK_BASE_CREATURE.width),
} as const;

// Blood-splatter burst world size for fishtank catches. Scaled by
// TANK_VISUAL_SCALE so the burst appears the same on-screen size as it does in
// the nature scene — the fishtank camera is TANK_VISUAL_SCALE times farther
// away from the fish (everything in render space is inflated by that factor),
// so sprites at the nature-scene scale (6.3) would appear 4× too small.
const FISHTANK_BLOOD_SPLATTER_SCALE = 6.3 * TANK_VISUAL_SCALE;

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
// Barracuda (normal fishtank predator): cooler steel-blue body with a brighter chase tint.
// Bright silvery steel base; the body geometry bakes its own dorsal-to-belly
// gradient (dark steel back → pale silver belly) as vertex colors that
// multiply against this, so keep the base near-white-silver to let that
// gradient show. Hunt state brightens toward a cold, almost mirror sheen.
const BARRACUDA_PREDATOR_BASE = new THREE.Color(0xc4ccd2);
const BARRACUDA_PREDATOR_HUNT = new THREE.Color(0xe8eef2);

// Per-species fishtank boid config. Owned by this scene so the aquatic-variant
// colors, beaks and geometry selection can be tuned independently of the other
// scenes (these base colors happen to match the nature plumage today, but are
// duplicated here so the fishtank can diverge without touching nature).
interface FishtankSpeciesConfig {
  baseColor: THREE.Color;
  beakColor?: THREE.Color;
  tailSwayPivotY?: number;
}

const FISHTANK_SPECIES_CONFIG: Record<BoidSpecies, FishtankSpeciesConfig> = {
  [BoidSpecies.Normal]: {
    baseColor: new THREE.Color(0xab8f68),
    beakColor: new THREE.Color(0x6b5a4a),
  },
  [BoidSpecies.Multicolor]: {
    baseColor: new THREE.Color(0xffffff),
    tailSwayPivotY: -4.186,
  },
  [BoidSpecies.Gold]: {
    baseColor: new THREE.Color(0xf5d327),
    beakColor: new THREE.Color(0xf07820),
  },
  [BoidSpecies.Red]: {
    baseColor: new THREE.Color(0xcc2936),
    beakColor: new THREE.Color(0xe84040),
  },
  [BoidSpecies.Blue]: {
    baseColor: new THREE.Color(0x3b6fa0),
    beakColor: new THREE.Color(0x8c8c8c),
  },
};

// Shark-specific motion constants
const SHARK_FLAP_FREQUENCY = 2.2;
const SHARK_FLAP_IDLE_AMPLITUDE = 0.05;
const SHARK_FLAP_SPEED_AMPLITUDE = 0.09;
const SHARK_TAIL_SWAY_AMPLITUDE = 0.5; // radians; a visibly wide side-to-side beat
const SHARK_TAIL_SWAY_FREQUENCY = 3.4; // faster than the subtle fin wobble — the main swimming motion
const SHARK_FIN_REST_TILT_RAD = 0.4;
const FISHTANK_FISH_MESH_BOOST = 2.2;
const FISHTANK_BARRACUDA_MESH_BOOST = 0.88;
const FISHTANK_SHARK_MESH_BOOST = 1.1;
const BARRACUDA_FLAP_FREQUENCY = 2.5;
const BARRACUDA_FLAP_IDLE_AMPLITUDE = 0.04;
const BARRACUDA_FLAP_SPEED_AMPLITUDE = 0.08;
const BARRACUDA_TAIL_SWAY_AMPLITUDE = 0.44;
const BARRACUDA_TAIL_SWAY_FREQUENCY = 3.9;
const BARRACUDA_FIN_REST_TILT_RAD = 0.32;
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
  /**
   * Lazy getter for the active FishtankEnvironment.  Returns null when
   * fishtank is not the active style (env is disposed).  All methods that
   * touch the env must null-guard before use.
   */
  getFishtankEnv: () => FishtankEnvironment | null;
}

export class FishtankSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: FishtankSceneRendererDependencies;

  // Fishtank owns and disposes its own creature geometries, sized from
  // FISHTANK_CREATURE_SIZES. No other scene knows about these. Each small-fish
  // species has its own fully color-baked geometry so it reads as that real
  // fish (see smallFishGeometry.ts).
  private readonly plainFishGeometries: CreatureGeometries;
  private readonly goldfishGeometries: CreatureGeometries;
  private readonly clownfishGeometries: CreatureGeometries;
  private readonly blueTangGeometries: CreatureGeometries;
  private readonly butterflyfishGeometries: CreatureGeometries;
  private readonly barracudaPredatorGeometries: CreatureGeometries;
  private readonly sharkPredatorGeometries: CreatureGeometries;
  private readonly unicornPredatorGeometries: CreatureGeometries;

  constructor(deps: FishtankSceneRendererDependencies) {
    this.deps = deps;
    // Plain "Tetra" uses its own doubled size; Goldfish its own halved size;
    // Clownfish and Blue Tang share the unchanged smallFish factor.
    this.plainFishGeometries = createPlainFishGeometries(FISHTANK_CREATURE_SIZES.plainFish.length, FISHTANK_CREATURE_SIZES.plainFish.width);
    this.goldfishGeometries = createGoldfishGeometries(FISHTANK_CREATURE_SIZES.goldfish.length, FISHTANK_CREATURE_SIZES.goldfish.width);
    this.clownfishGeometries = createClownfishGeometries(FISHTANK_CREATURE_SIZES.smallFish.length, FISHTANK_CREATURE_SIZES.smallFish.width);
    this.blueTangGeometries = createBlueTangGeometries(FISHTANK_CREATURE_SIZES.smallFish.length, FISHTANK_CREATURE_SIZES.smallFish.width);
    this.butterflyfishGeometries = createButterflyfishGeometries(FISHTANK_CREATURE_SIZES.butterflyfish.length, FISHTANK_CREATURE_SIZES.butterflyfish.width);
    this.barracudaPredatorGeometries = createBarracudaGeometries(FISHTANK_CREATURE_SIZES.barracuda.length, FISHTANK_CREATURE_SIZES.barracuda.width);
    this.sharkPredatorGeometries = createSharkGeometries(FISHTANK_CREATURE_SIZES.shark.length, FISHTANK_CREATURE_SIZES.shark.width);
    this.unicornPredatorGeometries = createSeaHorseGeometries(FISHTANK_CREATURE_SIZES.seahorse.length, FISHTANK_CREATURE_SIZES.seahorse.width);
  }

  setStyleVisibility(): void {
    // The fishtank env is created and revealed by LazyEnvProvider on switch.
    // The nature env has been disposed (null); nothing to hide here.
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
    this.deps.getFishtankEnv()?.update(elapsed);
  }

  updateSpecialCreatureEffects(_sim: Simulation, _elapsed: number, _dragonDisplayQuats: Map<number, THREE.Quaternion>): void {}

  configureEnvironmentAnchors(sim: Simulation, _center: THREE.Vector3, _maxDim: number): void {
    const env = this.deps.getFishtankEnv();
    if (!env) return;
    placeFishtankEnvironment(env, sim.width, sim.height, params.worldDepth);
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
    const env = this.deps.getFishtankEnv();
    if (!env) return;
    env.setFogEnabled(toggles.fogEnabled);
    env.setTimeOfDay(toggles.timeOfDay);
    env.setWaterEffectsEnabled(toggles.waterEffectsEnabled);
  }

  setShadowsEnabled(enabled: boolean): void {
    const env = this.deps.getFishtankEnv();
    if (!env) return;
    env.keyLight.castShadow = enabled;
  }

  setGalleryCreatureActive(active: boolean): void {
    this.deps.getFishtankEnv()?.setRoomVisible(!active);
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

  getCreatureMeshScaleBoost(species: PredatorSpecies | BoidSpecies, isPredator: boolean): number {
    // Mirrors the meshScaleBoost values in getPredatorMotionConfig /
    // getBoidMotionConfig. `isPredator` disambiguates the shared 'normal'
    // species string (a barracuda predator vs the standard fish boid).
    if (isPredator) {
      if (species === PredatorSpecies.Normal) return FISHTANK_FISH_MESH_BOOST * FISHTANK_BARRACUDA_MESH_BOOST;
      if (species === PredatorSpecies.Monster) return FISHTANK_FISH_MESH_BOOST * FISHTANK_SHARK_MESH_BOOST;
    }
    // Horse predator and every boid use the base fish boost.
    return FISHTANK_FISH_MESH_BOOST;
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

  getPredatorColorStrategy(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): ColorStrategy {
    switch (species) {
      case PredatorSpecies.Horse: {
        // Mauve-pink body that leans toward lavender (but not fully), sourced
        // from the seahorse's own palette so all seahorse color lives in
        // seaHorseGeometry.ts. body/wing/tail ALL carry the same seahorse body
        // tint as their instanceColor. Critically the tail instanceColor is the
        // body color (not white): the shared speciesTint applicator lerps each
        // part's instanceColor toward the hunt highlight, so a white tail
        // instanceColor would drift differently from the body during hunts and
        // pull the tail base out of sync with the body. The tail geometry bakes
        // its base->tip lavender gradient as a *ratio relative to the body*
        // (base = white, tip = tip/body), so instanceColor * bakedRatio
        // reproduces the intended absolute gradient while keeping the tail base
        // exactly equal to the body at every hunt intensity.
        const seahorseBody = new THREE.Color(SEAHORSE_BODY_COLOR);
        const FISHTANK_SEAHORSE_COLORS = {
          body: seahorseBody.clone(),
          // The pectoral fins bake their own rainbow vertex colors (see
          // seaHorseGeometry.buildPectoralFinGeometry); their instanceColor must
          // be white so the rainbow renders as pure color rather than being
          // multiplied by the body's pink tint.
          wing: new THREE.Color(0xffffff),
          tail: seahorseBody.clone(),
        };
        return {
          baseColor: seahorseBody.clone(),
          highlightColor: new THREE.Color(SEAHORSE_HUNT_COLOR),
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          getSpeciesColors: () => FISHTANK_SEAHORSE_COLORS,
          // Lock the palette: there is only ever one seahorse, so the per-
          // individual HSL jitter adds no variety — it just lightened this
          // single body toward white, leaving it looking washed out next to the
          // tail's baked (un-jittered) base color. Locking keeps the body/wing
          // at the exact SEAHORSE_BODY_COLOR so the body matches the tail base.
          lockSpeciesPalette: true,
          colorMode: 'speciesTint',
        };
      }

      case PredatorSpecies.Normal:
        return {
          baseColor: BARRACUDA_PREDATOR_BASE,
          highlightColor: BARRACUDA_PREDATOR_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          colorMode: 'flat',
        };

      case PredatorSpecies.Monster:
        return {
          baseColor: SHARK_PREDATOR_BASE,
          highlightColor: SHARK_PREDATOR_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          colorMode: 'flat',
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
          // Gentle pectoral flutter. The shared engine flaps the fins around
          // the body's long axis pivoting at the centerline; large amplitudes
          // swung the side fins through the torso. Small amplitudes keep the
          // now side-mounted fins feathering fore/aft at the shoulder.
          flapIdleAmplitude: 0.1,
          flapSpeedAmplitude: 0.18,
          keepUpright: true,
          uprightStyle: 'unicorn',
          tailSwayAxis: new THREE.Vector3(1, 0, 0), // MODEL_RIGHT_AXIS
          worldScale: TANK_VISUAL_SCALE,
          meshScaleBoost: FISHTANK_FISH_MESH_BOOST,
          // The upright seahorse's model origin sits well above its base, so at
          // low swim heights its body/tail would otherwise clip through the tank
          // floor (issue #154). Clamp its rendered bottom to the floor.
          restOnFloor: true,
        };

      case PredatorSpecies.Normal:
        return {
          flapFrequency: BARRACUDA_FLAP_FREQUENCY,
          flapIdleAmplitude: BARRACUDA_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: BARRACUDA_FLAP_SPEED_AMPLITUDE,
          keepUpright: true,
          uprightStyle: 'shark',
          finRestBiasRad: BARRACUDA_FIN_REST_TILT_RAD,
          tailSwayAxis: new THREE.Vector3(0, 1, 0), // MODEL_UP_AXIS
          tailSwayAmplitude: BARRACUDA_TAIL_SWAY_AMPLITUDE,
          tailSwayFrequency: BARRACUDA_TAIL_SWAY_FREQUENCY,
          tailSwayPivotY: getBarracudaTailPivotY(FISHTANK_CREATURE_SIZES.barracuda.length),
          worldScale: TANK_VISUAL_SCALE,
          meshScaleBoost: FISHTANK_FISH_MESH_BOOST * FISHTANK_BARRACUDA_MESH_BOOST,
          // Long lean body: keep its nose/tail from poking through the side
          // glass when swimming near a wall (issue #167).
          containWithinTankWalls: true,
        };

      case PredatorSpecies.Monster:
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
          // Long body: keep its nose/tail from poking through the side glass
          // when swimming near a wall (issue #167).
          containWithinTankWalls: true,
        };

      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getBoidColorStrategy(species: BoidSpecies, _flags: StyleFlags): ColorStrategy {
    // Fishtank boids have simpler coloring than nature (no panic jitter).
    const config = FISHTANK_SPECIES_CONFIG[species];
    const isParrot = species === BoidSpecies.Multicolor;
    if (isParrot) {
      // Butterflyfish: per-variant striped tint over the baked stripe geometry.
      return {
        baseColor: config.baseColor,
        highlightColor: new THREE.Color(0xffff00),
        getIntensity: (creature) => (creature as Boid).panicLevel,
        individualVariation: false,
        getSpeciesColors: (creature) => this.getButterflyfishColorVariant(creature),
        beakColor: config.beakColor,
        colorMode: 'speciesTint',
      };
    }
    // The five small fish (Tetra / Goldfish / Clownfish / Blue Tang / Butterflyfish) bake their
    // full multi-hue colors into their geometry, so the instance color just
    // passes white through (small-bird color path) to show the baked pattern.
    return {
      baseColor: config.baseColor,
      highlightColor: new THREE.Color(0xffff00),
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: false,
      getSpeciesColors: undefined,
      beakColor: config.beakColor,
      bakedBodyGradient: true,
      colorMode: 'smallBird',
    };
  }

  getBoidMotionConfig(species: BoidSpecies, _flags: StyleFlags, _boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const tailSwayPivot = FISHTANK_SPECIES_CONFIG[species].tailSwayPivotY ?? 0;

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
      // Keep fish dorsal-up: their flattened bodies + distinct dorsal fin make an
      // unconstrained roll read as swimming sideways/upside-down. This anchors
      // model +Z (dorsal) to world up while still allowing pitch and turn-banking.
      preferUpright: true,
    };
  }

  getParrotColorStrategy(_flags: StyleFlags, _bakedWingPalette: boolean): ColorStrategy {
    const parrotConfig = FISHTANK_SPECIES_CONFIG[BoidSpecies.Multicolor];
    return {
      baseColor: parrotConfig.baseColor,
      highlightColor: new THREE.Color(0xffff00), // Yellow highlight for fishtank
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: (creature) => this.getButterflyfishColorVariant(creature),
      beakColor: parrotConfig.beakColor,
      colorMode: 'speciesTint',
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

  getBoidInstanceConfig(species: BoidSpecies, _flags: StyleFlags): SceneBoidInstanceConfig {
    switch (species) {
      case BoidSpecies.Gold:
        return { geometries: this.goldfishGeometries, bodyVertexColors: true };
      case BoidSpecies.Red:
        return { geometries: this.clownfishGeometries, bodyVertexColors: true };
      case BoidSpecies.Blue:
        return { geometries: this.blueTangGeometries, bodyVertexColors: true };
      case BoidSpecies.Multicolor:
        return { geometries: this.butterflyfishGeometries, bodyVertexColors: true };
      default:
        return { geometries: this.plainFishGeometries, bodyVertexColors: true };
    }
  }

  getPredatorInstanceConfig(
    species: PredatorSpecies,
    _flags: StyleFlags,
    _renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (species) {
      case PredatorSpecies.Normal:
        return {
          geometries: this.barracudaPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case PredatorSpecies.Monster:
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
        normal: 'Tetra',
        multicolor: 'Butterflyfish',
        gold: 'Goldfish',
        red: 'Clownfish',
        blue: 'Blue Tang',
      },
      predator: {
        normal: 'Barracuda',
        monster: 'Shark',
        horse: 'Sea Horse',
      },
    };
  }

  dispose(): void {
    // The fishtank env is owned by LazyEnvProvider and disposed there — do not
    // call dispose() on it here to avoid a double-dispose.
    disposeCreatureGeometries(this.plainFishGeometries);
    disposeCreatureGeometries(this.goldfishGeometries);
    disposeCreatureGeometries(this.clownfishGeometries);
    disposeCreatureGeometries(this.blueTangGeometries);
    disposeCreatureGeometries(this.butterflyfishGeometries);
    disposeCreatureGeometries(this.barracudaPredatorGeometries);
    disposeCreatureGeometries(this.sharkPredatorGeometries);
    disposeCreatureGeometries(this.unicornPredatorGeometries);
  }
}
