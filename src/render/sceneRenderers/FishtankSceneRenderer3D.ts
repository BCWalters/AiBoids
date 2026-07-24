import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import { computeFishtankRoomBounds, placeFishtankEnvironment, TANK_VISUAL_SCALE } from '../styles/fishtank/environment';
import { getSharkTailPivotY } from '../styles/fishtank/geometry/sharkGeometry';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FishtankEnvironment } from '../styles/fishtank/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import type {
  FishtankBounds,
  SceneCreatureMaterialDefaults,
  SceneEnvironmentToggles,
  ScenePresentationSettings,
  SceneRendererHooks,
  ColourStrategy,
  MotionConfig,
  PredatorRenderFlags,
  StyleFlags,
  BoidMotionStyleFlags,
  BoidSpeciesConfig,
  SceneBoidInstanceConfig,
  ScenePredatorInstanceConfig,
  SpeciesColorSet,
} from './createSceneRendererHooks';

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
const SHARK_LENGTH = 4.0; // approximate length for tail pivot calculation

// Utility function for deterministic per-entity hashing (used for variant selection)
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
  fishtankSparrowGeometries: CreatureGeometries;
  fishtankButterflyfishGeometries: CreatureGeometries;
  fishtankBoidGeometries: CreatureGeometries;
  fishtankPredatorGeometries: CreatureGeometries;
  fishtankSharkPredatorGeometries: CreatureGeometries;
  fishtankUnicornPredatorGeometries: CreatureGeometries;
}

export class FishtankSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: FishtankSceneRendererDependencies;

  constructor(deps: FishtankSceneRendererDependencies) {
    this.deps = deps;
  }

  setStyleVisibility(): void {
    this.deps.natureEnv.setVisible(false);
    this.deps.fishtankEnv.setVisible(true);
    this.deps.driftingClouds.setVisible(false);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
    fishtankBounds: FishtankBounds,
  ): void {
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
    fishtankBounds: FishtankBounds,
    wasFishtank: boolean,
  ): void {
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
      bodyRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingEmissive: 0x000000,
      wingEmissiveIntensity: 0,
      wingRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingColor: (isDragon: boolean, _isFishtank: boolean) => isDragon ? 0xb8bcc0 : 0xffffff,
    };
  }

  getPredatorColourStrategy(_kind: string, _renderFlags: PredatorRenderFlags): ColourStrategy {
    switch (_kind) {
      case 'horse': {
        const FISHTANK_SEAHORSE_COLORS = { body: new THREE.Color(0xf0d070), wing: new THREE.Color(0xf0d070), tail: new THREE.Color(0xf0d070) };
        return {
          baseColor: new THREE.Color(0xf0d070),
          highlightColor: new THREE.Color(0xfffacd),
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
          getSpeciesColors: () => FISHTANK_SEAHORSE_COLORS,
        };
      }
      
      case 'normal':
        return {
          baseColor: SHARK_PREDATOR_BASE,
          highlightColor: SHARK_PREDATOR_HUNT,
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
        };
      
      default:
        throw new Error(`Unknown predator kind: ${_kind}`);
    }
  }

  getPredatorMotionConfig(_kind: string, _renderFlags: PredatorRenderFlags): MotionConfig {
    switch (_kind) {
      case 'horse':
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
      
      case 'normal':
        // Sharks use distinct tail/fin motion
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
          tailSwayPivotY: getSharkTailPivotY(SHARK_LENGTH),
          worldScale: TANK_VISUAL_SCALE,
          meshScaleBoost: FISHTANK_FISH_MESH_BOOST * FISHTANK_SHARK_MESH_BOOST,
        };
      
      default:
        throw new Error(`Unknown predator kind: ${_kind}`);
    }
  }

  getBoidColourStrategy(species: string, config: BoidSpeciesConfig, _flags: StyleFlags): ColourStrategy {
    // Fishtank boids have simpler coloring than nature (no panic jitter)
    const getColors = config.getColors;
    const isParrot = species === 'multicolor';
    return {
      baseColor: config.natureBase, // Use nature base in fishtank (they're aquatic variants)
      highlightColor: new THREE.Color(0xffff00), // Yellow highlight for fishtank
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: false, // Fishtank fish have consistent coloring
      getSpeciesColors: isParrot
        ? (entity) => this.getButterflyfishColorVariant(entity)
        : getColors
          ? (entity) => getColors(entity, _flags)
          : (config.colors ? () => config.colors! : undefined),
      beakColor: config.beakColor,
      bakedWingPalette: true,
    };
  }

  getBoidMotionConfig(_species: string, config: BoidSpeciesConfig, _flags: StyleFlags, _boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const tailSwayPivot = config.tailSwayPivotY ?? 0;
    
    return {
      flapFrequency: 3.0, // Fishtank fish flap a bit slower
      flapIdleAmplitude: 0.15,
      flapSpeedAmplitude: 0.4,
      getScale: (entity) => (entity as Boid).scale,
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
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: (entity) => this.getButterflyfishColorVariant(entity),
      beakColor: config.beakColor,
      bakedWingPalette,
      useNatureParrotPalette: false,
    };
  }

  private getButterflyfishColorVariant(entity: Boid | Predator): SpeciesColorSet {
    const baseIndex = Math.floor(idHash(entity.id, 42) * BUTTERFLYFISH_COLOR_PATTERNS.length) % BUTTERFLYFISH_COLOR_PATTERNS.length;
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
    return { geometries: this.deps.fishtankButterflyfishGeometries, bodyVertexColors: true };
  }

  getBoidInstanceConfig(_species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): SceneBoidInstanceConfig {
    if (config.useSmallGeometry) {
      return { geometries: this.deps.fishtankSparrowGeometries, bodyVertexColors: true };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.deps.fishtankButterflyfishGeometries, bodyVertexColors: true };
    }
    return { geometries: this.deps.fishtankBoidGeometries, bodyVertexColors: true };
  }

  getPredatorInstanceConfig(
    kind: 'normal' | 'horse',
    _flags: StyleFlags,
    renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (kind) {
      case 'normal':
        return {
          geometries: renderFlags.isDragon ? this.deps.fishtankSharkPredatorGeometries : this.deps.fishtankPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case 'horse':
        return {
          geometries: this.deps.fishtankUnicornPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      default:
        throw new Error(`Unknown predator kind: ${kind}`);
    }
  }

  dispose(): void {
    this.deps.fishtankEnv.dispose();
  }
}

// Export fishtank-style color constants and types for use in Renderer3D
export {
  BUTTERFLYFISH_COLOR_PATTERNS,
  SHARK_PREDATOR_BASE,
  SHARK_PREDATOR_HUNT,
  type SpeciesColorSet,
};
