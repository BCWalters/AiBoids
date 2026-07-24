import type * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Simulation } from '../sim/Simulation';
import type { VisualStyle } from '../sim/params';
import { ArcadeSceneRenderer3D } from './sceneRenderers/ArcadeSceneRenderer3D';
import { FishtankSceneRenderer3D } from './sceneRenderers/FishtankSceneRenderer3D';
import { NatureSceneRenderer3D } from './sceneRenderers/NatureSceneRenderer3D';
import { createSceneRendererHooks, type SceneRendererHooks } from './sceneRenderers/createSceneRendererHooks';
import type { RendererSceneAssets } from './rendererSceneAssets';

interface SceneRendererFactoryArgs {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  fishtankCenter: THREE.Vector3;
  sceneAssets: RendererSceneAssets;
  onUpdateTransientEffects: (sim: Simulation, elapsed: number) => void;
}

export function createRendererSceneRenderers(args: SceneRendererFactoryArgs): Record<VisualStyle, SceneRendererHooks> {
  const { camera, controls, fishtankCenter, sceneAssets, onUpdateTransientEffects } = args;
  return createSceneRendererHooks({
    nature: new NatureSceneRenderer3D({
      camera,
      controls,
      driftingClouds: sceneAssets.driftingClouds,
      fishtankEnv: sceneAssets.fishtankEnv,
      natureEnv: sceneAssets.natureEnv,
      updateTransientEffects: onUpdateTransientEffects,
    }),
    fishtank: new FishtankSceneRenderer3D({
      camera,
      controls,
      driftingClouds: sceneAssets.driftingClouds,
      fishtankCenter,
      fishtankEnv: sceneAssets.fishtankEnv,
      natureEnv: sceneAssets.natureEnv,
    }),
    arcade: new ArcadeSceneRenderer3D({
      camera,
      controls,
      driftingClouds: sceneAssets.driftingClouds,
      fishtankEnv: sceneAssets.fishtankEnv,
      natureEnv: sceneAssets.natureEnv,
    }),
  });
}
