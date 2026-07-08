import * as THREE from 'three';

/**
 * "Fish tank" style environment: deliberately just an empty, all-blue
 * underwater void for now — a big inward-facing sphere of solid aquarium
 * blue (so the world reads as "surrounded by water" from any camera
 * angle) plus matching depth fog and a soft light rig, with no tank
 * floor/glass/coral/plants/bubbles yet.
 *
 * This is an independent duplicate of nature's environment.ts rather
 * than a shared/parametrized module — a future "fish tank scenery" pass
 * can freely add tank features here (following whatever structure makes
 * sense for an aquarium scene) without touching nature's ground/
 * mountains/lakes code, or risking merge conflicts with work in progress
 * there.
 */
export interface FishtankEnvironment {
  waterVolume: THREE.Mesh;
  ambientLight: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** Call once per frame while fishtank style is active (currently a no-op stub — reserved for future caustics/particle animation). */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall fishtank-style visibility. */
  setFogEnabled(enabled: boolean): void;
  dispose(): void;
}

// Deep aquarium blue — used for both the surrounding water volume and
// the fog color so the fog blends seamlessly into the "walls" of water
// rather than reading as a separate haze layer.
const WATER_COLOR = 0x0d4f7a;

export function createFishtankEnvironment(scene: THREE.Scene): FishtankEnvironment {
  // A large inward-facing sphere gives "blue all around" regardless of
  // camera orbit angle — mirrors how nature's Sky dome works, rather
  // than relying on scene.background (which Renderer3D only sets once,
  // at construction, for the arcade-style dark backdrop).
  const waterGeometry = new THREE.SphereGeometry(1, 32, 16);
  const waterMaterial = new THREE.MeshBasicMaterial({ color: WATER_COLOR, side: THREE.BackSide, fog: false });
  const waterVolume = new THREE.Mesh(waterGeometry, waterMaterial);
  waterVolume.visible = false;

  const ambientLight = new THREE.AmbientLight(0xbfe8ff, 0.6);
  const keyLight = new THREE.DirectionalLight(0xdff6ff, 0.5);
  // Soft light filtering down from the water's surface rather than a
  // strong directional sun, like nature's keyLight.
  keyLight.position.set(0, 1, 0.3);
  ambientLight.visible = false;
  keyLight.visible = false;

  const fog = new THREE.Fog(WATER_COLOR, 10, 4000); // near/far re-tuned by placeFishtankEnvironment once world size is known

  scene.add(waterVolume, ambientLight, keyLight);

  let fogEnabled = true;

  return {
    waterVolume,
    ambientLight,
    keyLight,
    fog,
    update() {
      // No animated elements yet (see doc comment above).
    },
    setVisible(visible: boolean) {
      waterVolume.visible = visible;
      ambientLight.visible = visible;
      keyLight.visible = visible;
      // Same "only actually attach if both visible and not independently
      // disabled" pattern as nature's setVisible (see environment.ts).
      scene.fog = visible && fogEnabled ? fog : null;
    },
    setFogEnabled(enabled: boolean) {
      fogEnabled = enabled;
      scene.fog = enabled && waterVolume.visible ? fog : null;
    },
    dispose() {
      scene.remove(waterVolume, ambientLight, keyLight);
      if (scene.fog === fog) scene.fog = null;
      waterVolume.geometry.dispose();
      (waterVolume.material as THREE.Material).dispose();
    },
  };
}

/**
 * Sizes/positions the fishtank environment around the world. `groundSize`
 * matches the same convention nature's placeNatureEnvironment uses
 * (maxDim * 30, i.e. flockScale = groundSize / 30) purely so both styles'
 * call sites in Renderer3D stay symmetrical — fishtank doesn't have an
 * actual ground plane to scale, just the surrounding water sphere/fog.
 */
export function placeFishtankEnvironment(env: FishtankEnvironment, center: THREE.Vector3, groundSize: number): void {
  const flockScale = groundSize / 30;

  env.waterVolume.position.copy(center);
  // Comfortably larger than the fog's far distance so its surface is
  // never visible even at max zoom-out.
  env.waterVolume.scale.setScalar(flockScale * 20);

  env.fog.near = flockScale * 2;
  env.fog.far = flockScale * 10;
}
