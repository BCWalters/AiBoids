import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  buildEyeDotsGeometry,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  bakeVerticalStripeColors,
  splineLatheRadiusAt,
  latheFlankXAt,
  FISH_EYE_FLATTEN,
  fishtankFinThickness,
  type FinThicknessSample,
  setScaleSuppressAttribute,
} from './fishSharedGeometry';

// Fish tank style: the "parrot" boid species' fishtank-exclusive
// silhouette, reskinned from an earlier placeholder (a duplicate of the
// nature-style macaw body, then briefly a generic "tetra") into a real
// butterflyfish — a tall, dramatically laterally-compressed, roughly
// triangular disc that tapers to a point at the mouth, banded with
// vertical stripes. Deliberately its own file/species-specific shape
// (like sharkGeometry.ts/fishGeometry.ts) rather than a variation on the
// small torpedo-bodied fish, since a real butterflyfish's disc profile,
// striping, and taller sail-like dorsal/anal fins are a fundamentally
// different silhouette, not just a size tweak.
export function createButterflyfishGeometries(length: number, width: number): CreatureGeometries {
  const body = buildButterflyfishBodyGeometry(length, width);

  // Small, modest paddles near the "gill" region — real butterflyfish
  // pectoral fins are unobtrusive compared to the dramatic dorsal/anal
  // finnage and tall disc body, unlike this species' old macaw-wing scale.
  const finSpan = length * 0.24;
  const finChord = length * 0.22;
  const wingLeft = buildPectoralFinGeometry(length, finSpan, finChord, 1);
  const wingRight = buildPectoralFinGeometry(length, finSpan, finChord, -1);

  // Rooted at the model's own local origin (like fishGeometry.ts's
  // caudal fin, unlike the old macaw-tail placeholder this replaces,
  // whose root sat well behind the origin) — the origin falls well
  // inside the body's own thick midsection here too, so the hidden
  // "stalk" between origin and the body's actual rear surface stays
  // buried regardless of sway rotation, and this species can now safely
  // join the other small fish's fast tail-sway animation (see
  // Renderer3D's isFishTail, no longer excluded for this species).
  const tail = buildCaudalFinGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}

// Near-black eye, stays near-black under any per-pattern body tint
// multiply — same trick as fishGeometry.ts/sharkGeometry.ts.
const EYE_COLOR = new THREE.Color(0x0d0b08);
// Tinted by the per-individual pattern's "body" color (see Renderer3D's
// BUTTERFLYFISH_COLOR_PATTERNS) — full brightness so the chosen hue shows
// through as-authored.
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
// The alternating stripe band, deliberately a fixed near-black rather
// than tinted — real butterflyfish stripe patterns are almost always a
// bright body color banded with dark (often black) vertical stripes, and
// keeping this band an absolute near-black (not multiplied by the body
// tint) means every color pattern reads with the same crisp dark-stripe
// contrast rather than washing out for darker body hues.
const STRIPE_BAND_COLOR = new THREE.Color(0x151210);

const BODY_SIDE_SQUASH = 0.18; // dramatically thin side-to-side — a real butterflyfish reads as an almost paper-thin disc
const BODY_HEIGHT_STRETCH = 1.1; // slightly taller than the raw lathed radius, on top of the profile's own height

/**
 * Lathe profile (radius vs. local Y, tail at -halfLen to mouth at
 * +halfLen), shared between the body mesh itself and the dorsal/anal
 * fins (via latheBodyRadiusAt) so they root flush against the body's
 * real surface with no floating gap — the same technique
 * sharkGeometry.ts's dorsal fins use. Traces a rounded, curved
 * triangle: a slender caudal peduncle at the very tail, widening
 * quickly to the body's full height (the "base" of the triangle,
 * staying tall and roughly flat through the rear-to-mid body — the real
 * butterflyfish silhouette cue this replaces the old macaw torso with),
 * then a long, gently curved taper forward to a near-point at the mouth.
 * Several points along that forward taper (rather than one straight
 * diagonal) give it a real curve rather than reading as a literal
 * triangle.
 */
function buildButterflyfishBodyProfile(halfLen: number, width: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(width * 0.03, -halfLen * 1.0), // peduncle tip, where the caudal fin attaches
    new THREE.Vector2(width * 0.16, -halfLen * 0.82), // slender peduncle
    new THREE.Vector2(width * 0.42, -halfLen * 0.62), // quick widen out of the peduncle
    new THREE.Vector2(width * 0.52, -halfLen * 0.35), // the triangle's "base" — near the body's max height
    new THREE.Vector2(width * 0.5, -halfLen * 0.05), // staying tall/flat through the rear-to-mid body
    new THREE.Vector2(width * 0.44, halfLen * 0.2), // gentle taper begins
    new THREE.Vector2(width * 0.28, halfLen * 0.45), // continuing taper, curving rather than a straight line
    new THREE.Vector2(width * 0.14, halfLen * 0.68), // narrowing toward the mouth
    new THREE.Vector2(width * 0.03, halfLen * 0.92), // mouth, the triangle's converging vertex
  ];
}

const STRIPE_COUNT = 8;

function buildButterflyfishBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  // Keep the raw control profile for fin-rooting (latheBodyRadiusAt uses
  // linear interpolation between the authored control points, which is correct
  // for placing fins flush against the body surface).
  const controlProfile = buildButterflyfishBodyProfile(halfLen, width);
  // Spline-resample the authored silhouette so the lathe reads smooth along
  // its length (same treatment as shark/barracuda/dragon); clamp radius ≥ 0
  // to guard against Catmull-Rom overshoot at zero-radius pole points.
  const smoothProfile = new THREE.SplineCurve(controlProfile)
    .getPoints(32)
    .map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const body = new THREE.LatheGeometry(smoothProfile, 24);
  body.scale(BODY_SIDE_SQUASH, 1, BODY_HEIGHT_STRETCH);

  const dorsalFin = buildDorsalFinGeometry(halfLen, width, controlProfile);
  const analFin = buildAnalFinGeometry(halfLen, width, controlProfile);

  // Stripes are baked across body + fins together (rather than the body
  // alone) so the banding reads as continuing naturally into the
  // dorsal/anal finnage instead of stopping abruptly at the body's own
  // silhouette edge — real butterflyfish striping often does exactly
  // this. halfLen (not the fins' own, slightly different Y extents)
  // anchors the band boundaries since every part shares the same
  // model-local Y axis/scale.
  const merged = mergePositionOnlyGeometries([body, dorsalFin, analFin]);
  const striped = bakeVerticalStripeColors(merged, halfLen, STRIPE_COUNT, WHITE_VERTEX_COLOR, STRIPE_BAND_COLOR);

  // Moved down and back from (0.72, 0.10). At the old spot the head has
  // already tapered toward the mouth, and the eye disc's rim overhung the
  // body's silhouette by 0.13 units — the eye literally stuck out past the
  // outline. Here the rim keeps 0.36 units of clearance all the way round.
  const eyeY = halfLen * 0.6;
  const eyeZ = width * 0.05 * BODY_HEIGHT_STRETCH;
  // 75% of the previous diameter.
  const eyeRadius = width * 0.045;
  // Seat the eye against the flank the body actually has at (eyeY, eyeZ)
  // rather than at a hand-picked X. The old constant sat 0.04 units OUTSIDE
  // that surface, and the sphere then added its full radius on top — on a body
  // squashed to 0.18 in X the eye protruded further than the whole flank is
  // thick and read as a black bean stuck to the head.
  const flankX = latheFlankXAt({
    y: eyeY,
    z: eyeZ,
    profile: controlProfile,
    sideSquash: BODY_SIDE_SQUASH,
    heightStretch: BODY_HEIGHT_STRETCH,
  });
  const eyes = buildEyeDotsGeometry(flankX, eyeY, eyeZ, eyeRadius, FISH_EYE_FLATTEN);

  const parts = [
    { geometry: striped, color: WHITE_VERTEX_COLOR, suppress: false },
    // The eye is not skin: without this the scale pattern tiles over the disc.
    { geometry: eyes, color: EYE_COLOR, suppress: true },
  ];
  const withEyes = mergeGeometriesWithColor(parts);
  setScaleSuppressAttribute(withEyes, parts);
  return withEyes;
}

/**
 * A tall, sail-like dorsal fin running most of the length of the back
 * (rather than a single small triangle like the small torpedo-fish's
 * dorsal) — real butterflyfish have a long dorsal fin base, often
 * peaking toward the front-middle. Rooted flush against the body's own
 * lathed surface via latheBodyRadiusAt (see buildButterflyfishBodyProfile's
 * doc comment) so there's no floating gap, and built via
 * extrudeRingGeometryAlongX since this fin's ring lies in the Y-Z plane
 * (every point has X=0) — the same fix sharkGeometry.ts/fishGeometry.ts's
 * dorsal fins needed to avoid vanishing when viewed edge-on.
 */
/**
 * Builds one of the two median (dorsal / anal) sail fins.
 *
 * The base FOLLOWS the body contour instead of running as a straight chord
 * between two endpoints. Both fins previously took a single root Z at each end
 * and interpolated between them, but the butterflyfish back arches by more
 * than half the fin's own height across that span, so the chord cut deep
 * inside the body mid-base — up to 0.69 units against a 1.36-unit fin — and
 * swallowed most of the sail exactly where it should be tallest. Sampling the
 * surface at every station keeps a constant, shallow burial the whole way.
 *
 * `side` is +1 for the dorsal (up, +Z) and -1 for the anal fin (down, -Z);
 * the outline is authored once in "height above the base" terms and mirrored.
 *
 * The base and the outer margin are sampled at the SAME stations. Sampling
 * them at different Y positions would leave the fin with no well-defined
 * thickness at any single Y, which makes its profile impossible to measure
 * from the built geometry.
 */
function buildMedianFinGeometry({
  width,
  profile,
  side,
  frontY,
  backY,
  finHeight,
  margin,
}: {
  width: number;
  profile: THREE.Vector2[];
  side: 1 | -1;
  frontY: number;
  backY: number;
  finHeight: number;
  margin: [number, number][];
}): THREE.BufferGeometry {
  // Sink the base under the skin so the seam is never visible, and so the fin
  // stays seated if the body profile is later retuned.
  const EMBED = 0.93;
  const surfaceAt = (y: number) =>
    splineLatheRadiusAt(y, profile) * BODY_HEIGHT_STRETCH * side;
  const baseAt = (y: number) => surfaceAt(y) * EMBED;
  const yAt = (t: number) => backY + (frontY - backY) * t;

  const stations = margin.map(([t]) => t);
  const ring: THREE.Vector3[] = [];
  // Ring order: along the base from front to rear, then back along the outer
  // margin toward the front, so the boundary stays a simple loop that does not
  // cross itself.
  for (const t of [1, ...[...stations].reverse(), 0]) {
    const y = yAt(t);
    ring.push(new THREE.Vector3(0, y, baseAt(y)));
  }
  for (const [t, h] of margin) {
    const y = yAt(t);
    ring.push(new THREE.Vector3(0, y, baseAt(y) + finHeight * h * side));
  }

  const thickness = fishtankFinThickness(width);
  return extrudeRingGeometryAlongX(ring, thickness);
}

/**
 * The tall, sail-like dorsal fin running most of the length of the back. Real
 * butterflyfish have a long dorsal base peaking toward the front-middle, which
 * the margin below traces: a quick rise out of the rear, a long swell to a
 * rounded peak forward of centre, then a short steep fall to the leading edge.
 * The small alternations along the way are ray-tip scalloping, not noise.
 *
 * Built via extrudeRingGeometryAlongX since this fin's ring lies in the Y-Z
 * plane (every point has X = 0) — the same fix sharkGeometry.ts's and
 * smallFishGeometry.ts's dorsal fins needed to avoid vanishing edge-on.
 */
function buildDorsalFinGeometry(halfLen: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  // t = 0 at the rear of the base, t = 1 at the front.
  const margin: [number, number][] = [
    [0.03, 0.14], [0.11, 0.36], [0.20, 0.45], [0.29, 0.57],
    [0.38, 0.63], [0.47, 0.74], [0.56, 0.81], [0.65, 0.92],
    [0.73, 0.97], [0.80, 1.00], [0.87, 0.90], [0.93, 0.64],
    [0.975, 0.31],
  ];
  return buildMedianFinGeometry({
    width,
    profile,
    side: 1,
    frontY: halfLen * 0.3,
    backY: -halfLen * 0.6,
    finHeight: width * 0.34,
    margin,
  });
}

/**
 * The anal (ventral) fin — a shorter, mirrored counterpart to the dorsal fin
 * along the belly, a real butterflyfish's other prominent sail-like fin.
 * Shorter front-to-back and shallower than the dorsal fin (a real anal fin
 * base is noticeably smaller than the dorsal one), and its peak sits further
 * back, giving the pair the offset silhouette a real fish has rather than
 * reading as one shape mirrored about the spine.
 */
function buildAnalFinGeometry(halfLen: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const margin: [number, number][] = [
    [0.04, 0.18], [0.13, 0.44], [0.22, 0.58], [0.31, 0.72],
    [0.40, 0.83], [0.49, 0.94], [0.58, 1.00], [0.67, 0.95],
    [0.75, 0.83], [0.83, 0.66], [0.90, 0.45], [0.96, 0.22],
  ];
  return buildMedianFinGeometry({
    width,
    profile,
    side: -1,
    frontY: halfLen * 0.0,
    backY: -halfLen * 0.55,
    finHeight: width * 0.24,
    margin,
  });
}

/**
 * A small paddle/kite-shaped pectoral fin extending sideways near the
 * body's origin (the "gill" region) — same construction as
 * fishGeometry.ts's pectoral fin (a 4-point kite extruded via
 * extrudeRingGeometry, since this ring lies flat in the X/Y plane).
 * `side` is +1 for the fin extending toward +X (left) or -1 toward -X
 * (right, mirrored).
 */
function buildPectoralFinGeometry(length: number, span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const rootY = length * 0.08;
  // Forward rake: the blade's outboard end is carried toward the head, so the
  // fin reads as held out from the gills rather than swept back toward the
  // tail. Applied as a function of span fraction so the root stays put and
  // only the outer blade swings forward.
  const RAKE = 0.34;
  const pt = (f: number, c: number) =>
    new THREE.Vector3(span * f * side, rootY + chord * (c + RAKE * f), 0);
  // A curved paddle rather than the previous 4-point kite, whose few long
  // straight edges met at hard corners and read as a blocky card stuck to the
  // flank: the root is narrow so the blade tapers into the body, the leading
  // edge bows forward, the tip is rounded, and the trailing edge is lightly
  // scalloped between ray tips.
  //
  // Every point stays at z = 0. The ring lies in the X/Y plane and
  // extrudeRingGeometry thickens it along Z, so any Z variation in the outline
  // would be indistinguishable from added thickness and would fatten the fin
  // past its thickness budget.
  const ring = [
    pt(0, 0.12),
    pt(0.30, 0.34),
    pt(0.62, 0.38),
    pt(0.87, 0.22),
    pt(1.0, -0.04),
    pt(0.88, -0.30),
    pt(0.74, -0.24),
    pt(0.58, -0.46),
    pt(0.42, -0.38),
    pt(0.22, -0.50),
    pt(0.06, -0.26),
  ];
  const thickness = fishtankFinThickness(chord);
  return extrudeRingGeometry(ring, thickness);
}

/**
 * A gently rounded, slightly convex fan tail — real butterflyfish tails
 * are typically a soft rounded or truncate fan rather than the deeply
 * forked "V" the regular small fish/shark have, so the boundary bulges
 * very slightly outward at its midpoint instead of notching inward.
 * Rooted at the model's own local origin (see createButterflyfishGeometries'
 * doc comment on why that's now safe for this species) and extruded via
 * extrudeRingGeometryAlongX since this fin's ring lies in the Y-Z plane —
 * consistent with sharkGeometry.ts's tail (unlike fishGeometry.ts's,
 * whose fork happens to lie in the X-Y plane instead).
 */
function buildCaudalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const peduncleY = -halfLen * 0.97;

  const root = new THREE.Vector3(0, 0, 0);
  const upperTip = new THREE.Vector3(0, peduncleY - halfLen * 0.32, width * 0.42);
  const midOut = new THREE.Vector3(0, peduncleY - halfLen * 0.42, 0); // bulges slightly outward, not notched
  const lowerTip = new THREE.Vector3(0, peduncleY - halfLen * 0.32, -width * 0.42);
  const thickness = fishtankFinThickness(width);
  return extrudeRingGeometryAlongX([root, upperTip, midOut, lowerTip], thickness);
}

export function createButterflyfishFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  const halfLen = length * 0.5;
  const profile = buildButterflyfishBodyProfile(halfLen, width);
  const finSpan = length * 0.24;
  const finChord = length * 0.22;
  return [
    {
      label: 'dorsal',
      geometry: buildDorsalFinGeometry(halfLen, width, profile),
      referenceSize: width,
      thinAxis: 'x',
    },
    {
      label: 'anal',
      geometry: buildAnalFinGeometry(halfLen, width, profile),
      referenceSize: width,
      thinAxis: 'x',
    },
    {
      label: 'pectoral-left',
      geometry: buildPectoralFinGeometry(length, finSpan, finChord, 1),
      referenceSize: finChord,
      thinAxis: 'z',
    },
    {
      label: 'pectoral-right',
      geometry: buildPectoralFinGeometry(length, finSpan, finChord, -1),
      referenceSize: finChord,
      thinAxis: 'z',
    },
    {
      label: 'caudal',
      geometry: buildCaudalFinGeometry(length, width),
      referenceSize: width,
      thinAxis: 'x',
    },
  ];
}
