import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { DriftingClouds } from '../styles/nature/clouds';
import { placeNatureEnvironment, type NatureEnvironment } from '../styles/nature/environment';
import type {
  FishtankBounds,
  SceneCreatureMaterialDefaults,
  SceneEnvironmentToggles,
  ScenePresentationSettings,
  SceneRendererHooks,
} from './createSceneRendererHooks';

interface NatureSceneRendererDependencies {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  driftingClouds: DriftingClouds;
  fishtankEnv: { setVisible: (visible: boolean) => void };
  natureEnv: NatureEnvironment;
  updateTransientEffects: (sim: Simulation, elapsed: number) => void;
}

export class NatureSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: NatureSceneRendererDependencies;

  constructor(deps: NatureSceneRendererDependencies) {
    this.deps = deps;
  }

  setStyleVisibility(): void {
    this.deps.natureEnv.setVisible(true);
    this.deps.fishtankEnv.setVisible(false);
    this.deps.driftingClouds.setVisible(true);
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
    this.deps.controls.maxDistance = maxDim * 5.5;
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

  updateEnvironment(elapsed: number): void {
    this.deps.natureEnv.update(elapsed);
  }

  updateTransientEffects(sim: Simulation, elapsed: number): void {
    this.deps.updateTransientEffects(sim, elapsed);
  }

  configureEnvironmentAnchors(_sim: Simulation, center: THREE.Vector3, maxDim: number): void {
    placeNatureEnvironment(this.deps.natureEnv, center, maxDim * 30);
    this.deps.driftingClouds.configure(center, maxDim);
  }

  updateFrameAnchors(_sim: Simulation): void {}

  updateCameraClamp(_sim: Simulation): void {}

  applyEnvironmentToggles(toggles: SceneEnvironmentToggles): void {
    this.deps.natureEnv.setFogEnabled(toggles.fogEnabled);
    this.deps.natureEnv.setTimeOfDay(toggles.timeOfDay);
    this.deps.natureEnv.setLightShaftsEnabled(toggles.lightShaftsEnabled);
  }

  setShadowsEnabled(enabled: boolean): void {
    this.deps.natureEnv.sunLight.castShadow = enabled;
  }

  setGalleryCreatureActive(_active: boolean): void {}

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
    return 1;
  }

  mapPositionToRenderSpace(x: number, y: number, z: number, target: THREE.Vector3): void {
    target.set(x, y, z);
  }

  getCreatureMaterialDefaults(): SceneCreatureMaterialDefaults {
    return {
      bodyEmissive: 0x000000,
      bodyEmissiveIntensity: 0,
      bodyRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingEmissive: 0x000000,
      wingEmissiveIntensity: 0,
      wingRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingColor: (_isDragon: boolean, _isFishtank: boolean) => 0xffffff,
    };
  }

  dispose(): void {
    this.deps.natureEnv.dispose();
    this.deps.driftingClouds.dispose();
  }
}
