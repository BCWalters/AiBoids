import type * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
}

export function createRendererSceneRenderers(args: SceneRendererFactoryArgs): Record<VisualStyle, SceneRendererHooks> {
  const { camera, controls, fishtankCenter, sceneAssets } = args;
  return createSceneRendererHooks({
    nature: new NatureSceneRenderer3D({
      camera,
      controls,
      driftingClouds: sceneAssets.driftingClouds,
      fishtankEnv: sceneAssets.fishtankEnv,
      natureEnv: sceneAssets.natureEnv,
      fireBreathEffects: sceneAssets.fireBreathEffects,
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
