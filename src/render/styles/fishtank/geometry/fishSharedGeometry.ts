import * as THREE from 'three';

/**
 * Fish-part geometry shared across the fishtank-scene creatures — the
 * small fish, butterflyfish, shark, and seahorse. These helpers encode
 * fish-specific silhouette needs (flank-to-flank fin thickening, lathed
 * body-radius introspection for flush fin roots, and vertical stripe
 * banding) that only fishtank creatures use, so they live in the fishtank
 * scene rather than in the cross-scene geometry/sharedGeometry.ts module.
 */

/**
 * Like extrudeRingGeometry, but thickens the ring along local X instead
 * of Z. extrudeRingGeometry assumes its ring lies roughly in the X/Y
 * (horizontal) plane and adds dorsoventral (Z) depth — right for shapes
 * like a caudal tail fin lying flat in X/Y, but wrong for a fin whose
 * ring points all sit at X=0 and vary in Y/Z instead (e.g. a dorsal fin
 * standing straight up off the spine, or a shark's heterocercal tail
 * trailing straight back off the peduncle). Extruding those along Z (as
 * extrudeRingGeometry would) only nudges their already-dominant Y/Z
 * shape very slightly larger/smaller — it adds essentially no depth
 * along the axis that actually matters (X, the flank-to-flank
 * direction), so the fin reads as a flat, near-2D card that visually
 * vanishes when viewed close to edge-on. Thickening along X instead
 * gives these fins genuine left-right depth so they keep a visible
 * silhouette from any angle, including nearly head-on.
 */
export function extrudeRingGeometryAlongX(ring: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = ring.length;
  const half = thickness / 2;
  const front = ring.map((p) => new THREE.Vector3(p.x + half, p.y, p.z));
  const back = ring.map((p) => new THREE.Vector3(p.x - half, p.y, p.z));

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
    pushOutward(front[0], front[i], front[i + 1]);
    pushOutward(back[0], back[i], back[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushOutward(front[i], back[i], back[j]);
    pushOutward(front[i], back[j], front[j]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * Linearly interpolates a lathed body's own radius at a given local Y,
 * walking a profile's (y descending, matching how these profiles are
 * conventionally authored tail-to-nose) control points. Clamps to the
 * nearest end point outside the profile's own Y range. Shared by any
 * lathed-body creature that needs to root an add-on part (a dorsal fin,
 * a ridge, a horn) flush against its own actual surface rather than a
 * rough hand-picked estimate — the latter leaves a visible gap/floating
 * seam wherever the estimate doesn't quite match the real lathed radius
 * (see sharkGeometry.ts's history for the bug this was extracted to
 * avoid repeating).
 */
export function latheBodyRadiusAt(y: number, profile: THREE.Vector2[]): number {
  if (y >= profile[profile.length - 1].y) return profile[profile.length - 1].x;
  if (y <= profile[0].y) return profile[0].x;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return profile[0].x;
}


/**
 * Bakes alternating vertical stripe colors into a per-vertex 'color'
 * attribute, banding a lathed body purely by local Y position (tail at
 * -halfLen to nose at +halfLen) into `stripeCount` equal bands that
 * alternate between colorA/colorB — the butterflyfish's most
 * recognizable feature. Works on any lathe-style body (radially
 * symmetric around Y) since every vertex around a given Y ring gets the
 * same band regardless of its angle, so the stripes read identically
 * from any side. Converts to non-indexed first (like
 * mergePositionOnlyGeometries) since a LatheGeometry's default indexing
 * shares vertices between adjacent triangles that may straddle a stripe
 * boundary — sharing one color between them would smear the boundary;
 * non-indexed gives every triangle-corner its own color sample instead.
 */
export function bakeVerticalStripeColors(
  geometry: THREE.BufferGeometry,
  halfLen: number,
  stripeCount: number,
  colorA: THREE.Color,
  colorB: THREE.Color,
): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = nonIndexed.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) + halfLen) / (2 * halfLen), 0, 1);
    const band = Math.min(stripeCount - 1, Math.floor(t * stripeCount));
    const color = band % 2 === 0 ? colorA : colorB;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (nonIndexed !== geometry) geometry.dispose();
  return nonIndexed;
}
