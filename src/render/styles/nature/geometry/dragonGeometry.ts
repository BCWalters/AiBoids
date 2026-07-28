import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import { buildDiscCapGeometry, mergeGeometriesWithColor, singleLegPart, swayingTailRig } from '../../../geometry/sharedGeometry';

/**
 * "Dragon" predator geometry: a bulkier, longer-necked lathed body with a
 * bent, raised neck and a downward-tilted head (rather than a straight
 * bird-like spine), a spiky dorsal frill running from the skull down the
 * neck (in place of simple flat brow horns), broad scalloped bat/dragon-
 * membrane wings, a curved (not ruler-straight) whip tail, and a pair of
 * clawed legs tucked under the belly. Legs, tail, and frill spikes are
 * all built as true 3D tubes/prisms (see buildTube) rather than flat
 * triangle "cards", so they keep their silhouette from every viewing
 * angle instead of vanishing edge-on. Deliberately much bigger than the
 * hawk predator geometry it replaces.
 */
export function createDragonGeometries(length: number, width: number): CreatureGeometries {
  const body = buildDragonBodyGeometry(length, width);

  const wingSpan = length * 1.5;
  const wingChord = length * 0.85;
  const wingLeft = buildMembraneWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildMembraneWingGeometry(wingSpan, wingChord, -1);

  const tail = buildDragonTailGeometry(length, width);
  const legs = buildDragonLegsGeometry(length, width);

  return {
    body,
    wingLeft,
    wingRight,
    tail,
    // Sways about the tail's own root at the rump, not the model origin. The
    // two are length*0.25 apart, and pivoting at the origin swung the root end
    // through an arc of that radius — dragging it sideways out through the
    // haunch. MODEL_RIGHT, so the whip tail sweeps up and down like a
    // reptile's rather than flicking side to side like a fish's.
    tailRig: swayingTailRig({
      pivot: [0, dragonTailRootY(length), dragonTailRootZ(length)],
      axis: [1, 0, 0],
    }),
    legs: singleLegPart(legs),
  };
}

// --- Resolution constants -------------------------------------------------

/**
 * Radial segments for the dragon body LatheGeometry.  Raising from 32 → 48
 * removes the faceted "sides-of-a-barrel" look on the torso and neck without
 * a prohibitive polygon increase (1.5× lateral triangles).  Exported so the
 * creatureSmoothness regression test can assert the exact resulting
 * triangle count against this constant (issue #262).
 */
export const DRAGON_BODY_RADIAL_SEGMENTS = 48;

/**
 * Cross-section sides for the dragon tail tube.  Raising from 6 → 10 makes
 * the tail read as a round tapered whip rather than a hexagonal prism
 * (issue #262).  Exported for the same regression test as above.
 */
export const DRAGON_TAIL_TUBE_SIDES = 10;

// --- Shared volumetric helpers -------------------------------------------

/**
 * Builds a tapering tube (a "generalized cylinder") along an arbitrary
 * 3D path, with a per-point radius — used for the tail, legs, and horn/
 * frill spikes so they read as solid 3D forms from every angle instead
 * of the flat single-plane "cards" those parts used to be built from
 * (which disappear when viewed edge-on). A radius of 0 at the last point
 * collapses that ring to a single point, giving a natural cone/point tip
 * with no extra end-cap logic needed.
 */
function buildTube(path: THREE.Vector3[], radii: number[], sides = 6): number[] {
  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  // Parallel-transport a normal frame down the path so ring cross-sections
  // stay consistently oriented even as the tangent direction turns (needed
  // for the curved tail) instead of each ring picking an independent, and
  // potentially flipped, basis.
  let normal = new THREE.Vector3(0, 0, 1);
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i < path.length; i++) {
    const tangent = new THREE.Vector3();
    if (i < path.length - 1) tangent.subVectors(path[i + 1], path[i]);
    else tangent.subVectors(path[i], path[i - 1]);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
    tangent.normalize();

    normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent)));
    if (normal.lengthSq() < 1e-8) {
      normal.set(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x));
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    const ring: THREE.Vector3[] = [];
    const r = radii[i];
    for (let s = 0; s < sides; s++) {
      const theta = (s / sides) * Math.PI * 2;
      const offset = normal.clone().multiplyScalar(Math.cos(theta) * r).add(binormal.clone().multiplyScalar(Math.sin(theta) * r));
      ring.push(path[i].clone().add(offset));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = rings[i][s];
      const b = rings[i][(s + 1) % sides];
      const c = rings[i + 1][s];
      const d = rings[i + 1][(s + 1) % sides];
      pushTri(a, c, d);
      pushTri(a, d, b);
    }
  }

  // Start cap (skipped when the first radius is already ~0, i.e. a spike
  // rooted to a point rather than a blunt-ended tube).
  if (radii[0] > 1e-6) {
    const ring = rings[0];
    const center = path[0];
    for (let s = 0; s < sides; s++) {
      pushTri(center, ring[(s + 1) % sides], ring[s]);
    }
  }
  const last = radii.length - 1;
  if (radii[last] > 1e-6) {
    const ring = rings[last];
    const center = path[last];
    for (let s = 0; s < sides; s++) {
      pushTri(center, ring[s], ring[(s + 1) % sides]);
    }
  }

  return positions;
}

/**
 * Rotates a (y, z) pair around a pivot on the Y axis — used to bend the
 * body's lathe profile (see applyNeckBend) and to bend the tail's path
 * into a curve instead of a ruler-straight line.
 */
function rotateAroundPivot(y: number, z: number, pivotY: number, angleRad: number): [number, number] {
  const dy = y - pivotY;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return [pivotY + dy * cos - z * sin, dy * sin + z * cos];
}

/**
 * Applies two compounded bends to every vertex of the (merged) body
 * geometry, in place: the neck arches upward starting at `neckPivotY`,
 * then the head tilts back down (as if looking down at prey) starting at
 * the later `headPivotY` — composed on top of the neck bend so the head
 * tilt is relative to the now-raised neck, not the original straight
 * spine. Without this, the lathe profile alone produces a perfectly
 * straight head-to-tail spine, which reads as a stiff, bird-like posture
 * rather than a dragon's raised, downward-peering head.
 */
function applyNeckBend(
  geometry: THREE.BufferGeometry,
  neckPivotY: number,
  neckAngleRad: number,
  headPivotY: number,
  headAngleRad: number,
): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  // The head pivot itself lies beyond the neck pivot, so it moves under
  // the neck bend too — transform it once so the head bend rotates around
  // its correct, already-bent location.
  const [bentHeadPivotY, bentHeadPivotZ] = rotateAroundPivot(headPivotY, 0, neckPivotY, neckAngleRad);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const origY = pos.getY(i);
    let y = origY;
    let z = pos.getZ(i);

    if (origY > neckPivotY) {
      [y, z] = rotateAroundPivot(y, z, neckPivotY, neckAngleRad);
    }
    if (origY > headPivotY) {
      const dy = y - bentHeadPivotY;
      const dz = z - bentHeadPivotZ;
      const cos = Math.cos(headAngleRad);
      const sin = Math.sin(headAngleRad);
      y = bentHeadPivotY + dy * cos - dz * sin;
      z = bentHeadPivotZ + dy * sin + dz * cos;
    }

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Radially-symmetric body profile with a longer, thicker neck than the
 * hawk body — reads as a serpentine dragon torso rather than a plump
 * bird chest. Proportions are deliberately bulkier (wider haunch/chest
 * radii) than the hawk's. The head narrows into a distinctly elongated,
 * crocodile-like snout (rather than a round bird-head bulge). A spiky
 * dorsal frill (see buildDragonFrillGeometry) is merged onto the head/
 * neck afterward, since a lathe alone can't produce asymmetric features,
 * and the whole merged result is then bent (see applyNeckBend) so the
 * head rises above the body line and tilts down, instead of following
 * the lathe's naturally dead-straight axis.
 */
// Neck/head bend parameters shared between the body geometry (see
// applyNeckBend) and computeDragonMouthTransform below — kept as named
// constants (rather than inlined twice) so the fire-breath origin/
// direction in Renderer3D can never silently drift out of sync with
// where the geometry actually puts the snout tip.
const NECK_PIVOT_FRACTION = 0.24; // neck starts bending at this fraction of halfLen
const NECK_ANGLE_RAD = 0.4; // ~+23°: arch the neck/head up (positive = toward local +Z/up)
const HEAD_PIVOT_FRACTION = 0.56; // head/jaw-hinge pivot, as a fraction of halfLen
const HEAD_ANGLE_RAD = -0.6; // ~-34° relative tilt: angles the snout back down from the raised neck
const SNOUT_TIP_FRACTION = 1.1; // elongated snout tip, past the body's nominal length (fraction of halfLen)

/**
 * Computes where the dragon's mouth actually ends up in local model
 * space (X=right, Y=forward, Z=up — see MODEL_UP_AXIS/FORWARD_AXIS in
 * Renderer3D) after both neck-bend rotations, plus the direction the
 * snout points in that same local frame — by replaying the exact same
 * rotateAroundPivot math applied to the snout-tip vertex in
 * applyNeckBend/buildDragonBodyGeometry, rather than a hand-tuned
 * approximation that could drift out of sync with the geometry.
 *
 * Used by Renderer3D's fire-breath effect so flame spawns from the
 * dragon's actual visual mouth position and travels along the direction
 * the snout is really pointing (forward and slightly down, per the bend
 * angles above) instead of the raw body-forward heading, which ignored
 * the raised/tilted neck entirely.
 */
export function computeDragonMouthTransform(length: number): {
  offsetForward: number;
  offsetUp: number;
  dirForward: number;
  dirUp: number;
} {
  const halfLen = length * 0.5;
  const neckPivotY = halfLen * NECK_PIVOT_FRACTION;
  const headPivotY = halfLen * HEAD_PIVOT_FRACTION;
  const tipY = halfLen * SNOUT_TIP_FRACTION;

  const [bentHeadPivotY, bentHeadPivotZ] = rotateAroundPivot(headPivotY, 0, neckPivotY, NECK_ANGLE_RAD);

  let y = tipY;
  let z = 0;
  if (tipY > neckPivotY) {
    [y, z] = rotateAroundPivot(y, z, neckPivotY, NECK_ANGLE_RAD);
  }
  if (tipY > headPivotY) {
    const dy = y - bentHeadPivotY;
    const dz = z - bentHeadPivotZ;
    const cos = Math.cos(HEAD_ANGLE_RAD);
    const sin = Math.sin(HEAD_ANGLE_RAD);
    y = bentHeadPivotY + dy * cos - dz * sin;
    z = bentHeadPivotZ + dy * sin + dz * cos;
  }

  // The snout tip lies beyond both pivots, so a *direction* vector there
  // (as opposed to a position) is rotated by the simple sum of the two
  // angles — both bends are rotations in the same local Y-Z plane, and
  // sequential same-plane rotations compose additively for a direction
  // (no pivot offset to subtract).
  const totalAngle = NECK_ANGLE_RAD + HEAD_ANGLE_RAD;
  return {
    offsetForward: y,
    offsetUp: z,
    dirForward: Math.cos(totalAngle),
    dirUp: Math.sin(totalAngle),
  };
}

// Body rump constants — used by both buildDragonBodyGeometry (profile endpoints
// + rear cap) and by the eye-conforming code (profile sampling), so defined
// here rather than inlined in each call site.
const RUMP_Y_FRACTION = 0.70; // body ends at -halfLen * 0.70 (tail root at 0.5 is buried ~0.2*halfLen inside)
const RUMP_R_SCALE    = 0.26; // rump cross-section radius as a fraction of width — broad disc, not a near-point

/**
 * The authored silhouette control points for the body lathe, extracted as a
 * named function so both buildDragonBodyGeometry (which builds the lathe) and
 * dragonBodyRadiusAtY (which samples the profile for eye placement) work from
 * exactly the same source — keeping them in sync automatically rather than
 * relying on two independently-maintained copies that can drift apart.
 */
function buildDragonBodyProfile(halfLen: number, width: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(width * RUMP_R_SCALE, -halfLen * RUMP_Y_FRACTION), // rump (#206: broad disc, shortened taper)
    new THREE.Vector2(width * 0.52, -halfLen * 0.32), // haunch bulge (bulkier than hawk)
    new THREE.Vector2(width * 0.46, halfLen * 0.02), // chest
    new THREE.Vector2(width * 0.28, halfLen * 0.24), // neck taper start
    new THREE.Vector2(width * 0.19, halfLen * 0.42), // serpentine neck
    new THREE.Vector2(width * 0.21, halfLen * 0.52), // jaw hinge / back-of-skull, blockier than before
    new THREE.Vector2(width * 0.27, halfLen * 0.6), // heavy brow ridge (more crocodilian, less bird-beak)
    new THREE.Vector2(width * 0.22, halfLen * 0.68), // undercut behind the nostril bump — breaks up the smooth beak curve
    new THREE.Vector2(width * 0.14, halfLen * 0.8), // snout base — narrows sharply, no round head bulge
    new THREE.Vector2(width * 0.08, halfLen * 0.94), // snout mid
    new THREE.Vector2(width * 0.015, halfLen * SNOUT_TIP_FRACTION), // elongated snout tip
  ];
}

/**
 * Samples the body lathe profile to return the radius (X half-width of the
 * lathe at that Y cross-section) at the given pre-neck-bend Y coordinate.
 * Used by buildDragonFaceDetailsGeometry to position each iris/pupil disc
 * vertex flush with the skull surface rather than at a hardcoded offset that
 * can drift out of agreement with the profile shape — the root cause that made
 * ~69 % of pupil vertices sit inside the skull (#201 follow-up).
 * Exported for use in conformance tests.
 */
export const EYE_STANDOFF_SCALE = 0.012; // standoff fraction of width
export function dragonBodyRadiusAtY(y: number, halfLen: number, width: number): number {
  const profile = buildDragonBodyProfile(halfLen, width);
  const samples = new THREE.SplineCurve(profile).getPoints(128);
  // Profile Y increases monotonically (rump → snout), so a simple linear scan
  // works; binary search would be faster but the 17 iris+pupil vertices per
  // side call this at most ~34 times per geometry build, so it is not a hotspot.
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].y >= y) {
      const s0 = samples[i - 1], s1 = samples[i];
      const span = s1.y - s0.y;
      const t = Math.abs(span) < 1e-8 ? 0 : THREE.MathUtils.clamp((y - s0.y) / span, 0, 1);
      return THREE.MathUtils.lerp(s0.x, s1.x, t);
    }
  }
  return samples[samples.length - 1].x;
}

function buildDragonBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = buildDragonBodyProfile(halfLen, width);
  // Spline-resample the authored silhouette so the flat-shaded lathe reads
  // as a smooth surface (many gently-varying facets) instead of a few long
  // banded ones; raise radial segments to DRAGON_BODY_RADIAL_SEGMENTS for
  // the same reason.
  const smoothProfile = new THREE.SplineCurve(profile).getPoints(64);
  const latheGeometry = new THREE.LatheGeometry(smoothProfile, DRAGON_BODY_RADIAL_SEGMENTS);
  // Seal the open snout-tip lathe ring with a disc cap so it no longer reads
  // as a see-through hole viewed straight on from the front.
  const snoutCap = buildDiscCapGeometry(halfLen * SNOUT_TIP_FRACTION, width * 0.015, 16);
  // Seal the open rump lathe ring with a disc cap (#206: broad end-disc so
  // the butt doesn't read as a see-through hole from behind).
  const rumpCap = buildDiscCapGeometry(-halfLen * RUMP_Y_FRACTION, width * RUMP_R_SCALE, 16);
  const frillGeometry = buildDragonFrillGeometry(length, width, halfLen);
  const faceParts = buildDragonFaceDetailsGeometry(width, halfLen);
  const bodyColor = new THREE.Color(0xffffff);
  const merged = mergeGeometriesWithColor([
    { geometry: latheGeometry, color: bodyColor },
    { geometry: snoutCap, color: bodyColor },
    { geometry: rumpCap, color: bodyColor },
    { geometry: frillGeometry, color: bodyColor },
    ...faceParts,
  ]);
  latheGeometry.dispose();
  snoutCap.dispose();
  rumpCap.dispose();
  frillGeometry.dispose();
  for (const part of faceParts) part.geometry.dispose();

  // The lathe revolves the profile around the Y (head-to-tail) axis, so
  // its cross-section is a perfect circle — reads fine in side profile
  // but looks like a round balloon/pumpkin when viewed head-on or from
  // directly behind. Squashing the whole merged body (lathe + frill)
  // slightly along Z flattens that cross-section into a shallow oval
  // without visibly changing the side silhouette the profile above was
  // tuned against.
  merged.scale(1, 1, 0.62);

  // Raise the neck/head and tilt the head down — see applyNeckBend's doc
  // comment for why this can't just be baked into the (straight-axis)
  // lathe profile itself.
  applyNeckBend(merged, halfLen * NECK_PIVOT_FRACTION, NECK_ANGLE_RAD, halfLen * HEAD_PIVOT_FRACTION, HEAD_ANGLE_RAD);

  return merged;
}

/**
 * Facial detail geometry for the dragon head: a pair of flat disc eyes
 * (iris + pupil), a pair of nostril bumps near the snout tip, and a pair
 * of short mouth-line accents below the snout tip to suggest a closed jaw.
 *
 * Eyes (#201 + follow-up): flat co-planar CircleGeometry discs facing outward
 * along ±X. The iris (orangish-yellow) is slightly elongated along the head's
 * forward axis (Y) to give an almond/cat-eye shape. Each vertex's X coordinate
 * is derived from the body profile radius at that vertex's own Y (not from a
 * constant offset), so the disc conforms to the skull's curvature rather than
 * cutting through it where the skull bulges widest.
 *
 * Snout (#202): nostrils are positioned close to the snout tip and are kept
 * small so they read as dark accents without creating holes of their own.
 * The mouth lines are thin elongated boxes on the sides of the snout,
 * slightly below the midline, giving a hint of a closed jaw.
 *
 * All geometry is built at *unbent* head/neck Y coordinates — applyNeckBend
 * in buildDragonBodyGeometry rotates everything together afterward.
 */
function buildDragonFaceDetailsGeometry(
  width: number,
  halfLen: number,
): { geometry: THREE.BufferGeometry; color: THREE.Color }[] {
  // ── Eyes ─────────────────────────────────────────────────────────────────
  // Flat disc eyes: the iris faces outward along ±X (perpendicular to the
  // skull side). CircleGeometry lies in the XY plane with normal = +Z; after
  // rotateY(±π/2) the normal maps to ±X (outward) and the disc's local Y maps
  // to world Y (head-forward) — so scaling local Y by eyeElong before rotation
  // elongates the eye along the head-forward ("horizontal") direction.
  //
  // Each disc vertex's X is derived from the body-profile surface AT that
  // vertex's own (Y, Z) coordinates plus a small standoff. Two-dimensional
  // conforming is required:
  //   - Y conforming: dragonBodyRadiusAtY(y) gives the lathe radius r at y.
  //   - Z conforming: the body cross-section at height z is a circle of radius r,
  //     so the surface sits at x = sqrt(r² − z²), not just r. Without this
  //     second step the eye disc is flush at z = 0 but floats far off the skull
  //     at the brow ridge (#201 follow-up measured 5× standoff at the top edge).
  // The translate(0, eyeY, eyeZ) happens AFTER the loop, so the vertex's final
  // world Z must be computed as pos.getZ(i) + eyeZ here.
  const irisRadius = width * 0.085;
  const pupilRadius = irisRadius * 0.48;
  const eyeElong = 1.35; // horizontal stretch: almond/cat-eye shape
  const eyeY = halfLen * 0.585; // forward of the jaw hinge / brow ridge
  const eyeZ = width * 0.07; // slightly above the head's centre-line
  // Small standoff beyond the profile surface — enough to ensure no vertex
  // is ever inside even with floating-point rounding, but small enough that
  // the disc isn't visibly hovering at grazing angles.
  const eyeStandoff = width * EYE_STANDOFF_SCALE;
  // Additional tiny offset for the pupil to prevent z-fighting against the iris.
  const pupilOffset = width * 0.003;

  const irisColor = new THREE.Color(0xff9010); // orangish-yellow
  const pupilColor = new THREE.Color(0x040204); // near-black

  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];

  for (const side of [-1, 1] as const) {
    // rotateY(+π/2) → face +X (right eye outward); rotateY(-π/2) → face -X (left eye outward)
    const rotAngle = side * Math.PI / 2;
    const rotMat = new THREE.Matrix4().makeRotationY(rotAngle);

    // Iris — after rotateY(±π/2) all vertices have X = 0. We set X to the
    // true skull-surface distance at each vertex's own (Y, Z), so the disc
    // conforms to the skull in both head-forward and up-down directions.
    const iris = new THREE.CircleGeometry(irisRadius, 16);
    iris.scale(1, eyeElong, 1);
    iris.applyMatrix4(rotMat);
    {
      const pos = iris.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const r  = dragonBodyRadiusAtY(eyeY + pos.getY(i), halfLen, width);
        const vz = pos.getZ(i) + eyeZ; // final world Z after translate
        const surfaceX = Math.sqrt(Math.max(0, r * r - vz * vz));
        pos.setX(i, side * (surfaceX + eyeStandoff));
      }
      pos.needsUpdate = true;
    }
    iris.translate(0, eyeY, eyeZ);

    // Pupil — same two-dimensional surface-conforming treatment plus pupilOffset
    // so it sits just proud of the iris (z-fighting prevention, not a depth cue).
    const pupil = new THREE.CircleGeometry(pupilRadius, 12);
    pupil.scale(1, eyeElong * 0.85, 1);
    pupil.applyMatrix4(rotMat);
    {
      const pos = pupil.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const r  = dragonBodyRadiusAtY(eyeY + pos.getY(i), halfLen, width);
        const vz = pos.getZ(i) + eyeZ; // final world Z after translate
        const surfaceX = Math.sqrt(Math.max(0, r * r - vz * vz));
        pos.setX(i, side * (surfaceX + eyeStandoff + pupilOffset));
      }
      pos.needsUpdate = true;
    }
    pupil.translate(0, eyeY, eyeZ);

    parts.push(
      { geometry: iris, color: irisColor },
      { geometry: pupil, color: pupilColor },
    );
  }

  // ── Nostrils ─────────────────────────────────────────────────────────────
  // Small spherical bumps close to the snout tip, on the dorsal (+Z) surface,
  // kept subtle so they read as dark shadowed slits at viewing distance rather
  // than deep gouges. Moved forward from the older halfLen * 0.88 position to
  // sit closer to the front of the snout as a dragon's nostrils typically do.
  const nostrilRadius = width * 0.032;
  const nostrilY = halfLen * 0.95; // close to the snout tip (tip is at halfLen * 1.1)
  const nostrilZ = width * 0.09; // on top of the snout (dorsal side)
  const nostrilX = width * 0.055;
  const leftNostril = new THREE.SphereGeometry(nostrilRadius, 6, 4);
  leftNostril.translate(-nostrilX, nostrilY, nostrilZ);
  const rightNostril = new THREE.SphereGeometry(nostrilRadius, 6, 4);
  rightNostril.translate(nostrilX, nostrilY, nostrilZ);

  const nostrilColor = new THREE.Color(0x0a0508); // near-black shadowed slit

  parts.push(
    { geometry: leftNostril, color: nostrilColor },
    { geometry: rightNostril, color: nostrilColor },
  );

  // ── Mouth lines ───────────────────────────────────────────────────────────
  // Short thin boxes on either side of the snout slightly below the midline
  // (negative Z = ventral side) — suggest a closed jaw without carving a hole.
  // Keep them subtle: thin in X (lateral) and Z (height) but long enough in Y
  // (head-forward) to read as a line at typical viewing distance.
  const mouthLineLen = width * 0.11; // length along head-forward (Y) axis
  const mouthLineH = width * 0.012; // height (Z, up-down)
  const mouthLineD = width * 0.006; // depth (X, lateral — very thin)
  const mouthY = halfLen * 0.97; // just behind the snout tip
  const mouthZ = -width * 0.04; // slightly below the midline (ventral)
  const mouthX = width * 0.05; // slightly to the side

  const leftMouth = new THREE.BoxGeometry(mouthLineD, mouthLineLen, mouthLineH);
  leftMouth.translate(-mouthX, mouthY, mouthZ);
  const rightMouth = new THREE.BoxGeometry(mouthLineD, mouthLineLen, mouthLineH);
  rightMouth.translate(mouthX, mouthY, mouthZ);

  const mouthColor = new THREE.Color(0x050205); // near-black

  parts.push(
    { geometry: leftMouth, color: mouthColor },
    { geometry: rightMouth, color: mouthColor },
  );

  return parts;
}

/**
 * A spiky dorsal frill running from the back of the skull down the neck
 * — small backswept spikes shrinking in size toward the shoulders — in
 * place of the old pair of simple flat brow horns, which (being flat
 * triangle "cards") vanished when viewed edge-on and read more like bird
 * ear-tufts than a dragon's head crest. Each spike is a proper tapered
 * 3D tube (see buildTube) so it keeps a visible silhouette from any
 * angle. Built at the *unbent* head/neck Y coordinates the body profile
 * uses — applyNeckBend rotates these along with the rest of the merged
 * body afterward, so the frill automatically rides along with the head
 * as it's raised and tilted.
 */
function buildDragonFrillGeometry(length: number, width: number, halfLen: number): THREE.BufferGeometry {
  const positions: number[] = [];

  // Spike anchor points walking from just behind the brow down to the
  // shoulders, each with a base width (how far from centerline it sits)
  // and a length (how far it juts up/back).
  const spikes: { y: number; baseR: number; spikeLen: number }[] = [
    { y: halfLen * 0.63, baseR: width * 0.1, spikeLen: length * 0.22 }, // brow spike, biggest
    { y: halfLen * 0.53, baseR: width * 0.11, spikeLen: length * 0.17 },
    { y: halfLen * 0.42, baseR: width * 0.1, spikeLen: length * 0.13 },
    { y: halfLen * 0.3, baseR: width * 0.09, spikeLen: length * 0.1 },
    { y: halfLen * 0.16, baseR: width * 0.09, spikeLen: length * 0.075 },
  ];

  for (const { y, baseR, spikeLen } of spikes) {
    // Root sits just above the spine (+Z, dorsal), sweeps backward
    // (-Y, toward the tail) and further up as it extends to the tip —
    // a proper backswept horn/spike silhouette instead of a straight
    // vertical antenna.
    const root = new THREE.Vector3(0, y, width * 0.22);
    const tip = new THREE.Vector3(0, y - spikeLen * 0.55, width * 0.22 + spikeLen);
    positions.push(...buildTube([root, tip], [baseR, 0], 5));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A single filled leathery wing panel (unlike the hawk's separated
 * feather fingers), rooted near the front third of the body like a real
 * bat/dragon forearm rather than mid-body, with a broader chord (less
 * "spindly dragonfly wing", more "broad membrane"). The leading edge runs
 * straight from the shoulder to a sharp wrist joint — rather than
 * bulging outward in a smooth curve like a bird's leading edge — and a
 * small hooked "thumb claw" juts forward from the wrist, the single most
 * recognizable bat/dragon-wing cue. From the wrist, four finger bones
 * fan out to claw tips with *deep* concave scallops between them (pulled
 * in close to the wrist rather than just gently dipped) so the trailing
 * silhouette reads as a taut membrane stretched between distinct finger
 * bones — a shallow scallop rendered solid black (this creature has no
 * surface shading to hint at the finger bones otherwise) just blended
 * into a smooth, uniformly-wide outline that read as a single elongated
 * dragonfly/damselfly wing panel rather than a fanned bat wing. The
 * finger tips also converge to a single point at the wing's far corner
 * (rather than several tips near-level with each other), so the whole
 * panel tapers to a wingtip point instead of reading as a constant-width
 * blade.
 */
function buildMembraneWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  const root: [number, number] = [0, chord * 0.18];
  // Wrist joint: a sharp corner rather than a rounded shoulder bulge, so
  // the leading edge reads as two straight bone segments (root->wrist,
  // wrist->thumb) instead of a smooth bird-wing curve.
  const wrist: [number, number] = [span * 0.28 * s, chord * 0.5];
  // Thumb claw: hooks forward and slightly further out from the wrist —
  // the classic dragon/bat "hand hook" silhouette.
  const thumbClaw: [number, number] = [span * 0.2 * s, chord * 0.8];
  // Finger/claw tip anchor points fanning out from the wrist. Unlike the
  // previous layout (where the last two claws sat at nearly the same
  // span, giving the panel a constant-width "blade" outline), these
  // converge toward a single furthest-out tip (claws[2], the wing's true
  // "index finger") with the trailing claws swept increasingly far back
  // and inward — the fan silhouette that reads as a tapered bat wing
  // rather than an elongated dragonfly panel.
  const claws: [number, number][] = [
    [span * 0.5 * s, chord * 0.38],
    [span * 0.74 * s, chord * 0.08],
    [span * 0.92 * s, -chord * 0.22], // wingtip: the longest, furthest-out finger
    [span * 0.7 * s, -chord * 0.58],
  ];
  // Concave scallop points between claws — pulled in *deep*, much closer
  // to the wrist-to-body line than a gentle dip, so the membrane between
  // each finger reads as a distinct taut scallop in silhouette rather
  // than blurring into a smooth trailing edge (this creature is rendered
  // as flat, near-black silhouette with no surface shading to hint at
  // the finger bones otherwise, so the *outline* has to do all the work).
  const scallops: [number, number][] = [
    [span * 0.42 * s, -chord * 0.05],
    [span * 0.62 * s, -chord * 0.42],
    [span * 0.56 * s, -chord * 0.68],
  ];
  const wristAnchor: [number, number] = [span * 0.24 * s, -chord * 0.32];

  const to3 = (p: [number, number]): number[] => [p[0], p[1], 0];

  // Forearm leading panel: straight root->wrist edge, then the thumb
  // claw's forward hook, then down into the wrist anchor.
  pushTri(to3(root), to3(wrist), to3(thumbClaw));
  pushTri(to3(root), to3(thumbClaw), to3(wristAnchor));
  pushTri(to3(thumbClaw), to3(wrist), to3(claws[0]));
  pushTri(to3(thumbClaw), to3(claws[0]), to3(wristAnchor));

  // Fan the membrane out through each claw/scallop pair.
  pushTri(to3(wristAnchor), to3(claws[0]), to3(scallops[0]));
  pushTri(to3(scallops[0]), to3(claws[0]), to3(claws[1]));
  pushTri(to3(wristAnchor), to3(scallops[0]), to3(scallops[1]));
  pushTri(to3(scallops[0]), to3(claws[1]), to3(scallops[1]));
  pushTri(to3(scallops[1]), to3(claws[1]), to3(claws[2]));
  pushTri(to3(wristAnchor), to3(scallops[1]), to3(scallops[2]));
  pushTri(to3(scallops[1]), to3(claws[2]), to3(scallops[2]));
  pushTri(to3(scallops[2]), to3(claws[2]), to3(claws[3]));
  pushTri(to3(wristAnchor), to3(scallops[2]), to3(claws[3]));

  // Bone/finger tubes: the membrane panel above is a single flat (Z=0)
  // polygon, which — like the old flat legs/tail before they were
  // rebuilt as real tubes — collapses to an near-invisible hairline when
  // viewed edge-on, and reads as a smooth featureless blade from every
  // other angle since there's no surface shading to hint at an internal
  // structure. Real bat/dragon wings are a membrane stretched taut
  // between distinctly thick arm and finger *bones*; adding those as
  // actual 3D tapered tubes (see buildTube) gives the wing a visible
  // skeletal silhouette from any viewing angle (including edge-on) and
  // is the single biggest cue that separates a "bat/dragon wing" from a
  // flat, veiny "dragonfly wing" panel.
  const boneR = chord * 0.045;
  const bonePath3 = (p: [number, number]) => new THREE.Vector3(p[0], p[1], 0);
  positions.push(
    ...buildTube([bonePath3(root), bonePath3(wrist), bonePath3(thumbClaw)], [boneR * 0.9, boneR, boneR * 0.35], 5),
  );
  for (const claw of claws) {
    positions.push(...buildTube([bonePath3(wrist), bonePath3(claw)], [boneR * 0.85, 0], 5));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

  // Bake a root->wingtip lightening gradient, as a MULTIPLIER for the same
  // reason the tail does (see buildDragonTailGeometry): 1 at the root so the
  // membrane starts on exactly whatever color the body currently is, rising
  // toward the tip. Absolute colors would pin the wings to one palette and
  // reopen a seam at the shoulder the moment the body lerps toward its hunt
  // tint.
  //
  // Lightening means factors ABOVE 1, which is legitimate here: vertex colors
  // are stored linear and unclamped, and are multiplied into the diffuse term.
  //
  // The factor is derived from a reference PAIR rather than typed in directly,
  // so the membrane keeps a consistent relationship to the body across palette
  // retunes. Only the RATIO of the two matters, so they are chosen together
  // and neither is meaningful alone.
  //
  // A near-white tip (a pair around 0x3e2064 -> 0xe4d4ff) was tried and is too
  // strong: the outer third of the membrane washes out to white and stops
  // reading as a wing. This gentler pair keeps the tip clearly lavender.
  const wingRefBody = new THREE.Color(0x502a7f);
  const wingRefTip = new THREE.Color(0xb08fd8); // light lavender at the wingtip
  const tipFactor = new THREE.Color(
    wingRefTip.r / wingRefBody.r,
    wingRefTip.g / wingRefBody.g,
    wingRefTip.b / wingRefBody.b,
  );

  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  // Distance outward from the body along the span axis, normalized by the
  // furthest-out vertex. Uses the actual extent rather than the nominal span
  // so the claw tips land exactly at 1 no matter how the outline is retuned.
  let maxOut = 0;
  for (let vi = 0; vi < posAttr.count; vi++) {
    maxOut = Math.max(maxOut, Math.abs(posAttr.getX(vi)));
  }
  // The root stop is deliberately well BELOW 1, i.e. darker than the body
  // rather than matching it. Matching the body reads as the membrane being
  // pale right up to the shoulder, which flattens the join; seating it in
  // shadow there reads as the membrane emerging from under the body, and gives
  // the outward lightening a longer run to work across.
  //
  // Hue-neutral (a single scalar) on purpose: this is a shading term, so
  // tinting it would fight the palette rather than sit underneath it. Values
  // much below ~0.3 crush the inner membrane toward black and swallow the
  // bone-tube silhouette; prefer lifting the tip to widen the range.
  const rootFactor = 0.45;
  const colors = new Float32Array(posAttr.count * 3);
  for (let vi = 0; vi < posAttr.count; vi++) {
    const t = maxOut > 0 ? THREE.MathUtils.clamp(Math.abs(posAttr.getX(vi)) / maxOut, 0, 1) : 0;
    colors[vi * 3]     = THREE.MathUtils.lerp(rootFactor, tipFactor.r, t);
    colors[vi * 3 + 1] = THREE.MathUtils.lerp(rootFactor, tipFactor.g, t);
    colors[vi * 3 + 2] = THREE.MathUtils.lerp(rootFactor, tipFactor.b, t);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A long, tapering whip tail that follows a genuine curved path — an
 * up-then-down S-bend along its length (arcs up slightly near the body,
 * sweeps down more sharply through the middle, then curls back upward
 * again right at the tip, plus a gentle sideways sway) rather than a
 * single straight line or a monotonic droop that only visibly curves
 * right at the very tip — built as a true tapering tube (see buildTube)
 * rather than a single flat ribbon, which vanished to a hairline when
 * viewed exactly edge-on. A row of small triangular dorsal fins (also
 * proper 3D tubes now, not paper-thin blades) runs down its length for
 * a stegosaurus-esque reptile silhouette, sized and spaced to hug the
 * now-slimmer tube rather than sticking out like antennae.
 */
/**
 * The tail's attachment point on the body, in model units.
 *
 * Exported to the rig (not to scene config) so the sway rotation pivots about
 * exactly the vertex the tail is built from.
 */
function dragonTailRootY(length: number): number {
  return -length * 0.25;
}

/** Slight lift above the belly axis; pulled back down from 0.06. */
function dragonTailRootZ(length: number): number {
  return length * 0.02;
}

function buildDragonTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];

  // Tail root sits at the body's rump and slightly above the belly axis, so
  // it projects rearward from the haunch rather than from the body's center.
  // Shared with the rig so the sway pivot and the vertices it rotates can't
  // drift apart — the whole point of declaring the pivot next to the geometry.
  const yOffset = dragonTailRootY(length);
  const zOffset = dragonTailRootZ(length);

  // Walk from the body root (t=0) to the tip (t=1), each entry giving a
  // tapering half-width (used as the tube radius) and a curved (x, y, z)
  // offset — droops downward (-z) and sways gently sideways (x) the
  // farther out along the tail we go, instead of a ruler-straight line.
  const tailLen = length * 1.75;
  const steps = 11;
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];

  // Start the tail INSIDE the body rather than flush at the rump.
  //
  // The tail sways about a pivot at the root, so a tail that merely reaches the
  // rump plane swings sideways there and opens an annular gap you can see sky
  // through (#278). The clearance was only ~0.02 wu: the tail is ~0.19 wu wide
  // where it crosses the rump disc, and that disc is 0.208 wu. Burying the
  // first segment deep in the body means the junction stays covered through the
  // full sway range, without widening the visible tail.
  //
  // The buried point sits well within the body radius at that height (~0.46 wu
  // against a 0.22 wu tail), so it never pokes through the flanks.
  const buriedInset = length * 0.18;
  path.push(new THREE.Vector3(0, yOffset + buriedInset, zOffset));
  radii.push(width * 0.275);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = yOffset + (-tailLen * t);
    // A gentle upward arc near the body (the sine term) composed with an
    // accelerating downward sweep toward the tip (t^1.6) — together these
    // give the tail a genuine up-then-down S-bend along its length,
    // rather than a single monotonic droop, which read as basically
    // straight for most of the tail's length with the curve only
    // showing up right at the very tip. The higher-frequency sine term
    // (1.1 full periods over the tail's length) also curls the very tip
    // back upward after the main downward sweep, instead of the curve
    // just bottoming out and staying down — the classic "flick" silhouette
    // real dragon tails are drawn with, rather than a limp noodle.
    // Ease the S-bend in from zero at the root (#278). The arc term rises
    // fast: at its raw value the tail's centreline is already 0.175 wu above
    // the body axis where it crosses the rump plane, which shoved the tube off
    // the opening and left sky showing along the bottom and both sides. Fading
    // it in lets the tail leave the body axially and pick the curve up outside.
    const arcEase = THREE.MathUtils.smoothstep(t, 0, 0.28);
    const droop = zOffset + arcEase * length * 0.2 * Math.sin(t * Math.PI * 2.2) - length * 0.46 * Math.pow(t, 1.35);
    const sway = length * 0.16 * Math.sin(t * Math.PI * 0.85);
    path.push(new THREE.Vector3(sway, y, droop));
    // Base taper, plus a short root flare that decays by t≈0.2. The flare is
    // what actually seals the joint: the tube has to be wider than the rump
    // opening (0.208 wu) where it crosses, and the plain taper only reached
    // 0.193 wu there. It also reads correctly — real tails are thickest where
    // they meet the body.
    const rootFlare = width * 0.18 * Math.max(0, 1 - t / 0.2);
    radii.push(width * 0.255 * (1 - t) + width * 0.02 * t * (1 - t) + rootFlare);
  }
  radii[radii.length - 1] = 0; // sharp spike tip

  positions.push(...buildTube(path, radii, DRAGON_TAIL_TUBE_SIDES));

  // Small dorsal fins standing proud of the tube (roughly +Z/dorsal in
  // the tail's own resting frame), shrinking toward the tip. Sampled at
  // the same curved path points so they hug the tube instead of the old
  // straight-line assumption.
  const finCount = 5;
  for (let i = 0; i < finCount; i++) {
    const t = 0.12 + (i / finCount) * 0.75;
    const idx = Math.round(t * steps);
    const base = path[idx].clone();
    const finHeight = length * (0.05 - t * 0.025);
    const finBaseR = width * (0.12 - t * 0.05);
    const tip = base.clone().add(new THREE.Vector3(0, -length * 0.02, finHeight));
    positions.push(...buildTube([base, tip], [finBaseR, 0], 4));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

  // Bake a root→tip darkening gradient as a MULTIPLIER (neutral white at the
  // rump, dark at the tip) rather than as absolute colors.
  //
  // It used to bake absolute colors, root 0x502a7f to tip 0x080314, and the
  // color applicator passed white as the tail's instance color so that
  // gradient showed through untouched. That pinned the tail to one fixed
  // palette while the body's instance color lerps from DRAGON_PREDATOR_BASE
  // toward the brighter DRAGON_PREDATOR_HUNT as the dragon chases — so the
  // two matched only at rest, and the moment the body brightened the tail
  // stayed put and a visible seam opened at the joint.
  //
  // As a multiplier the root is exactly 1 and the tail therefore always starts
  // at whatever color the body currently is, then darkens along its length. It
  // tracks the hunt tint for free.
  //
  // The tip factor is derived from the two original colors rather than typed in
  // by hand, so the tip keeps the exact appearance it has today whenever the
  // body sits at its base color.
  // These two only set the SHAPE of the falloff (tip / root), never an absolute
  // color, so the dragon's palette can be retuned in NatureSceneRenderer3D
  // without touching the geometry.
  const legacyRootColor = new THREE.Color(0x502a7f); // the old baked root
  const legacyTipColor = new THREE.Color(0x080314); // the old baked near-black tip
  const tipFactor = new THREE.Color(
    legacyTipColor.r / legacyRootColor.r,
    legacyTipColor.g / legacyRootColor.g,
    legacyTipColor.b / legacyRootColor.b,
  );
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const tailRootY = yOffset;
  const tailTipY  = yOffset - tailLen;
  for (let vi = 0; vi < posAttr.count; vi++) {
    const vy = posAttr.getY(vi);
    const t = THREE.MathUtils.clamp((vy - tailRootY) / (tailTipY - tailRootY), 0, 1);
    colors[vi * 3]     = THREE.MathUtils.lerp(1, tipFactor.r, t);
    colors[vi * 3 + 1] = THREE.MathUtils.lerp(1, tipFactor.g, t);
    colors[vi * 3 + 2] = THREE.MathUtils.lerp(1, tipFactor.b, t);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A pair of stubby, clawed legs tucked under the belly — one pair near
 * the chest, one pair near the haunch — the single biggest visual cue
 * that separates "dragon" from "large bird/bat", which have no visible
 * legs in flight. Purely static (shares the body's transform, no flap).
 * Built as tapering 3D tubes (see buildTube) rather than flat quads,
 * which used to vanish to a hairline when viewed from directly in front
 * or behind. Built along local -Z ("belly-down", perpendicular to the
 * wing/tail plane at Z=0) so the legs read as hanging beneath the body
 * rather than overlapping the wings.
 */
function buildDragonLegsGeometry(length: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];

  function buildLeg(hipX: number, hipY: number, lengthScale: number = 1) {
    // Shortened and thickened vs. the original proportions, which read as
    // long spindly spider-legs dangling far past the body silhouette from
    // most angles — real tucked-in-flight dragon legs should stay compact
    // and close to the belly, with only the clawed feet reading clearly.
    // `lengthScale` lets the front legs be built shorter than the back
    // legs (dragons, like most quadrupeds/reptiles, have noticeably
    // stockier front limbs than their hind legs) while keeping the same
    // knee-bend proportions.
    const thighLen = length * 0.13 * lengthScale;
    const shinLen = length * 0.11 * lengthScale;
    const hip = new THREE.Vector3(hipX, hipY, 0);
    // Bend the knee backward (thigh sweeps toward the tail) then swing the
    // shin forward again toward/past the hip — a proper knee-bend "Z"
    // silhouette in the Y/Z (front-back / up-down) plane, instead of a
    // straight rigid rod hanging under the belly, even mid-flight.
    const knee = new THREE.Vector3(hipX * 1.15, hipY - length * 0.05 * lengthScale, -thighLen);
    const foot = new THREE.Vector3(hipX * 1.05, knee.y + length * 0.07 * lengthScale, -(thighLen + shinLen));
    const legR = width * 0.1;

    positions.push(...buildTube([hip, knee, foot], [legR, legR * 0.8, legR * 0.55], 6));

    // A small fan of three clawed talons, each its own tapering tube
    // rooted at the foot — shorter and tighter than before so the foot
    // reads as a compact clawed paw rather than a wide spider-leg fan.
    const clawLen = length * 0.07 * lengthScale;
    const clawSpread: [number, number][] = [
      [-1, 0.3],
      [0, 1],
      [1, 0.3],
    ];
    // Root each claw slightly back UP the shin rather than exactly at the foot
    // vertex, and start it at the shin's own end radius (#278: claws read as
    // slightly detached). Both tubes are capped, so this was never a hole — but
    // the claw's base ring is perpendicular to the claw direction, which
    // diverges sharply from the shin direction, so a ring pinned exactly at the
    // shared vertex leaves a visible notch on the outside of the bend. Sinking
    // the base into the shin buries that seam.
    const shinDir = new THREE.Vector3().subVectors(foot, knee).normalize();
    const clawBase = foot.clone().addScaledVector(shinDir, -legR * 0.7);
    for (const [spreadX, spreadForward] of clawSpread) {
      const clawTip = new THREE.Vector3(
        foot.x + spreadX * width * 0.1,
        foot.y + spreadForward * clawLen * 0.4,
        foot.z - clawLen,
      );
      positions.push(...buildTube([clawBase, clawTip], [legR * 0.55, 0], 4));
    }
  }

  const frontY = length * 0.05; // near the chest
  const backY = -length * 0.32; // near the haunch
  const stanceX = width * 0.22;
  // Front legs are noticeably stockier/shorter than the hind legs (2/3
  // the length), matching how most quadrupeds/reptiles — and most dragon
  // depictions — are built, rather than four identical-length legs.
  const frontLegScale = 2 / 3;

  buildLeg(-stanceX, frontY, frontLegScale);
  buildLeg(stanceX, frontY, frontLegScale);
  buildLeg(-stanceX, backY);
  buildLeg(stanceX, backY);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
