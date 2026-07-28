import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  subdivideProfile,
  bakeUniformColor,
  bakeCountershadeColors,
  bakeLengthBandColors,
  bakeUpperFlankMarkColors,
  fishtankFinThickness,
  splineLatheRadiusAt,
  buildFlankEyeDiscsGeometry,
  setScaleSuppressAttribute,
  FISH_EYE_SURFACE_OFFSET,
  FISH_EYE_DISC_THICKNESS,
  type FinThicknessSample,
} from './fishSharedGeometry';

// Fish tank style: the small-species instances (Fish / Goldfish / Clownfish /
// Blue Tang). Each is a distinct, fully color-baked variant of a shared
// laterally-compressed lathe body + dorsal fin + paddle pectoral fins + forked
// caudal fin. Because every part bakes its real colors into a per-vertex
// 'color' attribute, these route through a WHITE-passthrough color path (the
// small-bird color applicator) so the baked multi-hue pattern shows unchanged
// rather than being flattened to one per-instance tint — the only way to get a
// clownfish's white bands over an orange body, or a blue tang's black flank
// mark and yellow tail, from a single instanced mesh.

// Near-black eye baked onto every small-fish head; stays correct under the
// white-passthrough color path (it carries its own dark vertex color).
const EYE_COLOR = new THREE.Color(0x0a0a0a);
// mergeGeometriesWithColor uses an input geometry's own baked 'color' attribute
// when present and only falls back to this uniform color otherwise; the body
// and fins all bake their own colors, so this is a never-used placeholder for
// those parts.
const UNUSED_MERGE_COLOR = new THREE.Color(0xffffff);

interface BodyProportions {
  /** Non-uniform post-lathe scale on local X (flank-to-flank). <1 makes the
   * fish laterally compressed (narrower side-to-side). */
  sideSquash: number;
  /** Non-uniform post-lathe scale on local Z (dorsal-to-ventral). >1 makes the
   * fish taller — the deep/disc body real fish read as fish-shaped. */
  heightStretch: number;
}

interface FinSizing {
  /** Dorsal fin height as a fraction of body width. */
  dorsalHeightFactor: number;
  /** Pectoral fin span (sideways reach) as a fraction of body length. */
  pectoralSpanFactor: number;
  /** Pectoral fin chord (fore-aft size) as a fraction of body length. */
  pectoralChordFactor: number;
  /** Caudal fin spread (upper/lower tip reach) as a fraction of body width. */
  caudalSpreadFactor: number;
}

const DEFAULT_FIN_SIZING: FinSizing = {
  dorsalHeightFactor: 0.9,
  pectoralSpanFactor: 0.3,
  pectoralChordFactor: 0.26,
  caudalSpreadFactor: 0.85,
};

// Small-fish size reductions that are *proportions* (silhouette shape), not
// overall creature size — overall size lives in FISHTANK_CREATURE_SIZES
// (length/width). Kept here with the other body proportions:
//  - BODY_DEPTH: the aquarium fish are 25% shallower back-to-belly (local Z,
//    dorsal-to-ventral) than their profile/heightStretch would otherwise give.
//  - SIDE_SQUASH: 25% narrower flank-to-flank (local X) than their per-variant
//    sideSquash would otherwise give — applied here (not via the width size)
//    so the fins aren't rescaled with it.
//  - DORSAL_HEIGHT: the dorsal fin stands 25% shorter than its per-variant
//    heightFactor, independent of the body-depth change above.
const SMALL_FISH_BODY_DEPTH_SCALE = 0.75;
const SMALL_FISH_SIDE_SQUASH_SCALE = 0.75;
const SMALL_FISH_DORSAL_HEIGHT_SCALE = 0.75;
//  - PECTORAL: the side fins are 15% smaller than their per-variant span/chord
//    factors would give. Applied here rather than by editing each factor so the
//    per-variant proportions (one variant deliberately runs larger fins) stay
//    in their existing relative sizes.
const SMALL_FISH_PECTORAL_SCALE = 0.85;

/** Builds the shared lathe body (nose at +Y, peduncle at -Y) with the given
 * profile and lateral-compression proportions. The caller bakes the body's
 * color pattern before it is merged with the dorsal fin and eyes.
 *
 * Spline-resamples the authored control points before lathing (the same
 * pattern used by the shark, barracuda, and dragon) so the body reads as
 * smooth along its length instead of visibly creased between the raw
 * control points.  24 radial segments matches typical viewing distance for
 * these small creatures (15° per face; imperceptible at the distances they
 * swim).  Together these replace the prior 8-point / 16-segment config that
 * was the only fish body below 32 radial segments.
 */
function buildLatheBody(profile: THREE.Vector2[], proportions: BodyProportions): THREE.BufferGeometry {
  // Clamp radius ≥ 0 so a Catmull-Rom overshoot at a zero-radius pole
  // (tail / nose tip) never produces a negative-radius lathe ring.
  const smoothProfile = new THREE.SplineCurve(profile)
    .getPoints(32)
    .map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const body = new THREE.LatheGeometry(smoothProfile, 24);
  body.scale(proportions.sideSquash, 1, proportions.heightStretch);
  return body;
}

/**
 * Samples the fish's BACK surface height (local +Z) at a spine position `y`,
 * from the same spline the lathe body is built from.
 *
 * The lathe revolves `profile` (radius, y) about Y and is then scaled by
 * heightStretch on Z, so the back at a given y is simply radius(y) *
 * heightStretch. Sampling the spline — not the raw control points — matters
 * because buildLatheBody lathes the RESAMPLED curve, and the two differ by
 * several units near the shoulder.
 *
 * Returns 0 beyond the profile's y range (nose and peduncle tips).
 */
function fishBackZ(profile: THREE.Vector2[], heightStretch: number, y: number): number {
  return splineLatheRadiusAt(y, profile) * heightStretch;
}

/**
 * A natural-profile dorsal fin standing up (+Z) from the fish's back — the
 * single strongest silhouette cue that separates "a fish" from "a flattened
 * egg".
 *
 * The base FOLLOWS the back contour instead of running straight. Previously the
 * whole base sat at one constant Z while the back is an arch, so at the fin's
 * forward end the body surface was ~7 units below the base and the fin visibly
 * hovered over the fish — read as a mohawk stuck on top rather than a fin
 * growing out of the back (issue #258). The base is also sunk slightly into the
 * body so no gap can open along it.
 *
 * The outer margin is a sampled curve rather than a few straight segments: it
 * rises convexly from a low trailing edge to a peak forward of centre, then
 * falls steeply to the leading edge, with a slight scallop between ray tips.
 *
 * Extruded flank-to-flank along X via extrudeRingGeometryAlongX (a Z-axis
 * extrusion would leave it near-invisible edge-on).
 */
function buildDorsalFinGeometry(
  length: number,
  width: number,
  heightFactor: number,
  heightStretch: number,
  profile: THREE.Vector2[],
): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const finHeight = width * heightFactor * 0.28125;
  // Shift the whole fin forward (+Y, toward the head) so it sits over the
  // shoulder rather than mid-back.
  const forwardShift = halfLen * 0.2;
  // Base extents, then extended 50% longer about their own midpoint so the
  // fin grows fore-and-aft without drifting off its forward position.
  const frontBaseY0 = halfLen * 0.12 + forwardShift;
  const rearBaseY0 = -halfLen * 0.35 + forwardShift;
  const baseMidY = (frontBaseY0 + rearBaseY0) * 0.5;
  const frontBaseY = baseMidY + (frontBaseY0 - baseMidY) * 1.5;
  const rearBaseY = baseMidY + (rearBaseY0 - baseMidY) * 1.5;

  // Sink the base under the skin so the seam is never visible, and so the fin
  // stays seated if the body profile is later retuned.
  const EMBED = 0.94;
  const baseAt = (y: number) => fishBackZ(profile, heightStretch, y) * EMBED;
  const yAt = (s: number) => rearBaseY + (frontBaseY - rearBaseY) * s;

  // Outer margin, sampled rear (s=0) to front (s=1). Peak sits forward of
  // centre; the trailing half is a long gentle sweep and the leading edge is
  // short and steep, which is the small-fish dorsal shape. The small
  // alternations are ray-tip scalloping, not noise.
  const margin: [number, number][] = [
    [0.04, 0.06], [0.15, 0.19], [0.26, 0.30], [0.37, 0.39],
    [0.47, 0.47], [0.57, 0.60], [0.66, 0.75], [0.74, 0.91],
    [0.80, 1.00], [0.87, 0.84], [0.93, 0.55], [0.97, 0.26],
  ];

  // Ring order: base front -> rear along the body, then the outer margin back
  // toward the front, so the boundary stays a simple non-self-intersecting loop.
  //
  // The base is sampled at the SAME stations as the margin (plus the two
  // endpoints). Sampling the two edges at different Y positions would leave the
  // fin with no well-defined thickness at any single Y, which makes its height
  // profile impossible to measure from the built geometry.
  const stations = margin.map(([s]) => s);
  const ring: THREE.Vector3[] = [];
  for (const s of [1, ...[...stations].reverse(), 0]) {
    const y = yAt(s);
    ring.push(new THREE.Vector3(0, y, baseAt(y)));
  }
  for (const [s, h] of margin) {
    const y = yAt(s);
    ring.push(new THREE.Vector3(0, y, baseAt(y) + finHeight * h));
  }

  const thickness = fishtankFinThickness(width);
  return extrudeRingGeometryAlongX(ring, thickness);
}

/**
 * A small rounded pectoral fin extending sideways near the gills. `side` is +1
 * (toward +X / left) or -1 (mirrored). Rooted with a slight forward (+Y) offset
 * so it reads as attached near the gills.
 *
 * Outlined as a curved paddle rather than the previous 4-point kite, whose few
 * long straight edges met at hard corners and read as a blocky card stuck to
 * the flank: the root is narrow so the blade tapers into the body, the leading
 * edge bows forward, the tip is rounded, and the trailing edge is lightly
 * scalloped between ray tips.
 *
 * Every ring point stays at z = 0. The ring lies in the X/Y plane and the
 * shared helper thickens it along Z, so any Z variation in the outline would be
 * indistinguishable from added thickness and would fatten the fin past its
 * thickness budget.
 *
 * These use the wingLeft/wingRight slots so they get the existing per-instance
 * flap animation (reads as paddling/steering).
 */
function buildPectoralFinGeometry(length: number, rawSpan: number, rawChord: number, side: 1 | -1): THREE.BufferGeometry {
  // Seated further aft (was 0.12) so the blade sits behind the gill line rather
  // than crowding the eye — the forward rake below carries the outer blade
  // toward the head, which pushed the whole fin visually forward.
  const rootY = length * 0.02;
  // The blade outline shrinks, but the extrusion thickness below is taken from
  // the UNSCALED chord: thickness is how solid the fin is, not a dimension of
  // its silhouette, and scaling it too would push these fins under the
  // "genuinely 3D" floor that finThickness.test.ts guards.
  const span = rawSpan * SMALL_FISH_PECTORAL_SCALE;
  const chord = rawChord * SMALL_FISH_PECTORAL_SCALE;
  // Forward rake: the blade's outboard end is carried toward the head, so the
  // fin reads as held out from the gills rather than swept back along the body
  // toward the tail. Applied as a function of span fraction so the root stays
  // put and only the outer blade swings forward.
  const RAKE = 0.34;
  const pt = (f: number, c: number) =>
    new THREE.Vector3(span * f * side, rootY + chord * (c + RAKE * f), 0);
  const ring = [
    // Narrow root, so the blade grows out of the flank instead of butting it.
    pt(0, 0.12),
    // Leading edge, bowed forward.
    pt(0.30, 0.34),
    pt(0.62, 0.38),
    // Rounded tip.
    pt(0.87, 0.22),
    pt(1.0, -0.04),
    // Trailing edge, scalloped between ray tips.
    pt(0.88, -0.30),
    pt(0.74, -0.24),
    pt(0.58, -0.46),
    pt(0.42, -0.38),
    pt(0.22, -0.50),
    pt(0.06, -0.26),
  ];
  const thickness = fishtankFinThickness(rawChord);
  return extrudeRingGeometry(ring, thickness);
}

/**
 * A forked (lyre-shaped) caudal (tail) fin trailing behind the body (toward
 * -Y). Real small fish have a VERTICAL tail — it spans dorsal-to-ventral
 * (up/down = local Z), NOT side-to-side like a whale's horizontal fluke — so
 * the fin lies in the Y-Z plane and is thickened flank-to-flank along X via
 * extrudeRingGeometryAlongX (a Z-axis extrusion would leave it edge-on and
 * near-invisible). It is built as TWO triangular lobes that share one short
 * vertical edge on the fish's centerline (the base where the fin meets the
 * peduncle); the upper lobe fans back-and-up and the lower lobe fans
 * back-and-down to tips that reach outside the body's vertical extent, leaving
 * a V-notch between them at the rear. Static (does not flap).
 */
function buildCaudalFinLobes(
  length: number,
  width: number,
  spread: number,
  heightStretch: number,
): { upperLobe: THREE.BufferGeometry; lowerLobe: THREE.BufferGeometry } {
  // Reaches back from the peduncle (very back of the body). The body is a solid
  // tapering lathe, so the fin's base simply embeds into the rear of the body.
  const finLength = length * 0.24;
  const rootBackY = -length * 0.32; // base sits at the back of the body
  // Vertical (dorsal-ventral) half-height, scaled by the body's own depth
  // (heightStretch) so the tail stays proportionate to each species' body.
  const halfHeight = width * spread * heightStretch;
  // The shared "short side": a short vertical edge on the centerline where both
  // lobes attach to the body.
  const notchHalf = halfHeight * 0.35;
  // Each lobe's tip reaches outside the body's vertical extent (spread apart top
  // and bottom) and angles backward, giving the classic forked silhouette.
  const tipHeight = halfHeight * 0.975; // halfway between original 1.3 and the 0.65 trial
  const baseTop = new THREE.Vector3(0, rootBackY, notchHalf);
  const baseLower = new THREE.Vector3(0, rootBackY, -notchHalf);
  const upperTip = new THREE.Vector3(0, rootBackY - finLength, tipHeight);
  const lowerTip = new THREE.Vector3(0, rootBackY - finLength, -tipHeight);
  const thickness = fishtankFinThickness(width);
  const upperLobe = extrudeRingGeometryAlongX([baseTop, upperTip, baseLower], thickness);
  const lowerLobe = extrudeRingGeometryAlongX([baseTop, lowerTip, baseLower], thickness);
  return { upperLobe, lowerLobe };
}

function buildCaudalFinGeometry(length: number, width: number, spread: number, heightStretch: number): THREE.BufferGeometry {
  const { upperLobe, lowerLobe } = buildCaudalFinLobes(length, width, spread, heightStretch);
  return mergePositionOnlyGeometries([upperLobe, lowerLobe]);
}

interface FishVariant {
  proportions: BodyProportions;
  /** Lathe profile control points, authored tail (-Y) to nose (+Y), as
   * (radius, y) pairs scaled by width/halfLen. */
  profile: (halfLen: number, width: number) => THREE.Vector2[];
  /** Extra per-edge profile subdivision, for variants whose color pattern
   * (bands / flank mark) needs finer Y resolution than the raw control points. */
  profileSubdivide?: number;
  /** Bakes the body's per-vertex color pattern onto the lathe. */
  bakeBody: (body: THREE.BufferGeometry, halfLen: number, width: number) => THREE.BufferGeometry;
  dorsalColor: THREE.Color;
  pectoralColor: THREE.Color;
  tailColor: THREE.Color;
  fins?: Partial<FinSizing>;
  eyeRadiusFactor?: number;
}

function buildFishVariant(length: number, width: number, variant: FishVariant): CreatureGeometries {
  const halfLen = length * 0.5;
  const fins = { ...DEFAULT_FIN_SIZING, ...(variant.fins ?? {}) };

  // Apply the back-to-belly (depth, local Z) and flank-to-flank (side-squash,
  // local X) reductions to the variant's own proportions, then use these
  // adjusted proportions everywhere the body shape matters (lathe body, dorsal
  // fin root height, eye placement) so the dorsal fin and eyes stay on the now-
  // shallower, narrower body surface.
  const proportions: BodyProportions = {
    ...variant.proportions,
    sideSquash: variant.proportions.sideSquash * SMALL_FISH_SIDE_SQUASH_SCALE,
    heightStretch: variant.proportions.heightStretch * SMALL_FISH_BODY_DEPTH_SCALE,
  };

  let profile = variant.profile(halfLen, width);
  if (variant.profileSubdivide) profile = subdivideProfile(profile, variant.profileSubdivide);
  const lathe = buildLatheBody(profile, proportions);
  const coloredBody = variant.bakeBody(lathe, halfLen, width);

  const dorsal = bakeUniformColor(
    buildDorsalFinGeometry(length, width, fins.dorsalHeightFactor * SMALL_FISH_DORSAL_HEIGHT_SCALE, proportions.heightStretch, profile),
    variant.dorsalColor,
  );

  const eyeRadius = width * (variant.eyeRadiusFactor ?? 0.026);
  const eyeY = halfLen * 0.62;
  const eyeZ = width * 0.1 * proportions.heightStretch;
  // A disc that follows the flank, so it is never clipped by the body's own
  // curvature the way a flat plate is (these bodies are round enough that a
  // flat eye visibly truncated into a crescent).
  const eyes = buildFlankEyeDiscsGeometry({
    y: eyeY,
    z: eyeZ,
    radius: eyeRadius,
    profile,
    sideSquash: proportions.sideSquash,
    heightStretch: proportions.heightStretch,
    offset: eyeRadius * FISH_EYE_SURFACE_OFFSET,
    thickness: eyeRadius * FISH_EYE_DISC_THICKNESS,
  });

  const parts = [
    { geometry: coloredBody, color: UNUSED_MERGE_COLOR, suppress: false },
    { geometry: dorsal, color: UNUSED_MERGE_COLOR, suppress: false },
    // The eye is not skin: without this the scale pattern tiles straight over
    // the disc and a crescent of scale shows on top of it.
    { geometry: eyes, color: EYE_COLOR, suppress: true },
  ];
  const body = mergeGeometriesWithColor(parts);
  setScaleSuppressAttribute(body, parts);

  const span = length * fins.pectoralSpanFactor;
  const chord = length * fins.pectoralChordFactor;
  const wingLeft = bakeUniformColor(buildPectoralFinGeometry(length, span, chord, 1), variant.pectoralColor);
  const wingRight = bakeUniformColor(buildPectoralFinGeometry(length, span, chord, -1), variant.pectoralColor);
  const tail = bakeUniformColor(buildCaudalFinGeometry(length, width, fins.caudalSpreadFactor, proportions.heightStretch), variant.tailColor);

  return { body, wingLeft, wingRight, tail };
}

function buildFishVariantFinThicknessSamples(length: number, width: number, variant: FishVariant): FinThicknessSample[] {
  const fins = { ...DEFAULT_FIN_SIZING, ...(variant.fins ?? {}) };
  const proportions: BodyProportions = {
    ...variant.proportions,
    sideSquash: variant.proportions.sideSquash * SMALL_FISH_SIDE_SQUASH_SCALE,
    heightStretch: variant.proportions.heightStretch * SMALL_FISH_BODY_DEPTH_SCALE,
  };
  const span = length * fins.pectoralSpanFactor;
  const chord = length * fins.pectoralChordFactor;
  let profile = variant.profile(length * 0.5, width);
  if (variant.profileSubdivide) profile = subdivideProfile(profile, variant.profileSubdivide);
  const dorsal = buildDorsalFinGeometry(
    length,
    width,
    fins.dorsalHeightFactor * SMALL_FISH_DORSAL_HEIGHT_SCALE,
    proportions.heightStretch,
    profile,
  );
  const wingLeft = buildPectoralFinGeometry(length, span, chord, 1);
  const wingRight = buildPectoralFinGeometry(length, span, chord, -1);
  const { upperLobe, lowerLobe } = buildCaudalFinLobes(length, width, fins.caudalSpreadFactor, proportions.heightStretch);
  return [
    { label: 'dorsal', geometry: dorsal, referenceSize: width, thinAxis: 'x' },
    { label: 'pectoral-left', geometry: wingLeft, referenceSize: chord, thinAxis: 'z' },
    { label: 'pectoral-right', geometry: wingRight, referenceSize: chord, thinAxis: 'z' },
    { label: 'caudal-upper-lobe', geometry: upperLobe, referenceSize: width, thinAxis: 'x' },
    { label: 'caudal-lower-lobe', geometry: lowerLobe, referenceSize: width, thinAxis: 'x' },
  ];
}


// ---------------------------------------------------------------------------
// Per-species variants. Colors chosen to read as the real fish; geometry
// proportions give each species a distinct, recognizable silhouette.
// ---------------------------------------------------------------------------

const PLAIN_FISH_BACK = new THREE.Color(0x6f7c63);
const PLAIN_FISH_BELLY = new THREE.Color(0xd7dcd0);
const PLAIN_FISH_VARIANT: FishVariant = {
  proportions: { sideSquash: 0.465, heightStretch: 0.675 },
  profile: (h, w) => [
    new THREE.Vector2(0, -h * 1.0),
    new THREE.Vector2(w * 0.14, -h * 0.82),
    new THREE.Vector2(w * 0.3, -h * 0.5),
    new THREE.Vector2(w * 0.46, -h * 0.15),
    new THREE.Vector2(w * 0.44, h * 0.15),
    new THREE.Vector2(w * 0.3, h * 0.45),
    new THREE.Vector2(w * 0.16, h * 0.68),
    new THREE.Vector2(0, h * 0.85),
  ],
  bakeBody: (body) => bakeCountershadeColors(body, PLAIN_FISH_BACK, PLAIN_FISH_BELLY),
  dorsalColor: new THREE.Color(0x7c8a70),
  pectoralColor: new THREE.Color(0x9aa690),
  tailColor: new THREE.Color(0x7c8a70),
};

/** Plain fish ("Fish"): a streamlined, mildly-compressed body with natural
 * countershading (olive-steel back fading to a pale silver belly) and muted
 * olive-gray fins — a believable generic minnow/baitfish. */
export function createPlainFishGeometries(length: number, width: number): CreatureGeometries {
  return buildFishVariant(length, width, PLAIN_FISH_VARIANT);
}

export function createPlainFishFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  return buildFishVariantFinThicknessSamples(length, width, PLAIN_FISH_VARIANT);
}

/**
 * Exported so tests can assert against the colours the goldfish actually
 * ships with rather than a copy. A test that declares its own palette
 * literal can only prove the baking algorithm honours its input; it cannot
 * see the shipped configuration rotting.
 */
export const GOLDFISH_FISHTANK_PALETTE = {
  back: 0xff6a00,
  belly: 0xffb347,
  fin: 0xff8c1a,
} as const;


const GOLDFISH_BACK = new THREE.Color(GOLDFISH_FISHTANK_PALETTE.back);
const GOLDFISH_BELLY = new THREE.Color(GOLDFISH_FISHTANK_PALETTE.belly);
const GOLDFISH_FIN_COLOR = new THREE.Color(GOLDFISH_FISHTANK_PALETTE.fin);
const GOLDFISH_VARIANT: FishVariant = {
  proportions: { sideSquash: 0.54, heightStretch: 0.86 },
  profile: (h, w) => [
    new THREE.Vector2(0, -h * 1.0),
    new THREE.Vector2(w * 0.2, -h * 0.76),
    new THREE.Vector2(w * 0.44, -h * 0.42),
    new THREE.Vector2(w * 0.56, -h * 0.08),
    new THREE.Vector2(w * 0.54, h * 0.22),
    new THREE.Vector2(w * 0.38, h * 0.5),
    new THREE.Vector2(w * 0.2, h * 0.72),
    new THREE.Vector2(0, h * 0.87),
  ],
  bakeBody: (body) => bakeCountershadeColors(body, GOLDFISH_BACK, GOLDFISH_BELLY),
  dorsalColor: GOLDFISH_FIN_COLOR,
  pectoralColor: GOLDFISH_FIN_COLOR,
  tailColor: GOLDFISH_FIN_COLOR,
  fins: {
    dorsalHeightFactor: 1.15,
    pectoralSpanFactor: 0.4,
    pectoralChordFactor: 0.34,
    caudalSpreadFactor: 1.0,
  },
};

/** Goldfish: a deep, rounded, chunky body in rich orange fading to a lighter
 * gold belly, with large flowing orange fins. */
export function createGoldfishGeometries(length: number, width: number): CreatureGeometries {
  return buildFishVariant(length, width, GOLDFISH_VARIANT);
}

export function createGoldfishFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  return buildFishVariantFinThicknessSamples(length, width, GOLDFISH_VARIANT);
}

const CLOWNFISH_BODY_COLOR = new THREE.Color(0xf4661c);
const CLOWNFISH_BAND_COLOR = new THREE.Color(0xf7f4ee);
const CLOWNFISH_EDGE_COLOR = new THREE.Color(0x1a120c);
const CLOWNFISH_FIN_COLOR = new THREE.Color(0xf4661c);
const CLOWNFISH_VARIANT: FishVariant = {
  proportions: { sideSquash: 0.495, heightStretch: 0.75 },
  profileSubdivide: 4,
  profile: (h, w) => [
    new THREE.Vector2(0, -h * 0.95),
    new THREE.Vector2(w * 0.24, -h * 0.68),
    new THREE.Vector2(w * 0.46, -h * 0.34),
    new THREE.Vector2(w * 0.52, h * 0.0),
    new THREE.Vector2(w * 0.5, h * 0.28),
    new THREE.Vector2(w * 0.34, h * 0.55),
    new THREE.Vector2(w * 0.18, h * 0.75),
    new THREE.Vector2(0, h * 0.9),
  ],
  bakeBody: (body, halfLen) =>
    bakeLengthBandColors(body, halfLen, CLOWNFISH_BODY_COLOR, CLOWNFISH_BAND_COLOR, CLOWNFISH_EDGE_COLOR, [
      { from: 0.6, to: 0.72 }, // head band, just behind the eye
      { from: 0.38, to: 0.5 }, // mid-body band
      { from: 0.14, to: 0.22 }, // peduncle band
    ], 0.03),
  dorsalColor: CLOWNFISH_FIN_COLOR,
  pectoralColor: CLOWNFISH_FIN_COLOR,
  tailColor: CLOWNFISH_FIN_COLOR,
  eyeRadiusFactor: 0.03,
};

/** Clownfish: a stubby oval orange body crossed by three white vertical bands
 * outlined in black, with orange fins. */
export function createClownfishGeometries(length: number, width: number): CreatureGeometries {
  return buildFishVariant(length, width, CLOWNFISH_VARIANT);
}

export function createClownfishFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  return buildFishVariantFinThicknessSamples(length, width, CLOWNFISH_VARIANT);
}

/** See GOLDFISH_FISHTANK_PALETTE for why these are exported. */
export const BLUE_TANG_FISHTANK_PALETTE = {
  body: 0x1560bd,
  mark: 0x0b1622,
  tail: 0xffcf00,
} as const;


const BLUE_TANG_BODY_COLOR = new THREE.Color(BLUE_TANG_FISHTANK_PALETTE.body);
const BLUE_TANG_MARK_COLOR = new THREE.Color(BLUE_TANG_FISHTANK_PALETTE.mark);
const BLUE_TANG_TAIL_COLOR = new THREE.Color(BLUE_TANG_FISHTANK_PALETTE.tail);
const BLUE_TANG_VARIANT: FishVariant = {
  proportions: { sideSquash: 0.375, heightStretch: 1.0 },
  profileSubdivide: 4,
  profile: (h, w) => [
    new THREE.Vector2(0, -h * 0.9),
    new THREE.Vector2(w * 0.26, -h * 0.6),
    new THREE.Vector2(w * 0.52, -h * 0.26),
    new THREE.Vector2(w * 0.62, h * 0.06),
    new THREE.Vector2(w * 0.56, h * 0.36),
    new THREE.Vector2(w * 0.4, h * 0.6),
    new THREE.Vector2(w * 0.2, h * 0.78),
    new THREE.Vector2(0, h * 0.9),
  ],
  bakeBody: (body, halfLen) =>
    // zFrom is a surface-normal fraction (0 = belly, 0.5 = the widest
    // point of the flank, 1 = the dorsal ridge), not a bounding-box
    // height fraction. 0.5 puts the mark's lower edge exactly on the
    // widest point at every station along the body. The previous 0.42
    // was a bounding-box fraction and happened to land on the widest
    // point at mid-body, but crept to half-way down the belly side at
    // the narrow peduncle -- 0.5 reproduces the mid-body look and holds
    // it constant.
    bakeUpperFlankMarkColors(body, BLUE_TANG_BODY_COLOR, BLUE_TANG_MARK_COLOR, halfLen, {
      zFrom: 0.5,
      lengthFrom: 0.12,
      lengthTo: 0.72,
    }),
  dorsalColor: BLUE_TANG_MARK_COLOR,
  pectoralColor: BLUE_TANG_TAIL_COLOR,
  tailColor: BLUE_TANG_TAIL_COLOR,
  fins: {
    dorsalHeightFactor: 0.7,
    caudalSpreadFactor: 0.7,
  },
  // Left larger than the other variants: the blue tang is a tall disc, so the
  // same radius reads smaller against its body depth.
  eyeRadiusFactor: 0.045,
};

/** Blue Tang: a tall, disc-shaped, strongly-compressed royal-blue body with a
 * black "palette" marking across the upper flank and a bright yellow tail. */
export function createBlueTangGeometries(length: number, width: number): CreatureGeometries {
  return buildFishVariant(length, width, BLUE_TANG_VARIANT);
}

export function createBlueTangFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  return buildFishVariantFinThicknessSamples(length, width, BLUE_TANG_VARIANT);
}
