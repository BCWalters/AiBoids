import * as THREE from 'three';

/**
 * Shared geometry primitives used across the bird, dragon, and unicorn
 * creature geometry builders (see birdGeometry.ts, dragonGeometry.ts,
 * unicornGeometry.ts). Splitting these merge/tint helpers out into their
 * own module keeps each creature's file self-contained and lets multiple
 * agents/contributors work on separate creatures without touching a
 * single, shared 1000+ line file.
 */
export interface CreatureGeometries {
  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /** Dragon-only: a pair of clawed legs tucked under the belly, rendered
   * with the same static per-instance transform as the body (no flap). */
  legs?: THREE.BufferGeometry;
}

/**
 * A minimal geometry merge that only cares about vertex positions
 * (adequate here since these are flat-colored MeshStandardMaterials with
 * no texture maps) — avoids THREE's stricter mergeGeometries(), which
 * requires every input geometry to share identical attribute sets
 * (position/normal/uv) and indexed-vs-non-indexed status, neither of
 * which line up between a LatheGeometry and a hand-authored triangle
 * soup. Recomputes normals fresh on the combined result.
 */
export function mergePositionOnlyGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = nonIndexed.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.computeVertexNormals();
  return merged;
}


/**
 * Like mergePositionOnlyGeometries, but also bakes per-vertex 'color'
 * into a single 'color' BufferAttribute spanning the whole merged result
 * — needed because a single InstancedMesh can only have one material, so
 * spatially-varying tints (e.g. a gold horn merged onto an otherwise
 * white-vertex body, or the body's own darker-purple muzzle tint) have
 * to ride along as vertex colors instead (same trick as the wings'
 * addRainbowVertexColors). If an input geometry already carries its own
 * 'color' attribute (e.g. the body, which bakes a varying muzzle tint
 * itself — see buildHorseBodyProfileGeometry), that's used as-is;
 * otherwise every vertex from that geometry falls back to the uniform
 * `color` provided for it.
 */
export function mergeGeometriesWithColor(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const { geometry, color } of parts) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const posAttr = nonIndexed.getAttribute('position');
    const colorAttr = nonIndexed.getAttribute('color');
    for (let i = 0; i < posAttr.count; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      if (colorAttr) {
        colors.push(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i));
      } else {
        colors.push(color.r, color.g, color.b);
      }
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  merged.computeVertexNormals();
  return merged;
}


/**
 * Bakes a rainbow hue gradient (violet at the wing root, red at the tip)
 * into a per-vertex 'color' attribute, read by a vertexColors-enabled
 * material — see Renderer3D's buildInstanceSet rainbowWings handling.
 * The base geometry (position-only triangle soup) is otherwise
 * untouched, so this can wrap any of the flat-shaded wing builders above.
 */
export function addRainbowVertexColors(geometry: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(Math.abs(position.getX(i)) / span, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}


/**
 * Same idea as addRainbowVertexColors, but the gradient follows straight-
 * line distance from a given root point (e.g. where the tail meets the
 * rump) rather than |x| — needed for parts like the tail whose "root to
 * tip" axis isn't a simple left-right span.
 */
export function addRainbowVertexColorsByDistance(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  maxDistance: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(vertex.distanceTo(root) / maxDistance, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
