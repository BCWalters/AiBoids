import * as THREE from 'three';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import { createBloodEffects, type BloodEffects } from './bloodEffects';
import { createFishtankEnvironment, type FishtankEnvironment } from './styles/fishtank/environment';
import { createDriftingClouds, type DriftingClouds } from './styles/nature/clouds';
import { createNatureEnvironment, type NatureEnvironment } from './styles/nature/environment';
import { createFireBreathEffects, type FireBreathEffects } from './styles/nature/fireBreath';
import { createUFOVisual, type UFOVisual } from './ufoEffects';

/**
 * Cross-scene renderer assets: the shared environments and the globally-updated
 * visual effects (blood/fire/UFO). Per-scene creature geometry is NOT built or
 * owned here — each scene renderer constructs and disposes its own geometry from
 * its own sizing/palette constants. This hub only holds things that are either
 * genuinely shared or whose visibility is toggled per-scene.
 */
export interface RendererSceneAssets {
  natureEnv: NatureEnvironment;
  fishtankEnv: FishtankEnvironment;
  driftingClouds: DriftingClouds;
  bloodEffects: BloodEffects;
  fireBreathEffects: FireBreathEffects;
  ufoVisuals: UFOVisual[];
}

export function createRendererSceneAssets(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): RendererSceneAssets {
  const natureEnv = createNatureEnvironment(scene, renderer);
  const fishtankEnv = createFishtankEnvironment(scene);
  const driftingClouds = createDriftingClouds(scene);
  const bloodEffects = createBloodEffects(scene);
  const fireBreathEffects = createFireBreathEffects(scene);
  const ufoVisuals = Array.from({ length: MAX_CONCURRENT_UFOS }, () => createUFOVisual(scene));

  return {
    natureEnv,
    fishtankEnv,
    driftingClouds,
    bloodEffects,
    fireBreathEffects,
    ufoVisuals,
  };
}

export function disposeRendererSceneAssets(assets: RendererSceneAssets): void {
  assets.bloodEffects.dispose();
  assets.fireBreathEffects.dispose();
  assets.ufoVisuals.forEach((visual) => visual.dispose());
}
