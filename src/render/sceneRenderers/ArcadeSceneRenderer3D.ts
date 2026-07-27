import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import { type Boid, BoidSpecies } from '../../sim/Boid';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import { disposeCreatureGeometries } from '../geometry/sharedGeometry';
import { createBirdGeometries } from '../styles/nature/geometry/smallBirdGeometry';
import { type CreatureSize, createCreatureSizer } from './creatureSizing';
import {
  PredatorSpecies,
  type SpeciesColorSet,
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
  type CreatureLabels,
} from './createSceneRendererHooks';

// --- Arcade creature sizing: every arcade creature is a factor of this
// single base creature size. No arcade creature is sized relative to another
// creature or to another scene.
const ARCADE_BASE_CREATURE: CreatureSize = { length: 7, width: 2.6 };
const arcadeSize = createCreatureSizer(ARCADE_BASE_CREATURE);

const ARCADE_CREATURE_SIZES = {
  boid: arcadeSize(1),
  sparrow: arcadeSize(0.7),
  parrot: arcadeSize(1),
  // Hawk-style predator — 12 x 4.4 world units.
  predator: arcadeSize(12 / ARCADE_BASE_CREATURE.length, 4.4 / ARCADE_BASE_CREATURE.width),
} as const;

// Blood-splatter burst world size for arcade catches. Owned per-scene so it
// can be tuned independently of the other scenes.
const ARCADE_BLOOD_SPLATTER_SCALE = 6.3;

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

// Per-species arcade boid config. Owned by this scene so arcade coloring,
// beaks and geometry selection can be tuned without touching other scenes.
interface ArcadeSpeciesConfig {
  arcadeBase: THREE.Color;
  arcadeEmissive: THREE.Color;
  beakColor?: THREE.Color;
  tailSwayPivotY?: number;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
  /** Per-creature HSL variation of the base color (songbird species only). */
  individualVariation: boolean;
}

const ARCADE_SPECIES_CONFIG: Record<BoidSpecies, ArcadeSpeciesConfig> = {
  [BoidSpecies.Normal]: {
    arcadeBase: ARCADE_BOID_BASE,
    arcadeEmissive: ARCADE_BOID_EMISSIVE,
    beakColor: new THREE.Color(0x6b5a4a),
    useSmallGeometry: true,
    individualVariation: false,
  },
  [BoidSpecies.Multicolor]: {
    arcadeBase: ARCADE_PARROT_BASE,
    arcadeEmissive: ARCADE_PARROT_EMISSIVE,
    useParrotGeometry: true,
    tailSwayPivotY: -4.186,
    useSmallGeometry: false,
    individualVariation: false,
  },
  [BoidSpecies.Gold]: {
    arcadeBase: ARCADE_GOLDFINCH_BASE,
    arcadeEmissive: ARCADE_GOLDFINCH_EMISSIVE,
    beakColor: new THREE.Color(0xf07820),
    useSmallGeometry: false,
    individualVariation: true,
  },
  [BoidSpecies.Red]: {
    arcadeBase: ARCADE_CARDINAL_BASE,
    arcadeEmissive: ARCADE_CARDINAL_EMISSIVE,
    beakColor: new THREE.Color(0xe84040),
    useSmallGeometry: false,
    individualVariation: true,
  },
  [BoidSpecies.Blue]: {
    arcadeBase: ARCADE_BLUEJAY_BASE,
    arcadeEmissive: ARCADE_BLUEJAY_EMISSIVE,
    beakColor: new THREE.Color(0x8c8c8c),
    useSmallGeometry: false,
    individualVariation: true,
  },
};

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
}

export class ArcadeSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: ArcadeSceneRendererDependencies;

  // Arcade owns and disposes its own creature geometries, sized from
  // ARCADE_CREATURE_SIZES. No other scene knows about these.
  private readonly boidGeometries: CreatureGeometries;
  private readonly sparrowGeometries: CreatureGeometries;
  private readonly parrotGeometries: CreatureGeometries;
  private readonly predatorGeometries: CreatureGeometries;

  constructor(deps: ArcadeSceneRendererDependencies) {
    this.deps = deps;
    this.boidGeometries = createBirdGeometries(ARCADE_CREATURE_SIZES.boid.length, ARCADE_CREATURE_SIZES.boid.width);
    this.sparrowGeometries = createBirdGeometries(ARCADE_CREATURE_SIZES.sparrow.length, ARCADE_CREATURE_SIZES.sparrow.width);
    this.parrotGeometries = createBirdGeometries(ARCADE_CREATURE_SIZES.parrot.length, ARCADE_CREATURE_SIZES.parrot.width);
    this.predatorGeometries = createBirdGeometries(ARCADE_CREATURE_SIZES.predator.length, ARCADE_CREATURE_SIZES.predator.width);
  }

  setStyleVisibility(): void {
    // Both nature and fishtank envs are disposed (null) when arcade is active
    // — no setVisible(false) needed; they no longer exist in the scene graph.
    this.deps.driftingClouds.setVisible(false);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
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

  updateSpecialCreatureEffects(_sim: Simulation, _elapsed: number, _dragonDisplayQuats: Map<number, THREE.Quaternion>): void {}

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

  getCreatureMeshScaleBoost(): number {
    // Arcade renders creatures at their base geometry scale (no per-species boost).
    return 1;
  }

  getBloodSplatterScale(): number {
    return ARCADE_BLOOD_SPLATTER_SCALE;
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

  getPredatorColorStrategy(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): ColorStrategy {
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          baseColor: ARCADE_UNICORN_BASE,
          highlightColor: ARCADE_UNICORN_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          colorMode: 'flat',
        };
      
      case PredatorSpecies.Monster:
      case PredatorSpecies.Normal:
        return {
          baseColor: ARCADE_PREDATOR_BASE,
          highlightColor: ARCADE_PREDATOR_HUNT,
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

  getBoidColorStrategy(species: BoidSpecies, _flags: StyleFlags): ColorStrategy {
    // Arcade has bright, simple coloring. Each species uses its arcadeBase color.
    // Multicolor ("Rainbow") boids get a per-creature neon variant for variety.
    const config = ARCADE_SPECIES_CONFIG[species];
    return {
      baseColor: config.arcadeBase,
      highlightColor: ARCADE_BOID_PANIC,
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: config.individualVariation,
      getSpeciesColors: species === BoidSpecies.Multicolor
        ? (creature) => {
            const idx = Math.floor(arcadeIdHash(creature.id, 42) * ARCADE_MULTICOLOR_VARIANTS.length) % ARCADE_MULTICOLOR_VARIANTS.length;
            return ARCADE_MULTICOLOR_VARIANTS[idx];
          }
        : undefined,
      beakColor: config.beakColor,
      colorMode: species === BoidSpecies.Multicolor
        ? 'speciesTint'
        : config.individualVariation
          ? 'songbird'
          : 'flat',
    };
  }

  getBoidMotionConfig(species: BoidSpecies, _flags: StyleFlags, _boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const tailSwayPivot = ARCADE_SPECIES_CONFIG[species].tailSwayPivotY ?? 0;

    return {
      flapFrequency: ARCADE_FLAP_FREQUENCY,
      flapIdleAmplitude: ARCADE_FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: ARCADE_FLAP_SPEED_AMPLITUDE,
      getScale: (creature) => (creature as Boid).scale,
      tailSwayAxis: new THREE.Vector3(1, 0, 0), // Right axis
      tailSwayAmplitude: 0,
      tailSwayPivotY: tailSwayPivot,
      worldScale: 1,
      meshScaleBoost: 1,
      preferUpright: true,
    };
  }

  getParrotColorStrategy(_flags: StyleFlags, _bakedWingPalette: boolean): ColorStrategy {
    return {
      baseColor: ARCADE_PARROT_BASE,
      highlightColor: ARCADE_BOID_PANIC,
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: false, // Arcade parrots are uniform
      getSpeciesColors: undefined, // All arcade parrots use the base color
      beakColor: ARCADE_SPECIES_CONFIG[BoidSpecies.Multicolor].beakColor,
      colorMode: 'flat',
    };
  }

  getParrotGeometryProfile(_entity: Boid | Predator, _flags: StyleFlags): string {
    return 'neutral';
  }

  getParrotProfileNames(_flags: StyleFlags): string[] {
    return [];
  }

  getParrotProfileInstanceConfig(_profile: string, _flags: StyleFlags): SceneBoidInstanceConfig {
    return { geometries: this.parrotGeometries, bodyVertexColors: false };
  }

  getBoidInstanceConfig(species: BoidSpecies, _flags: StyleFlags): SceneBoidInstanceConfig {
    const config = ARCADE_SPECIES_CONFIG[species];
    if (config.useSmallGeometry) {
      return { geometries: this.sparrowGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.parrotGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
    }
    return { geometries: this.boidGeometries, bodyVertexColors: false, bodyEmissiveOverride: config.arcadeEmissive };
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
          geometries: this.predatorGeometries,
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

  dispose(): void {
    disposeCreatureGeometries(this.boidGeometries);
    disposeCreatureGeometries(this.sparrowGeometries);
    disposeCreatureGeometries(this.parrotGeometries);
    disposeCreatureGeometries(this.predatorGeometries);
  }
}
