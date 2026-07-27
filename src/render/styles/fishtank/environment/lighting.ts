import * as THREE from 'three';
import type { TimeOfDayPreset } from '../../../../sim/params';
import { WATER_COLOR, WALL_COLOR, ACCENT_WALL_COLOR, CEILING_COLOR } from './shared';

export interface TankLightingPreset {
  ambient: number;
  hemi: number;
  key: number;
  keyColor: number;
  fogColor: number;
  waterColor: number;
  wallColor: number;
  accentWallColor: number;
  ceilingColor: number;
  causticsBaseOpacity: number;
  particleOpacity: number;
}

export const TANK_LIGHTING_PRESETS: Record<TimeOfDayPreset, TankLightingPreset> = {
  dawn: {
    ambient: 0.34,
    hemi: 0.4,
    key: 0.62,
    keyColor: 0xffd7bb,
    fogColor: 0x245b7f,
    waterColor: 0x145b84,
    wallColor: 0xe7dfd2,
    accentWallColor: 0x809373,
    ceilingColor: 0xf3ede0,
    causticsBaseOpacity: 0.15,
    particleOpacity: 0.27,
  },
  noon: {
    ambient: 0.4,
    hemi: 0.46,
    key: 0.78,
    keyColor: 0xfff6e8,
    fogColor: WATER_COLOR,
    waterColor: WATER_COLOR,
    wallColor: WALL_COLOR,
    accentWallColor: ACCENT_WALL_COLOR,
    ceilingColor: CEILING_COLOR,
    causticsBaseOpacity: 0.17,
    particleOpacity: 0.3,
  },
  sunset: {
    ambient: 0.33,
    hemi: 0.39,
    key: 0.6,
    keyColor: 0xffc89f,
    fogColor: 0x2d5a73,
    waterColor: 0x11567a,
    wallColor: 0xe2d7c9,
    accentWallColor: 0x7a876b,
    ceilingColor: 0xeee6d8,
    causticsBaseOpacity: 0.14,
    particleOpacity: 0.26,
  },
  night: {
    ambient: 0.24,
    hemi: 0.28,
    key: 0.35,
    keyColor: 0x97b7ff,
    fogColor: 0x0c2334,
    waterColor: 0x0a3858,
    wallColor: 0xc8c2b8,
    accentWallColor: 0x647364,
    ceilingColor: 0xd8d3c8,
    causticsBaseOpacity: 0.09,
    particleOpacity: 0.2,
  },
};

export interface LightingResult {
  ambientLight: THREE.AmbientLight;
  hemisphereLight: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  bounceLights: THREE.PointLight[];
  fog: THREE.Fog;
}

/** Creates the abstract lighting rig (no lamps — those are room decor). */
export function createLighting(): LightingResult {
  const ambientLight = new THREE.AmbientLight(0xd8ecff, 0.38);
  const hemisphereLight = new THREE.HemisphereLight(0xcfeeff, 0x675042, 0.42);
  const bounceLights = Array.from({ length: 4 }, (_, i) => {
    const light = new THREE.PointLight(i % 2 === 0 ? 0xe3f4ff : 0xfff0df, 0.14, 0, 2);
    light.visible = false;
    return light;
  });
  const keyLight = new THREE.DirectionalLight(0xfff6e8, 0.7);
  // Soft light from above, like an overhead room/tank hood lamp rather
  // than nature's low sun angle.
  keyLight.position.set(0.4, 1, 0.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1536, 1536);
  keyLight.shadow.radius = 3;
  ambientLight.visible = false;
  hemisphereLight.visible = false;
  keyLight.visible = false;

  // Fog is scoped tightly to roughly the tank's own scale (see
  // placeFishtankEnvironment) rather than nature's whole-world haze, so it
  // reads as "water murkiness" for fish near the far glass wall when
  // viewed from up close/inside the tank without ever visibly touching
  // the rest of the room.
  const fog = new THREE.Fog(WATER_COLOR, 10, 4000);

  return { ambientLight, hemisphereLight, keyLight, bounceLights, fog };
}

/**
 * Positions the hemisphere/bounce lights relative to the room and sets
 * fog depth extents.  Call once per `placeFishtankEnvironment` invocation.
 */
export function placeLighting(
  hemisphereLight: THREE.HemisphereLight,
  bounceLights: THREE.PointLight[],
  fog: THREE.Fog,
  center: THREE.Vector3,
  roomFloorY: number,
  roomHeight: number,
  lampRadius: number,
  wallMargin: number,
): void {
  hemisphereLight.position.set(center.x, roomFloorY + roomHeight, center.z);
  bounceLights.forEach((light, i) => {
    const angle = (i / bounceLights.length) * Math.PI * 2;
    light.position.set(
      center.x + Math.cos(angle) * lampRadius * 0.72,
      roomFloorY + roomHeight * 0.7,
      center.z + Math.sin(angle) * lampRadius * 0.72,
    );
    light.distance = roomHeight * 2.4;
    light.decay = 2;
  });

  // Fog is meant to read as mild water murkiness for fish approaching the
  // far glass wall when viewed from up close/inside the tank — but
  // THREE.Fog measures distance from the *camera*, not from the tank.
  // The camera is always somewhere inside the room (maxDistance is
  // clamped below wallMargin — see Renderer3D), so the farthest any
  // room surface (e.g. the wall behind the camera, seen reflected
  // across the room) can be is roughly 2 * wallMargin away. fog.near
  // must clear that worst case entirely, or walls/decor read as
  // washed out in a flat blue haze instead of being clearly visible —
  // exactly the "can't see the walls" bug this previously caused when
  // near/far were set relative to the tank's own (much smaller) size
  // rather than the room's.
  fog.near = wallMargin * 2.5;
  fog.far = wallMargin * 6;
}
