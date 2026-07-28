import * as THREE from 'three';
import { smoothNormalsByPosition } from '../../../geometry/sharedGeometry';

/**
 * Fish-part geometry shared across the fishtank-scene creatures — the
 * small fish, butterflyfish, shark, and seahorse. These helpers encode
 * fish-specific silhouette needs (flank-to-flank fin thickening, lathed
 * body-radius introspection for flush fin roots, and vertical stripe
 * banding) that only fishtank creatures use, so they live in the fishtank
 * scene rather than in the cross-scene geometry/sharedGeometry.ts module.
 */

/**
 * Fin membranes in the fishtank scene should be as thin as possible without
 * collapsing into a zero-thickness card that flickers, loses normals, or
 * vanishes edge-on. Every fin extrusion in this folder takes its depth from
 * this shared helper so the scene cannot drift back to a mix of species-local
 * magic fractions.
 *
 * There is deliberately no absolute lower clamp here. One was tried at 0.004,
 * but the thinnest fin in the scene (the goldfish pectoral) measures 0.0139
 * world units -- 3.5x above it -- so the clamp could never engage, and
 * removing it changed no test. A floor that cannot bind only implies a safety
 * net that isn't there. The real guard is the per-species lower bound in
 * finThickness.test.ts, which is measured against shipped geometry.
 */
export const FISHTANK_FIN_THICKNESS_RATIO = 0.012;

export function fishtankFinThickness(referenceSize: number): number {
  return referenceSize * FISHTANK_FIN_THICKNESS_RATIO;
}

export type FinThinAxis = 'x' | 'z';

export interface FinThicknessSample {
  label: string;
  geometry: THREE.BufferGeometry;
  referenceSize: number;
  thinAxis: FinThinAxis;
}

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
  // smoothNormalsByPosition averages face normals across coincident vertices so
  // fins read as smoothly curved rather than flat-faceted. computeVertexNormals()
  // on non-indexed geometry produces per-face normals (flat shading at any
  // tessellation) — trap #4 from the geometry authoring guide.
  smoothNormalsByPosition(geometry);
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


/**
 * Subdivides a lathe profile (array of Vector2 control points, authored
 * tail-to-nose) by linearly inserting `perEdge` extra samples along every
 * edge. Y-based color baking (countershading, bands, region markings) can
 * only place a color boundary where the lathe actually has a ring of
 * vertices; a hand-authored profile has just a handful of rings, so a band
 * edge would smear across a whole tall triangle. Subdividing first gives
 * those bakers enough Y resolution to render a reasonably crisp boundary
 * while keeping the low-poly silhouette (the extra points sit exactly on
 * the original straight profile edges, so the outline is unchanged).
 */
export function subdivideProfile(profile: THREE.Vector2[], perEdge: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    for (let s = 0; s < perEdge; s++) {
      const t = s / perEdge;
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  out.push(profile[profile.length - 1].clone());
  return out;
}


/** Converts to non-indexed (so adjacent triangles that straddle a color
 * boundary don't share — and thus smear — a single vertex color) and
 * returns the geometry plus a fresh color buffer ready to fill. Shared
 * scaffolding for the per-species fish color bakers below. */
function beginVertexColorBake(geometry: THREE.BufferGeometry): {
  geo: THREE.BufferGeometry;
  pos: THREE.BufferAttribute;
  colors: Float32Array;
} {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  if (geo !== geometry) geometry.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  return { geo, pos, colors: new Float32Array(pos.count * 3) };
}

function finishVertexColorBake(geo: THREE.BufferGeometry, colors: Float32Array): THREE.BufferGeometry {
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}


/**
 * Bakes a uniform per-vertex 'color' onto a (position-only) geometry —
 * used for the fins, so a white-passthrough color path (see the small-bird
 * color applicator) shows the fin's real hue unchanged rather than tinting
 * it with the per-instance body color.
 */
export function bakeUniformColor(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}


/**
 * Normalised "how far around the body toward the back is this vertex", in
 * [0,1]: 0 = facing straight down (belly), 0.5 = facing sideways (flank),
 * 1 = facing straight up (back).
 *
 * Derived from the **surface normal's** Z, not the vertex's Z position.
 * That distinction is the whole point. These bodies are lathes whose radius
 * shrinks to nearly zero at the snout and at the caudal peduncle, so
 * normalising `position.z` by the body's overall Z span — its depth at the
 * *deepest* point — collapses every vertex at either end toward the middle
 * of the range regardless of which way it actually faces. Dorsoventral
 * patterns then wash out to a flat back/belly average exactly at the nose
 * and the tail join. Measured on a goldfish before this change, the dorsal
 * ridge ran #ff6a00 at mid-body but #ff8929 at the peduncle and #ff8323 at
 * the snout — a pale smear at both ends of an otherwise solid back.
 *
 * The normal is radius-independent: a vertex on top of the body faces up
 * whether the body is 3 units deep there or 0.1. Same defect and same fix
 * as #227 on bird bodies.
 *
 * Falls back to position-based normalisation only if the geometry carries
 * no normals at all.
 *
 * Note for callers: any non-uniform scale must be applied *before* baking.
 * `BufferGeometry.scale()` does transform the normal attribute correctly,
 * but baking first and scaling after would leave these colours keyed to the
 * pre-scale surface orientation.
 */
function dorsalFraction(geo: THREE.BufferGeometry, index: number): number {
  const normal = geo.attributes.normal;
  if (normal) return THREE.MathUtils.clamp((normal.getZ(index) + 1) / 2, 0, 1);
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minZ = geo.boundingBox!.min.z;
  const span = Math.max(1e-6, geo.boundingBox!.max.z - minZ);
  return THREE.MathUtils.clamp((pos.getZ(index) - minZ) / span, 0, 1);
}


/**
 * Bakes dorsoventral countershading — the near-universal real-fish cue of a
 * darker back fading to a paler belly — into a lathed body: vertices whose
 * surface faces up (the back) take `backColor`, those facing down (the
 * belly) take `bellyColor`, lerped by `dorsalFraction`.
 */
export function bakeCountershadeColors(
  geometry: THREE.BufferGeometry,
  backColor: THREE.Color,
  bellyColor: THREE.Color,
): THREE.BufferGeometry {
  const { geo, pos, colors } = beginVertexColorBake(geometry);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    tmp.copy(bellyColor).lerp(backColor, dorsalFraction(geo, i));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  return finishVertexColorBake(geo, colors);
}


/**
 * Bakes a clownfish-style banded pattern along the body length (local Y,
 * tail at -halfLen to nose at +halfLen): the body takes `bodyColor` except
 * inside each band's normalized [from,to] length fraction, which takes
 * `bandColor`, with a thin `edge` fraction on either side taking
 * `edgeColor` (the dark outline real anemonefish bands carry).
 */
export function bakeLengthBandColors(
  geometry: THREE.BufferGeometry,
  halfLen: number,
  bodyColor: THREE.Color,
  bandColor: THREE.Color,
  edgeColor: THREE.Color,
  bands: Array<{ from: number; to: number }>,
  edge: number,
): THREE.BufferGeometry {
  const { geo, pos, colors } = beginVertexColorBake(geometry);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + halfLen) / (2 * halfLen), 0, 1);
    let color = bodyColor;
    for (const band of bands) {
      if (t >= band.from && t <= band.to) {
        color = bandColor;
        break;
      }
      if ((t >= band.from - edge && t < band.from) || (t > band.to && t <= band.to + edge)) {
        color = edgeColor;
      }
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return finishVertexColorBake(geo, colors);
}


/**
 * Bakes the blue-tang "palette" look: a royal-blue body carrying a black
 * marking across its upper flank (high local Z) over the mid-to-rear
 * length, while the face and belly stay blue — the surgeonfish/"Dory" cue.
 */
export function bakeUpperFlankMarkColors(
  geometry: THREE.BufferGeometry,
  bodyColor: THREE.Color,
  markColor: THREE.Color,
  halfLen: number,
  options: { zFrom: number; lengthFrom: number; lengthTo: number },
): THREE.BufferGeometry {
  const { geo, pos, colors } = beginVertexColorBake(geometry);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + halfLen) / (2 * halfLen), 0, 1);
    const zN = dorsalFraction(geo, i);
    const inMark = zN >= options.zFrom && t >= options.lengthFrom && t <= options.lengthTo;
    const color = inMark ? markColor : bodyColor;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return finishVertexColorBake(geo, colors);
}
