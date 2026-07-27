import * as THREE from 'three';

// Opacity values for the depth-murk planes, ordered front-to-back
// (most-transparent to least-transparent, i.e. index 0 is the plane
// nearest the camera's default approach angle).  These values were
// carefully tuned in BCWalters/AiBoids#123 — preserve exactly.
export const MURK_OPACITIES = [0.14, 0.10, 0.05] as const;

/** Creates 3 semi-transparent depth-murk planes inside the tank.
 *  Planes span the tank XY cross-section and are placed at −30%, 0%,
 *  and +30% offsets from the tank centre along Z (see `placeMurkPlanes`).
 *  DoubleSide so they read correctly when the camera orbits to the
 *  opposite side of the tank.  Opacity increases with depth (toward
 *  the back glass wall farthest from the camera). */
export function createMurkPlanes(): THREE.Mesh[] {
  return MURK_OPACITIES.map((opacity) => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x041832,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    plane.visible = false;
    return plane;
  });
}

/**
 * Sizes and positions the murk planes across the tank's Z axis.
 * The camera typically views the tank from the high-Z side (see
 * FishtankSceneRenderer3D's configureInitialFraming). Planes are spaced
 * at −30%, 0%, +30% of the half-depth and grow progressively more opaque
 * toward the low-Z "back" wall.  They span the full XY cross-section of
 * the water volume so they are visible from any orbit angle.
 */
export function placeMurkPlanes(
  murkPlanes: THREE.Mesh[],
  center: THREE.Vector3,
  worldWidth: number,
  worldDepth: number,
  waterHeight: number,
  inset: number,
): void {
  const halfTankD = (worldDepth - inset) / 2;
  const murkZOffsets = [-halfTankD * 0.3, 0, halfTankD * 0.3];
  murkPlanes.forEach((plane, i) => {
    plane.scale.set(worldWidth - inset, waterHeight - inset, 1);
    plane.position.set(center.x, waterHeight / 2, center.z + murkZOffsets[i]);
  });
}
