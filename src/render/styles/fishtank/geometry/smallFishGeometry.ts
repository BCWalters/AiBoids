import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  buildEyeDotsGeometry,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  subdivideProfile,
  bakeUniformColor,
  bakeCountershadeColors,
  bakeLengthBandColors,
  bakeUpperFlankMarkColors,
  fishtankFinThickness,
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
 * A low trapezoidal dorsal fin standing up (+Z) from the fish's back over the
 * widest part of the body — the single strongest silhouette cue that separates
 * "a fish" from "a flattened egg". A flat-topped trapezoid (two upper corners,
 * inset from the base corners) rather than a single tall peak, so it reads as a
 * generic fish ridge instead of a shark's dorsal. Built via
 * extrudeRingGeometryAlongX (thickened flank-to-flank along X) because its ring
 * lies in the Y-Z plane, so a Z-axis extrusion would leave it vanishingly thin
 * edge-on.
 */
function buildDorsalFinGeometry(length: number, width: number, heightFactor: number, heightStretch: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const finHeight = width * heightFactor * 0.28125; // 25% shorter (was * 0.375)
  // Shift the whole fin forward (+Y, toward the head) so it sits over the
  // shoulder rather than mid-back.
  const forwardShift = halfLen * 0.2;
  const baseZ = width * 0.3 * heightStretch;
  // Base extents, then extended 50% longer about their own midpoint so the
  // fin grows fore-and-aft without drifting off its forward position.
  const frontBaseY0 = halfLen * 0.12 + forwardShift;
  const rearBaseY0 = -halfLen * 0.35 + forwardShift;
  const baseMidY = (frontBaseY0 + rearBaseY0) * 0.5;
  const frontBaseY = baseMidY + (frontBaseY0 - baseMidY) * 1.5;
  const rearBaseY = baseMidY + (rearBaseY0 - baseMidY) * 1.5;
  const baseLen = frontBaseY - rearBaseY;
  // Top edge shorter than the base (corners inset along Y) → trapezoid.
  const topInset = baseLen * 0.28;
  const frontBase = new THREE.Vector3(0, frontBaseY, baseZ);
  const rearBase = new THREE.Vector3(0, rearBaseY, baseZ);
  const rearTop = new THREE.Vector3(0, rearBaseY + topInset, baseZ + finHeight);
  const frontTop = new THREE.Vector3(0, frontBaseY - topInset, baseZ + finHeight);
  const thickness = fishtankFinThickness(width);
  return extrudeRingGeometryAlongX([frontBase, rearBase, rearTop, frontTop], thickness);
}

/**
 * A small paddle/kite-shaped pectoral fin extending sideways near the gills.
 * `side` is +1 (toward +X / left) or -1 (mirrored). Rooted with a slight
 * forward (+Y) offset so it reads as attached near the gills. Built as a
 * 4-point kite extruded into a real prism (its ring lies in the X/Y plane, so
 * the shared Z-thickening helper is correct here) so it keeps a silhouette from
 * above/below. These use the wingLeft/wingRight slots so they get the existing
 * per-instance flap animation (reads as paddling/steering).
 */
function buildPectoralFinGeometry(length: number, span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const rootY = length * 0.12;
  const tipX = span * side;
  const leadingBulgeX = span * 0.55 * side;
  const trailingBulgeX = span * 0.45 * side;
  const root = new THREE.Vector3(0, rootY, 0);
  const leadingBulge = new THREE.Vector3(leadingBulgeX, rootY + chord * 0.4, 0);
  const tip = new THREE.Vector3(tipX, rootY - chord * 0.1, 0);
  const trailingBulge = new THREE.Vector3(trailingBulgeX, rootY - chord * 0.5, 0);
  const thickness = fishtankFinThickness(chord);
  return extrudeRingGeometry([root, leadingBulge, tip, trailingBulge], thickness);
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
    buildDorsalFinGeometry(length, width, fins.dorsalHeightFactor * SMALL_FISH_DORSAL_HEIGHT_SCALE, proportions.heightStretch),
    variant.dorsalColor,
  );

  const eyeRadius = width * (variant.eyeRadiusFactor ?? 0.04);
  const eyeY = halfLen * 0.62;
  const eyeX = width * 0.22 * proportions.sideSquash;
  const eyeZ = width * 0.1 * proportions.heightStretch;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  const body = mergeGeometriesWithColor([
    { geometry: coloredBody, color: UNUSED_MERGE_COLOR },
    { geometry: dorsal, color: UNUSED_MERGE_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);

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
  const dorsal = buildDorsalFinGeometry(
    length,
    width,
    fins.dorsalHeightFactor * SMALL_FISH_DORSAL_HEIGHT_SCALE,
    proportions.heightStretch,
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
  eyeRadiusFactor: 0.045,
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
