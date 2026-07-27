import * as THREE from 'three';

/**
 * A minimal geometry+color merge (position and color attributes only —
 * adequate for a flat-colored, textureless MeshStandardMaterial), mirroring
 * mergePositionOnlyGeometries in birdGeometry.ts but also carrying a
 * per-source-geometry solid color into a vertex color attribute. Avoids
 * THREE's stricter BufferGeometryUtils.mergeGeometries(), which requires
 * every input to share identical attribute sets already.
 */
export function mergePositionAndColorGeometries(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const { geometry, color } of parts) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = nonIndexed.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  merged.computeVertexNormals();
  return merged;
}
