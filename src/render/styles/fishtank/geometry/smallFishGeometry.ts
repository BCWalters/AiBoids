import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  buildEyeDotsGeometry,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  subdivideProfile,
  bakeUniformColor,
  bakeCountershadeColors,
  bakeLengthBandColors,
  bakeUpperFlankMarkColors,
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

/** Builds the shared lathe body (nose at +Y, peduncle at -Y) with the given
 * profile and lateral-compression proportions. The caller bakes the body's
 * color pattern before it is merged with the dorsal fin and eyes. */
function buildLatheBody(profile: THREE.Vector2[], proportions: BodyProportions): THREE.BufferGeometry {
  const body = new THREE.LatheGeometry(profile, 16);
  body.scale(proportions.sideSquash, 1, proportions.heightStretch);
  return body;
}

/**
 * A single triangular dorsal fin standing up (+Z) from the fish's back over
 * the widest part of the body — the single strongest silhouette cue that
 * separates "a fish" from "a flattened egg". Built via extrudeRingGeometryAlongX
 * (thickened flank-to-flank along X) because its ring lies in the Y-Z plane, so
 * a Z-axis extrusion would leave it vanishingly thin edge-on.
 */
function buildDorsalFinGeometry(length: number, width: number, heightFactor: number, heightStretch: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const finHeight = width * heightFactor;
  const root = new THREE.Vector3(0, halfLen * 0.08, width * 0.3 * heightStretch);
  const back = new THREE.Vector3(0, -halfLen * 0.35, width * 0.32 * heightStretch);
  const tip = new THREE.Vector3(0, -halfLen * 0.1, width * 0.3 * heightStretch + finHeight);
  const thickness = width * 0.12;
  return extrudeRingGeometryAlongX([root, back, tip], thickness);
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
  const thickness = chord * 0.08;
  return extrudeRingGeometry([root, leadingBulge, tip, trailingBulge], thickness);
}

/**
 * A forked caudal (tail) fin trailing behind the body (toward -Y): a quad
 * boundary (root -> upperTip -> notch -> lowerTip) extruded into a real prism,
 * with `notch` pulled forward toward the root to cut the classic V-shaped fork.
 * Static (does not flap).
 */
function buildCaudalFinGeometry(length: number, width: number, spread: number): THREE.BufferGeometry {
  const root = new THREE.Vector3(0, 0, 0);
  const upperTip = new THREE.Vector3(-width * spread, -length * 0.5, 0);
  const lowerTip = new THREE.Vector3(width * spread, -length * 0.5, 0);
  const notch = new THREE.Vector3(0, -length * 0.18, 0);
  const thickness = width * 0.05;
  return extrudeRingGeometry([root, upperTip, notch, lowerTip], thickness);
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

  let profile = variant.profile(halfLen, width);
  if (variant.profileSubdivide) profile = subdivideProfile(profile, variant.profileSubdivide);
  const lathe = buildLatheBody(profile, variant.proportions);
  const coloredBody = variant.bakeBody(lathe, halfLen, width);

  const dorsal = bakeUniformColor(
    buildDorsalFinGeometry(length, width, fins.dorsalHeightFactor, variant.proportions.heightStretch),
    variant.dorsalColor,
  );

  const eyeRadius = width * (variant.eyeRadiusFactor ?? 0.04);
  const eyeY = halfLen * 0.62;
  const eyeX = width * 0.22 * variant.proportions.sideSquash;
  const eyeZ = width * 0.1 * variant.proportions.heightStretch;
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
  const tail = bakeUniformColor(buildCaudalFinGeometry(length, width, fins.caudalSpreadFactor), variant.tailColor);

  return { body, wingLeft, wingRight, tail };
}


// ---------------------------------------------------------------------------
// Per-species variants. Colors chosen to read as the real fish; geometry
// proportions give each species a distinct, recognizable silhouette.
// ---------------------------------------------------------------------------

/** Plain fish ("Fish"): a streamlined, mildly-compressed body with natural
 * countershading (olive-steel back fading to a pale silver belly) and muted
 * olive-gray fins — a believable generic minnow/baitfish. */
export function createPlainFishGeometries(length: number, width: number): CreatureGeometries {
  const back = new THREE.Color(0x6f7c63);
  const belly = new THREE.Color(0xd7dcd0);
  return buildFishVariant(length, width, {
    proportions: { sideSquash: 0.62, heightStretch: 0.675 },
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
    bakeBody: (body) => bakeCountershadeColors(body, back, belly),
    dorsalColor: new THREE.Color(0x7c8a70),
    pectoralColor: new THREE.Color(0x9aa690),
    tailColor: new THREE.Color(0x7c8a70),
  });
}

/** Goldfish: a deep, rounded, chunky body in rich orange fading to a lighter
 * gold belly, with large flowing orange fins. */
export function createGoldfishGeometries(length: number, width: number): CreatureGeometries {
  const back = new THREE.Color(0xff6a00);
  const belly = new THREE.Color(0xffb347);
  const finColor = new THREE.Color(0xff8c1a);
  return buildFishVariant(length, width, {
    proportions: { sideSquash: 0.72, heightStretch: 0.86 },
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
    bakeBody: (body) => bakeCountershadeColors(body, back, belly),
    dorsalColor: finColor,
    pectoralColor: finColor,
    tailColor: finColor,
    fins: {
      dorsalHeightFactor: 1.15,
      pectoralSpanFactor: 0.4,
      pectoralChordFactor: 0.34,
      caudalSpreadFactor: 1.0,
    },
  });
}

/** Clownfish: a stubby oval orange body crossed by three white vertical bands
 * outlined in black, with orange fins. */
export function createClownfishGeometries(length: number, width: number): CreatureGeometries {
  const bodyColor = new THREE.Color(0xf4661c);
  const band = new THREE.Color(0xf7f4ee);
  const edge = new THREE.Color(0x1a120c);
  const finColor = new THREE.Color(0xf4661c);
  return buildFishVariant(length, width, {
    proportions: { sideSquash: 0.66, heightStretch: 0.75 },
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
      bakeLengthBandColors(body, halfLen, bodyColor, band, edge, [
        { from: 0.6, to: 0.72 }, // head band, just behind the eye
        { from: 0.38, to: 0.5 }, // mid-body band
        { from: 0.14, to: 0.22 }, // peduncle band
      ], 0.03),
    dorsalColor: finColor,
    pectoralColor: finColor,
    tailColor: finColor,
    eyeRadiusFactor: 0.045,
  });
}

/** Blue Tang: a tall, disc-shaped, strongly-compressed royal-blue body with a
 * black "palette" marking across the upper flank and a bright yellow tail. */
export function createBlueTangGeometries(length: number, width: number): CreatureGeometries {
  const blue = new THREE.Color(0x1560bd);
  const mark = new THREE.Color(0x0b1622);
  const yellow = new THREE.Color(0xffcf00);
  return buildFishVariant(length, width, {
    proportions: { sideSquash: 0.5, heightStretch: 1.0 },
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
      bakeUpperFlankMarkColors(body, blue, mark, halfLen, { zFrom: 0.42, lengthFrom: 0.12, lengthTo: 0.72 }),
    dorsalColor: mark,
    pectoralColor: yellow,
    tailColor: yellow,
    fins: {
      dorsalHeightFactor: 0.7,
      caudalSpreadFactor: 0.7,
    },
    eyeRadiusFactor: 0.045,
  });
}
