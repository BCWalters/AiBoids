import type { VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import type { computeFishtankRoomBounds } from '../styles/fishtank/environment';

type FishtankBounds = ReturnType<typeof computeFishtankRoomBounds>;

export interface SceneRendererHooks {
  setStyleVisibility: () => void;
  applyStyleTransition: (
    sim: Simulation,
    maxDim: number,
    fishtankBounds: FishtankBounds,
    wasFishtank: boolean,
  ) => void;
  updateEnvironment: (elapsed: number) => void;
  updateTransientEffects: (sim: Simulation, elapsed: number) => void;
  configureEnvironmentAnchors: (sim: Simulation, center: Vector3, maxDim: number) => void;
  updateFrameAnchors: (sim: Simulation) => void;
  updateCameraClamp: (sim: Simulation) => void;
}

interface SceneRendererHookCallbacks {
  nature: SceneRendererHooks;
  fishtank: SceneRendererHooks;
  arcade: SceneRendererHooks;
}

export function createSceneRendererHooks(
  callbacks: SceneRendererHookCallbacks,
): Record<VisualStyle, SceneRendererHooks> {
  return {
    nature: callbacks.nature,
    fishtank: callbacks.fishtank,
    arcade: callbacks.arcade,
  };
}
