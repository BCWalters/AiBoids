import * as THREE from 'three';
import { smoothNormalsByPosition, mergePositionOnlyGeometries } from '../../../geometry/sharedGeometry';

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
/**
 * How far each fish eye is squashed along X before being placed (see
 * buildEyeDotsGeometry's `flattenX`).
 *
 * Every fishtank species used to sink a full SPHERE partway into the head, so
 * what showed was a spherical cap standing proud of the skin — a bulb, not an
 * eye. Flattening turns the same dot into a shallow lens that reads as a disc
 * lying on the surface and, because it tapers to nothing at its rim, blends
 * into the surrounding skin rather than cutting a hard circle.
 *
 * IMPORTANT: a flattened eye must be seated with its centre exactly ON the
 * body surface (latheFlankXAt), never sunk inside it. Every old placement
 * deliberately sank the centre by a fraction of the radius to tame the bulge
 * of a full sphere; keeping any of that offset with a lens this shallow buries
 * the eye completely and it renders nothing at all.
 *
 * Seating the centre on the surface leaves exactly half the lens outside, so
 * the protrusion is always radius * FISH_EYE_FLATTEN no matter how the body is
 * shaped. On a strongly curved head the disc's rim then sits marginally proud
 * of the skin, but the lens has tapered to zero thickness by then, so what
 * shows is a knife edge — the outline of a disc, which is the intent.
 */
export const FISH_EYE_FLATTEN = 0.22;

/**
 * How far a flank-following eye disc floats above the skin, as a fraction of
 * the eye's radius. Small but strictly positive: at 0 the disc would be
 * coplanar with the body everywhere and z-fight across its whole face.
 */
export const FISH_EYE_SURFACE_OFFSET = 0.06;

/**
 * Thickness of a flank-following eye disc, as a fraction of its radius. Enough
 * to give the disc a rim that catches light, not enough to read as a bulb.
 */
export const FISH_EYE_DISC_THICKNESS = 0.05;

/**
 * Solves for a lathed body's side-surface X at a given (y, z).
 *
 * A fishtank body is a lathe revolved about Y and then scaled non-uniformly,
 * so a surface point at cross-section angle θ is
 * (r·sinθ·sideSquash, y, r·cosθ·heightStretch). Inverting that for a known z
 * gives the matching x.
 *
 * Solving for x directly matters because the scaling is extreme on the
 * flatter species (the butterflyfish is 0.18 across against 1.1 tall):
 * choosing a point by cross-section angle, or by a fraction of `width`, misses
 * the surface badly. It also differs from `radius(y) * sideSquash`, which is
 * only the surface at z = 0 — the widest point of the section.
 *
 * Returns 0 where |z| reaches or exceeds the body's half-height at `y` (the
 * surface has no lateral extent there).
 */
export function latheFlankXAt({
  y,
  z,
  profile,
  sideSquash,
  heightStretch,
}: {
  y: number;
  z: number;
  profile: THREE.Vector2[];
  sideSquash: number;
  heightStretch: number;
}): number {
  const r = splineLatheRadiusAt(y, profile);
  if (r <= 0) return 0;
  const cos = z / (r * heightStretch);
  if (Math.abs(cos) >= 1) return 0;
  return r * Math.sqrt(1 - cos * cos) * sideSquash;
}

/**
 * Writes the `aScaleSuppress` attribute over a merged body so that parts which
 * are not skin (eyes) are excluded from the fish-scale shader's pattern.
 *
 * `parts` must be given in the SAME ORDER they were merged. Each part's run
 * length is its index count when indexed and its position count otherwise,
 * because mergeGeometriesWithColor de-indexes as it merges; getting that wrong
 * shifts every subsequent part's mask and is invisible until rendered, so the
 * total is checked against the merged geometry and throws on a mismatch.
 */
export function setScaleSuppressAttribute(
  merged: THREE.BufferGeometry,
  parts: { geometry: THREE.BufferGeometry; suppress: boolean }[],
): void {
  const total = merged.getAttribute('position').count;
  const mask = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    const index = part.geometry.index;
    const run = index ? index.count : part.geometry.getAttribute('position').count;
    if (part.suppress) mask.fill(1, offset, offset + run);
    offset += run;
  }
  if (offset !== total) {
    throw new Error(
      `setScaleSuppressAttribute: parts cover ${offset} vertices but the merged geometry has ${total}`,
    );
  }
  merged.setAttribute('aScaleSuppress', new THREE.BufferAttribute(mask, 1));
}

/**
 * Builds a mirrored pair of eye discs that FOLLOW the body's flank instead of
 * cutting through it.
 *
 * A flattened sphere is still a flat plate, and a flat plate laid on a curved
 * head is clipped by the very surface it sits on: the centre stands proud
 * while the rim sinks inside, so what shows is a lens or crescent, not a
 * circle. The flatter the body the less this matters (the butterflyfish reads
 * fine as a flat lens), but on a rounded fish it visibly truncates the eye.
 *
 * Here every point of the disc is placed at that point's OWN flank position
 * plus a constant `offset`, so the disc is a shell parallel to the skin. It
 * cannot be clipped anywhere, at any curvature, because it is nowhere inside
 * the body.
 *
 * Built as a closed thin plate (outer fan, inner fan, rim band) so it is
 * watertight and reads correctly regardless of material side.
 *
 * Position-only, like buildEyeDotsGeometry — callers merge it with the eye
 * colour.
 */
export function buildFlankEyeDiscsGeometry({
  y,
  z,
  radius,
  profile,
  sideSquash,
  heightStretch,
  offset,
  thickness,
  segments = 20,
}: {
  y: number;
  z: number;
  radius: number;
  profile: THREE.Vector2[];
  sideSquash: number;
  heightStretch: number;
  offset: number;
  thickness: number;
  segments?: number;
}): THREE.BufferGeometry {
  const flank = (py: number, pz: number) =>
    latheFlankXAt({ y: py, z: pz, profile, sideSquash, heightStretch });

  const build = (side: 1 | -1): THREE.BufferGeometry => {
    const positions: number[] = [];
    const outer = (px: number) => side * px;

    const centreOut = flank(y, z) + offset;
    const centreIn = centreOut - thickness;

    const rim: { y: number; z: number; out: number; in: number }[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const py = y + radius * Math.cos(a);
      const pz = z + radius * Math.sin(a);
      const f = flank(py, pz) + offset;
      rim.push({ y: py, z: pz, out: f, in: f - thickness });
    }

    const tri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ) => {
      // Winding is authored for the +X side; mirroring across X reverses
      // handedness, so the -X copy swaps two corners to keep faces outward.
      if (side === 1) positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      else positions.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    };

    for (let i = 0; i < segments; i++) {
      const p = rim[i];
      const q = rim[(i + 1) % segments];
      // Outward-facing fan.
      tri(outer(centreOut), y, z, outer(p.out), p.y, p.z, outer(q.out), q.y, q.z);
      // Inward-facing fan, wound the other way.
      tri(outer(centreIn), y, z, outer(q.in), q.y, q.z, outer(p.in), p.y, p.z);
      // Rim band closing the two.
      tri(outer(p.out), p.y, p.z, outer(p.in), p.y, p.z, outer(q.out), q.y, q.z);
      tri(outer(q.out), q.y, q.z, outer(p.in), p.y, p.z, outer(q.in), q.y, q.z);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.computeVertexNormals();
    return g;
  };

  return mergePositionOnlyGeometries([build(1), build(-1)]);
}

/**
 * Samples a lathed body's surface radius at spine position `y` from the
 * SPLINE-RESAMPLED silhouette, which is what the lathe is actually built from.
 *
 * Prefer this over latheBodyRadiusAt when seating a fin against the body.
 * latheBodyRadiusAt interpolates the authored control points linearly, but
 * every fishtank body lathes `new THREE.SplineCurve(profile).getPoints(n)`
 * instead — and the two disagree by enough to leave a visible gap or a buried
 * seam wherever the silhouette curves (the shoulder is the usual offender).
 *
 * Takes the maximum over all spans covering `y` so a profile that doubles back
 * on itself still returns the outermost surface. Returns 0 outside the
 * profile's y range (the nose and peduncle tips).
 */
export function splineLatheRadiusAt(y: number, profile: THREE.Vector2[]): number {
  const pts = new THREE.SplineCurve(profile).getPoints(64);
  let best = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y > hi) continue;
    const t = hi === lo ? 0 : (y - a.y) / (b.y - a.y);
    best = Math.max(best, a.x + (b.x - a.x) * t);
  }
  return Math.max(0, best);
}

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
