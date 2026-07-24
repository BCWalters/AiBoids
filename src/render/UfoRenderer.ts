import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';
import { UFO_BEAM_REACH } from '../sim/UFO';
import type { SceneRendererHooks } from './sceneRenderers/createSceneRendererHooks';
import type { UFOVisual } from './ufoEffects';

/**
 * Owns the per-frame UFO visual update. Each UFOVisual slot maps 1:1 by
 * index to an active sim.ufos entry; slots beyond the current active count
 * are simply hidden. The UFO's rendered position and beam length are scaled
 * into the active scene's render space via the scene renderer's world scale,
 * so the same sim-space UFO reads correctly whether the scene renders 1:1
 * (nature/arcade) or inflated (fishtank).
 */
export class UfoRenderer {
  private readonly ufoVisuals: readonly UFOVisual[];
  private readonly tmpVec3 = new THREE.Vector3();

  constructor(ufoVisuals: readonly UFOVisual[]) {
    this.ufoVisuals = ufoVisuals;
  }

  update(sim: Simulation, dt: number, sceneRenderer: SceneRendererHooks): void {
    const ufoWorldScale = sceneRenderer.getWorldScale();
    const ufoBeamLength = UFO_BEAM_REACH * ufoWorldScale;
    for (let i = 0; i < this.ufoVisuals.length; i++) {
      const visual = this.ufoVisuals[i];
      this.applyVisualState(visual, sim.ufos[i], sceneRenderer, ufoWorldScale, ufoBeamLength);
      visual.update(dt);
    }
  }

  private applyVisualState(
    visual: UFOVisual,
    ufo: Simulation['ufos'][number] | undefined,
    sceneRenderer: SceneRendererHooks,
    ufoWorldScale: number,
    ufoBeamLength: number,
  ): void {
    if (ufo) {
      sceneRenderer.mapPositionToRenderSpace(ufo.position.x, ufo.position.y, ufo.position.z, this.tmpVec3);
      visual.setState(true, this.tmpVec3, ufo.beamStrength, ufoBeamLength, ufoWorldScale);
      return;
    }
    visual.setState(false, this.tmpVec3, 0, 0);
  }
}
