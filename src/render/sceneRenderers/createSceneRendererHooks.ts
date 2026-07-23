import type { TimeOfDayPreset, VisualStyle } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Vector3 } from 'three';
import type { computeFishtankRoomBounds } from '../styles/fishtank/environment';

export type FishtankBounds = ReturnType<typeof computeFishtankRoomBounds>;

export interface SceneEnvironmentToggles {
  fogEnabled: boolean;
  timeOfDay: TimeOfDayPreset;
  lightShaftsEnabled: boolean;
  waterEffectsEnabled: boolean;
}

export interface ScenePresentationSettings {
  bloomEnabled: boolean;
  afterimageEnabled: boolean;
  boundsHelperVisible: boolean;
  ambientLightIntensity: number;
  keyLightVisible: boolean;
}

export interface SceneCreatureMaterialDefaults {
  bodyEmissive: number;
  bodyEmissiveIntensity: number;
  bodyRoughness: (isDragon: boolean) => number;
  wingEmissive: number;
  wingEmissiveIntensity: number;
  wingRoughness: (isDragon: boolean) => number;
  wingColor: (isDragon: boolean, isFishtank: boolean) => number;
}

export interface SceneRendererHooks {
  setStyleVisibility: () => void;
  configureInitialFraming: (
    sim: Simulation,
    maxDim: number,
    fishtankBounds: FishtankBounds,
  ) => void;
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
  applyEnvironmentToggles: (toggles: SceneEnvironmentToggles) => void;
  setShadowsEnabled: (enabled: boolean) => void;
  setGalleryCreatureActive: (active: boolean) => void;
  getPresentationSettings: () => ScenePresentationSettings;
  getWorldScale: () => number;
  mapPositionToRenderSpace: (x: number, y: number, z: number, target: Vector3) => void;
  getCreatureMaterialDefaults: () => SceneCreatureMaterialDefaults;
  dispose: () => void;
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
