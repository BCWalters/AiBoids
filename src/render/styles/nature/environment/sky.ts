import * as THREE from 'three';
import type { TimeOfDayPreset } from '../../../../sim/params';

export interface TimeOfDaySettings {
  elevationDeg: number;
  azimuthDeg: number;
  skyTurbidity: number;
  skyRayleigh: number;
  skyMie: number;
  sunColor: number;
  sunIntensity: number;
  sunSpriteScale: number;
  sunHaloScale: number;
  fogColor: number;
  lakeColor: number;
  lakeOpacity: number;
}

export const TIME_OF_DAY_SETTINGS: Record<TimeOfDayPreset, TimeOfDaySettings> = {
  dawn: {
    elevationDeg: 14,
    azimuthDeg: 112,
    skyTurbidity: 4.5,
    skyRayleigh: 1.9,
    skyMie: 0.008,
    sunColor: 0xffd1a8,
    sunIntensity: 1.1,
    sunSpriteScale: 5600,
    sunHaloScale: 7600,
    fogColor: 0xffdfc6,
    lakeColor: 0x336f92,
    lakeOpacity: 0.86,
  },
  noon: {
    elevationDeg: 52,
    azimuthDeg: 148,
    skyTurbidity: 2.4,
    skyRayleigh: 1.1,
    skyMie: 0.006,
    sunColor: 0xfff4df,
    sunIntensity: 1.8,
    sunSpriteScale: 4800,
    sunHaloScale: 6200,
    fogColor: 0xf2f5f4,
    lakeColor: 0x2f698b,
    lakeOpacity: 0.9,
  },
  sunset: {
    elevationDeg: 12,
    azimuthDeg: 240,
    skyTurbidity: 5.2,
    skyRayleigh: 2.2,
    skyMie: 0.009,
    sunColor: 0xffaf7c,
    sunIntensity: 1.2,
    sunSpriteScale: 5800,
    sunHaloScale: 8000,
    fogColor: 0xffceb2,
    lakeColor: 0x2f6484,
    lakeOpacity: 0.82,
  },
  night: {
    elevationDeg: -8,
    azimuthDeg: 210,
    skyTurbidity: 1.8,
    skyRayleigh: 0.45,
    skyMie: 0.004,
    sunColor: 0xa9b8ff,
    sunIntensity: 0.18,
    sunSpriteScale: 3400,
    sunHaloScale: 4600,
    fogColor: 0x1c2537,
    lakeColor: 0x21465d,
    lakeOpacity: 0.78,
  },
};

/** A bright, warm sun disc with a soft feathered edge, standing in for the sky shader's near-invisible physical sun disc. */
export function createSunMaterial(): THREE.SpriteMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Normal (alpha) blending, not additive: additive light gets washed out
  // against an already-bright sky, especially near the pale horizon.
  // A solid, opaque-cored disc that just alpha-fades at the edge reads as
  // a clearly visible sun regardless of what's behind it. Stops are more
  // closely spaced than a simple 3-stop gradient to avoid a visible
  // banding "ring" where alpha changes too abruptly. Brighter/more opaque
  // throughout than the original pass (higher alpha at every stop past
  // the core, lighter colors) — the previous stops dropped alpha and
  // saturation quickly enough that the disc read as a fairly dim, dull
  // orange smudge rather than a bright sun.
  gradient.addColorStop(0, 'rgba(255,255,250,1)');
  gradient.addColorStop(0.22, 'rgba(255,247,214,1)');
  gradient.addColorStop(0.42, 'rgba(255,230,160,1)');
  gradient.addColorStop(0.65, 'rgba(255,205,120,0.85)');
  gradient.addColorStop(0.85, 'rgba(255,185,95,0.45)');
  gradient.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // Skip tone mapping for this material — ACES + the scene's 0.65
    // exposure was crushing the sun down to a dim, dull grey blob that
    // looked like it was permanently behind a haze of cloud.
    toneMapped: false,
  });
}

/**
 * A much larger, very soft warm glow rendered just behind the sun disc —
 * gives the light source a sense of radiance/corona instead of looking
 * like a flat painted coin stuck on the sky dome. Kept fully separate
 * from the crisp disc sprite so its own gradient can be extremely broad
 * and soft without diluting the disc's crisp edge.
 */
export function createSunHaloMaterial(): THREE.SpriteMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Kept deliberately subtle and smoothly tapered — a strong or large
  // halo reads as a flat washed-out "coin" against the sky rather than a
  // glow, especially near the pale horizon. Many closely-spaced stops
  // avoid any visible ring where the falloff rate changes. Nudged up
  // slightly alongside the brighter sun disc so the two still read as
  // one consistent, brighter light source rather than a bright disc
  // sitting on a comparatively dim glow.
  gradient.addColorStop(0, 'rgba(255,230,175,0.4)');
  gradient.addColorStop(0.18, 'rgba(255,222,160,0.3)');
  gradient.addColorStop(0.4, 'rgba(255,212,145,0.18)');
  gradient.addColorStop(0.65, 'rgba(255,204,135,0.08)');
  gradient.addColorStop(1, 'rgba(255,198,125,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}
