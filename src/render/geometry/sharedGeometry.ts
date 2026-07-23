import * as THREE from 'three';

/**
 * Truly generic, cross-domain geometry primitives shared by BOTH the
 * nature-scene creatures (birds, dragons, unicorns) AND the fishtank-scene
 * creatures (fish, sharks, seahorses). Only helpers that are genuinely
 * used across both scenes live here; scene-specific helpers live in a
 * shared file within that scene instead:
 *   - bird-only shared helpers → styles/nature/geometry/birdSharedGeometry.ts
 *   - fish-only shared helpers → styles/fishtank/geometry/fishSharedGeometry.ts
 * Keeping this split clean lets multiple agents/contributors work on
 * separate creatures/scenes without colliding in one giant module.
 */
export interface CreatureGeometries {
  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /** Dragon-only: a pair of clawed legs tucked under the belly, rendered
   * with the same static per-instance transform as the body (no flap). */
  legs?: THREE.BufferGeometry;
  /** Small-bird-only: the beak as its own InstancedMesh part (rather than
   * merged/vertex-baked into the body) — see birdGeometry.ts's doc
   * comment on why a shared multi-species geometry needs this instead of
   * the parrot/hawk approach of baking a fixed beak color into the body's
   * vertex colors. Rendered with the same static per-instance transform
   * as the body (no flap). */
  beak?: THREE.BufferGeometry;
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
 * Thickens a flat polygon — given as an ordered boundary ring of points
 * lying roughly in the X/Y plane (a triangle works fine as a 3-point
 * ring, a fan/quad as a 4-point ring, etc.) — into a real 3D prism:
 * duplicates the ring offset by +/-halfThickness along Z (this
 * codebase's model-local "up" axis) for top/bottom caps, and adds side
 * walls connecting corresponding ring edges. Without this, shapes like a
 * tail fan or a feather streamer are paper-thin (zero Z-extent) and
 * disappear entirely when viewed edge-on from the side — exactly the
 * "tail vanishes" bug this helper exists to fix. Winding/normals for
 * every triangle (both caps and every side wall) are resolved via an
 * outward-vs-centroid dot-product test, the same robust trick used by
 * unicornGeometry.ts's pushBoxSegment, so it works regardless of the
 * input ring's own winding order.
 */
export function extrudeRingGeometry(ring: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = ring.length;
  const half = thickness / 2;
  const top = ring.map((p) => new THREE.Vector3(p.x, p.y, p.z + half));
  const bottom = ring.map((p) => new THREE.Vector3(p.x, p.y, p.z - half));

  const centroid = new THREE.Vector3();
  ring.forEach((p) => centroid.add(p));
  centroid.divideScalar(n);

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(e1, e2);
    const triCentroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(triCentroid, centroid);
    if (normal.dot(outward) < 0) pushTri(p0, p2, p1);
    else pushTri(p0, p1, p2);
  };

  for (let i = 1; i < n - 1; i++) {
    pushOutward(top[0], top[i], top[i + 1]);
    pushOutward(bottom[0], bottom[i], bottom[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushOutward(top[i], bottom[i], bottom[j]);
    pushOutward(top[i], bottom[j], top[j]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * A small paired-dot eye (two tiny spheres mirrored across the X axis) —
 * same technique as unicornGeometry.ts's buildUnicornEyesGeometry, shared
 * here so small-bird/hawk geometry can use it too. Baked as a near-black
 * vertex color so it reads correctly regardless of whatever per-instance
 * body tint a given species/individual gets (near-black stays near-black
 * under any multiply).
 */
export function buildEyeDotsGeometry(x: number, y: number, z: number, radius: number): THREE.BufferGeometry {
  const left = new THREE.SphereGeometry(radius, 8, 6);
  left.translate(x, y, z);
  const right = new THREE.SphereGeometry(radius, 8, 6);
  right.translate(-x, y, z);
  return mergePositionOnlyGeometries([left, right]);
}

