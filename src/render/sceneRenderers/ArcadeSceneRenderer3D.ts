import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import type { Boid } from '../../sim/Boid';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FishtankEnvironment } from '../styles/fishtank/environment';
import type { NatureEnvironment } from '../styles/nature/environment';
import type {
  FishtankBounds,
  SceneCreatureMaterialDefaults,
  SceneEnvironmentToggles,
  ScenePresentationSettings,
  SceneRendererHooks,
  ColourStrategy,
  MotionConfig,
  PredatorRenderFlags,
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
      bodyRoughness: (_isDragon: boolean) => 0.5,
      wingEmissive: 0xffffff,
      wingEmissiveIntensity: 1.1,
      wingRoughness: (_isDragon: boolean) => 0.5,
      wingColor: (_isDragon: boolean, _isFishtank: boolean) => 0xffffff,
    };
  }

  getPredatorColourStrategy(kind: string, _renderFlags: PredatorRenderFlags): ColourStrategy {
    // In arcade, no dragons/sharks, just simple hawks and unicorns
    const isUnicorn = kind === 'unicorn';
    return {
      baseColor: isUnicorn ? ARCADE_UNICORN_BASE : ARCADE_PREDATOR_BASE,
      highlightColor: isUnicorn ? ARCADE_UNICORN_HUNT : ARCADE_PREDATOR_HUNT,
      getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
    };
  }

  getPredatorMotionConfig(kind: string, _renderFlags: PredatorRenderFlags): MotionConfig {
    // In arcade, no dragons/sharks, just simple hawks and unicorns
    const isUnicorn = kind === 'unicorn';
    return {
      flapFrequency: isUnicorn ? ARCADE_UNICORN_FLAP_FREQUENCY : ARCADE_FLAP_FREQUENCY,
      flapIdleAmplitude: isUnicorn ? ARCADE_UNICORN_FLAP_IDLE_AMPLITUDE : ARCADE_FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: isUnicorn ? ARCADE_UNICORN_FLAP_SPEED_AMPLITUDE : ARCADE_FLAP_SPEED_AMPLITUDE,
      keepUpright: isUnicorn,
      uprightStyle: isUnicorn ? 'unicorn' : undefined,
      bankScale: isUnicorn ? ARCADE_UNICORN_BANK_SCALE : undefined,
      tailSwayAxis: new THREE.Vector3(1, 0, 0), // MODEL_RIGHT_AXIS
      worldScale: 1,
      meshScaleBoost: 1,
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
