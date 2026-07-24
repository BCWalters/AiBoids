import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import { type Boid, BoidSpecies } from '../../sim/Boid';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FishtankEnvironment } from '../styles/fishtank/environment';
import type { NatureEnvironment } from '../styles/nature/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import {
  PredatorSpecies,
  type SpeciesColorSet,
  type FishtankBounds,
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
  type CreatureLabels,
} from './createSceneRendererHooks';

// --- Arcade style color constants: bright, saturated emissive colors for bloom effect
const ARCADE_BOID_EMISSIVE = new THREE.Color(0x5ad1ff);
const ARCADE_BOID_BASE = new THREE.Color(0x2ab6e8);
const ARCADE_BOID_PANIC = new THREE.Color(0xffe066);
const ARCADE_PREDATOR_BASE = new THREE.Color(0xb31f1f);
const ARCADE_PREDATOR_HUNT = new THREE.Color(0xffffff);
const ARCADE_PARROT_EMISSIVE = new THREE.Color(0xe030c8);
const ARCADE_PARROT_BASE = new THREE.Color(0xd048c0);
const ARCADE_GOLDFINCH_EMISSIVE = new THREE.Color(0xffe017);
const ARCADE_GOLDFINCH_BASE = new THREE.Color(0xc7b21a);
const ARCADE_CARDINAL_EMISSIVE = new THREE.Color(0xff8c1a); // orange-red, distinct from predator red
const ARCADE_CARDINAL_BASE = new THREE.Color(0xcc5c14);
const ARCADE_BLUEJAY_EMISSIVE = new THREE.Color(0x3aa0ff);
const ARCADE_BLUEJAY_BASE = new THREE.Color(0x2d6fb0);
const ARCADE_UNICORN_BASE = new THREE.Color(0xc9a0f0);
const ARCADE_UNICORN_HUNT = new THREE.Color(0xffffff);

// Neon rainbow palette for multicolor ("Rainbow") boids in arcade style.
// Each entry gives body/wing/tail a vivid hue so the flock shows real variety.
const ARCADE_MULTICOLOR_VARIANTS: SpeciesColorSet[] = [
  { body: new THREE.Color(0xd048c0), wing: new THREE.Color(0xe060d8), tail: new THREE.Color(0xb03898) }, // magenta
  { body: new THREE.Color(0xff4040), wing: new THREE.Color(0xff6060), tail: new THREE.Color(0xcc2020) }, // red
  { body: new THREE.Color(0x40c0ff), wing: new THREE.Color(0x60d0ff), tail: new THREE.Color(0x2090cc) }, // cyan
  { body: new THREE.Color(0x40e060), wing: new THREE.Color(0x60f080), tail: new THREE.Color(0x20a040) }, // green
  { body: new THREE.Color(0xffe040), wing: new THREE.Color(0xfff060), tail: new THREE.Color(0xc0a820) }, // yellow
  { body: new THREE.Color(0xff8020), wing: new THREE.Color(0xffa040), tail: new THREE.Color(0xcc5010) }, // orange
  { body: new THREE.Color(0x8040ff), wing: new THREE.Color(0xa060ff), tail: new THREE.Color(0x6020cc) }, // violet
];

function arcadeIdHash(id: number, salt: number): number {
  const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Arcade motion constants (simplified, no exotic variants)
const ARCADE_FLAP_FREQUENCY = 7.6;
const ARCADE_FLAP_IDLE_AMPLITUDE = 0.25;
const ARCADE_FLAP_SPEED_AMPLITUDE = 0.9;
const ARCADE_UNICORN_FLAP_FREQUENCY = 3.2;
const ARCADE_UNICORN_FLAP_IDLE_AMPLITUDE = 0.22;
const ARCADE_UNICORN_FLAP_SPEED_AMPLITUDE = 0.5;
const ARCADE_UNICORN_BANK_SCALE = 0.35;

interface ArcadeSceneRendererDependencies {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  driftingClouds: DriftingClouds;
  fishtankEnv: FishtankEnvironment;
  natureEnv: NatureEnvironment;
  arcadeSparrowGeometries: CreatureGeometries;
  arcadeParrotGeometries: CreatureGeometries;
  arcadeBoidGeometries: CreatureGeometries;
  arcadePredatorGeometries: CreatureGeometries;
}

export class ArcadeSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: ArcadeSceneRendererDependencies;

  constructor(deps: ArcadeSceneRendererDependencies) {
    this.deps = deps;
  }

  setStyleVisibility(): void {
    this.deps.natureEnv.setVisible(false);
    this.deps.fishtankEnv.setVisible(false);
    this.deps.driftingClouds.setVisible(false);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
    _fishtankBounds: FishtankBounds,
  ): void {
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6,
      center.y + maxDim * 0.4,
      center.z + maxDim * 0.9,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  applyStyleTransition(
    sim: Simulation,
    maxDim: number,
    _fishtankBounds: FishtankBounds,
    wasFishtank: boolean,
  ): void {
    this.deps.controls.maxDistance = maxDim * 25;
    this.deps.controls.minPolarAngle = 0;
    this.deps.controls.maxPolarAngle = Math.PI;
    if (!wasFishtank) return;
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6,
      center.y + maxDim * 0.4,
      center.z + maxDim * 0.9,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  updateEnvironment(_elapsed: number): void {}

  updateTransientEffects(_sim: Simulation, _elapsed: number): void {}

  configureEnvironmentAnchors(_sim: Simulation, _center: THREE.Vector3, _maxDim: number): void {}

  updateFrameAnchors(_sim: Simulation): void {}

  updateCameraClamp(_sim: Simulation): void {}

  applyEnvironmentToggles(_toggles: SceneEnvironmentToggles): void {}

  setShadowsEnabled(_enabled: boolean): void {}

  setGalleryCreatureActive(_active: boolean): void {}

  getPresentationSettings(): ScenePresentationSettings {
    return {
      bloomEnabled: true,
      afterimageEnabled: true,
      boundsHelperVisible: true,
      ambientLightIntensity: 0.35,
      keyLightVisible: true,
    };
  }

  getWorldScale(): number {
    return 1;
  }

  mapPositionToRenderSpace(x: number, y: number, z: number, target: THREE.Vector3): void {
    target.set(x, y, z);
  }

  getCreatureMaterialDefaults(): SceneCreatureMaterialDefaults {
    return {
      bodyEmissive: 0xffffff,
      bodyEmissiveIntensity: 1.4,
      bodyRoughness: (_isMonster: boolean) => 0.5,
      wingEmissive: 0xffffff,
      wingEmissiveIntensity: 1.1,
      wingRoughness: (_isMonster: boolean) => 0.5,
      wingColor: (_isMonster: boolean, _isFishtank: boolean) => 0xffffff,
    };
  }

  getPredatorColourStrategy(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): ColourStrategy {
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          baseColor: ARCADE_UNICORN_BASE,
          highlightColor: ARCADE_UNICORN_HUNT,
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
        };
      
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        return {
          baseColor: ARCADE_PREDATOR_BASE,
          highlightColor: ARCADE_PREDATOR_HUNT,
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getPredatorMotionConfig(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): MotionConfig {
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          flapFrequency: ARCADE_UNICORN_FLAP_FREQUENCY,
          flapIdleAmplitude: ARCADE_UNICORN_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: ARCADE_UNICORN_FLAP_SPEED_AMPLITUDE,
          keepUpright: true,
          uprightStyle: 'unicorn',
          bankScale: ARCADE_UNICORN_BANK_SCALE,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        return {
          flapFrequency: ARCADE_FLAP_FREQUENCY,
          flapIdleAmplitude: ARCADE_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: ARCADE_FLAP_SPEED_AMPLITUDE,
          keepUpright: false,
          uprightStyle: undefined,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getBoidColourStrategy(species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): ColourStrategy {
    // Arcade has bright, simple coloring. Each species uses its arcadeBase color.
    // Multicolor ("Rainbow") boids get a per-entity neon variant for visual variety.
    // config.colors is nature-specific plumage and must NOT be used here.
    return {
      baseColor: config.arcadeBase,
      highlightColor: ARCADE_BOID_PANIC,
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: species !== BoidSpecies.Multicolor && !!config.colors,
      getSpeciesColors: species === BoidSpecies.Multicolor
        ? (entity) => {
            const idx = Math.floor(arcadeIdHash(entity.id, 42) * ARCADE_MULTICOLOR_VARIANTS.length) % ARCADE_MULTICOLOR_VARIANTS.length;
            return ARCADE_MULTICOLOR_VARIANTS[idx];
          }
        : undefined,
      beakColor: config.beakColor,
      bakedWingPalette: true,
    };
  }

  getBoidMotionConfig(_species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags, _boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const tailSwayPivot = config.tailSwayPivotY ?? 0;
    
    return {
      flapFrequency: ARCADE_FLAP_FREQUENCY,
      flapIdleAmplitude: ARCADE_FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: ARCADE_FLAP_SPEED_AMPLITUDE,
      getScale: (entity) => (entity as Boid).scale,
      tailSwayAxis: new THREE.Vector3(1, 0, 0), // Right axis
      tailSwayAmplitude: 0,
      tailSwayPivotY: tailSwayPivot,
      worldScale: 1,
      meshScaleBoost: 1,
      preferUpright: true,
    };
  }

  getParrotColourStrategy(config: BoidSpeciesConfig, _flags: StyleFlags, bakedWingPalette: boolean): ColourStrategy {
    return {
      baseColor: ARCADE_PARROT_BASE,
      highlightColor: ARCADE_BOID_PANIC,
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: false, // Arcade parrots are uniform
      getSpeciesColors: undefined, // All arcade parrots use the base color
      beakColor: config.beakColor,
      bakedWingPalette,
      useNatureParrotPalette: false,
    };
  }

  getParrotGeometryProfile(_entity: Boid | Predator, _flags: StyleFlags): string {
    return 'neutral';
  }

  getParrotProfileNames(_flags: StyleFlags): string[] {
    return [];
  }

  getParrotProfileInstanceConfig(_profile: string, _flags: StyleFlags): SceneBoidInstanceConfig {
    return { geometries: this.deps.arcadeParrotGeometries, bodyVertexColors: false };
  }

  getBoidInstanceConfig(_species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): SceneBoidInstanceConfig {
    if (config.useSmallGeometry) {
      return { geometries: this.deps.arcadeSparrowGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.deps.arcadeParrotGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
    }
    return { geometries: this.deps.arcadeBoidGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
  }

  getPredatorInstanceConfig(
    species: PredatorSpecies,
    _flags: StyleFlags,
    _renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (species) {
      case PredatorSpecies.Normal:
      case PredatorSpecies.Monster:
      case PredatorSpecies.Horse:
        return {
          geometries: this.deps.arcadePredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: false,
        };
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getCreatureLabels(): CreatureLabels {
    return {
      boid: {
        normal: 'Boid',
        multicolor: 'Rainbow',
        gold: 'Gold',
        red: 'Red',
        blue: 'Blue',
      },
      predator: {
        normal: 'Predator',
        monster: 'Dragon',
        horse: 'Floater',
      },
    };
  }

  dispose(): void {}
}

// Export arcade-style color constants for use in Renderer3D
export {
  ARCADE_BOID_EMISSIVE,
  ARCADE_BOID_BASE,
  ARCADE_BOID_PANIC,
  ARCADE_PREDATOR_BASE,
  ARCADE_PREDATOR_HUNT,
  ARCADE_PARROT_EMISSIVE,
  ARCADE_PARROT_BASE,
  ARCADE_GOLDFINCH_EMISSIVE,
  ARCADE_GOLDFINCH_BASE,
  ARCADE_CARDINAL_EMISSIVE,
  ARCADE_CARDINAL_BASE,
  ARCADE_BLUEJAY_EMISSIVE,
  ARCADE_BLUEJAY_BASE,
  ARCADE_UNICORN_BASE,
  ARCADE_UNICORN_HUNT,
};
