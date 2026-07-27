import * as THREE from 'three';
import type { VisualStyle } from '../sim/params';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import { createBloodEffects, type BloodEffects } from './bloodEffects';
import { createFishtankEnvironment, type FishtankEnvironment } from './styles/fishtank/environment';
import { createDriftingClouds, type DriftingClouds } from './styles/nature/clouds';
import { createNatureEnvironment, type NatureEnvironment } from './styles/nature/environment';
import { createFireBreathEffects, type FireBreathEffects } from './styles/nature/fireBreath';
import { createUFOVisual, type UFOVisual } from './ufoEffects';

/**
 * Lazy owner for the two heavy per-scene environments (nature + fishtank).
 * At most one is instantiated at a time; the other is disposed (GPU memory
 * freed, meshes removed from the scene graph) whenever the active style
 * changes.
 *
 * Arcade has neither environment; entering arcade disposes whichever was
 * previously active.
 *
 * The factory functions are injectable for testing (defaults call the real
 * createNatureEnvironment / createFishtankEnvironment).
 */
export class LazyEnvProvider {
  private readonly _scene: THREE.Scene;
  private readonly _renderer: THREE.WebGLRenderer;
  private readonly _makeNatureEnv: (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => NatureEnvironment;
  private readonly _makeFishtankEnv: (scene: THREE.Scene) => FishtankEnvironment;

  private _natureEnv: NatureEnvironment | null = null;
  private _fishtankEnv: FishtankEnvironment | null = null;
  private _activeStyle: VisualStyle | null = null;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    makeNatureEnv: (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => NatureEnvironment = createNatureEnvironment,
    makeFishtankEnv: (scene: THREE.Scene) => FishtankEnvironment = createFishtankEnvironment,
  ) {
    this._scene = scene;
    this._renderer = renderer;
    this._makeNatureEnv = makeNatureEnv;
    this._makeFishtankEnv = makeFishtankEnv;
  }

  getNatureEnv(): NatureEnvironment | null {
    return this._natureEnv;
  }

  getFishtankEnv(): FishtankEnvironment | null {
    return this._fishtankEnv;
  }

  /**
   * Switch to the given visual style.
   * - Disposes the env that is no longer needed (removes meshes from the
   *   scene graph and frees GPU resources).
   * - Creates the env for the new style on demand (adds meshes to the scene
   *   graph immediately so they are visible on the next rendered frame).
   * - Idempotent: calling with the already-active style is a no-op, so
   *   rapid-toggle and re-entrancy are safe.
   */
  switchToStyle(style: VisualStyle): void {
    if (this._activeStyle === style) return;

    // Dispose the env that is no longer needed
    if (this._natureEnv !== null && style !== 'nature') {
      this._natureEnv.dispose();
      this._natureEnv = null;
    }
    if (this._fishtankEnv !== null && style !== 'fishtank') {
      this._fishtankEnv.dispose();
      this._fishtankEnv = null;
    }

    // Create the env for the new style (arcade has neither).  The env
    // factories build every mesh with visible=false, so the newly-created
    // env must be explicitly revealed here — this is the single source of
    // truth for making the active environment (and, for nature, its fog)
    // visible.  Scene renderers no longer toggle env visibility themselves.
    if (style === 'nature' && this._natureEnv === null) {
      this._natureEnv = this._makeNatureEnv(this._scene, this._renderer);
      this._natureEnv.setVisible(true);
    } else if (style === 'fishtank' && this._fishtankEnv === null) {
      this._fishtankEnv = this._makeFishtankEnv(this._scene);
      this._fishtankEnv.setVisible(true);
    }

    this._activeStyle = style;
  }

  /** Disposes whichever environment is currently active and clears state. */
  dispose(): void {
    this._natureEnv?.dispose();
    this._fishtankEnv?.dispose();
    this._natureEnv = null;
    this._fishtankEnv = null;
    this._activeStyle = null;
  }
}

/**
 * Cross-scene renderer assets: the lazy env provider plus globally-updated
 * visual effects (blood/fire/UFO). Per-scene creature geometry is NOT built or
 * owned here — each scene renderer constructs and disposes its own geometry from
 * its own sizing/palette constants.
 */
export interface RendererSceneAssets {
  /** Lazy owner for nature and fishtank environments; arcade has neither. */
  envProvider: LazyEnvProvider;
  driftingClouds: DriftingClouds;
  bloodEffects: BloodEffects;
  fireBreathEffects: FireBreathEffects;
  ufoVisuals: UFOVisual[];
}

export function createRendererSceneAssets(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): RendererSceneAssets {
  const envProvider = new LazyEnvProvider(scene, renderer);
  const driftingClouds = createDriftingClouds(scene);
  const bloodEffects = createBloodEffects(scene);
  const fireBreathEffects = createFireBreathEffects(scene);
  const ufoVisuals = Array.from({ length: MAX_CONCURRENT_UFOS }, () => createUFOVisual(scene));

  return {
    envProvider,
    driftingClouds,
    bloodEffects,
    fireBreathEffects,
    ufoVisuals,
  };
}

export function disposeRendererSceneAssets(assets: RendererSceneAssets): void {
  assets.envProvider.dispose();
  assets.bloodEffects.dispose();
  assets.fireBreathEffects.dispose();
  assets.ufoVisuals.forEach((visual) => visual.dispose());
}
