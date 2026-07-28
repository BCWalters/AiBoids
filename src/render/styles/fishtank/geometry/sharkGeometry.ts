import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  swayingTailRig,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  latheBodyRadiusAt,
  fishtankFinThickness,
  type FinThicknessSample,
  buildFlankEyeDiscsGeometry,
  FISH_EYE_SURFACE_OFFSET,
  FISH_EYE_DISC_THICKNESS,
  setScaleSuppressAttribute,
} from './fishSharedGeometry';

// Fish tank style: this file originally started as a duplicate of
// nature's dragonGeometry.ts (bat wings, whip tail, clawed legs, deep
// violet coloring) as a placeholder, pending a proper reskin into an
// actual shark. It has since been rewritten from scratch, following the
// same conventions established by fishGeometry.ts's real small-fish
// reskin (a laterally-shaped lathed body, extruded — not flat — fins,
// baked eye dots) rather than anything left over from the dragon
// original: a torpedo-shaped body tapering to a pointed snout and a
// slender caudal peduncle, a tall swept dorsal fin plus a smaller second
// dorsal near the tail, a row of dark gill-slit accents behind the head,
// a pair of broad swept pectoral "wing" fins (using the wingLeft/
// wingRight slots, same as fishGeometry.ts, so they get the existing
// per-instance flap animation), and — the single most recognizable
// shark silhouette cue — a heterocercal caudal fin with a tall upper
// lobe and a much smaller lower lobe. No legs (sharks don't have any).
// Body tinting (medium gray instead of the old dragon purple) is handled
// by Renderer3D's own per-species color constants, not baked in here.

/**
 * Shark predator geometry: a real shark silhouette rather than the
 * bat-winged dragon placeholder this file used to contain. `length` and
 * `width` are the fishtank shark's world-space size (see
 * FISHTANK_CREATURE_SIZES.shark); `length` is stretched
 * by SHARK_LENGTH_SCALE below (while `width` is used as-is) since a
 * shark reads as a long, lean torpedo rather than a stubbier, rounder
 * body.
 */
const SHARK_LENGTH_SCALE = 1.35;

export function createSharkGeometries(rawLength: number, width: number): CreatureGeometries {
  const length = rawLength * SHARK_LENGTH_SCALE;
  const body = buildSharkBodyGeometry(length, width);

  // Modest, swept, pointed fins — sized as a fairly small fraction of
  // body length so they read as steering/lift fins rather than another
  // pair of big wings (an earlier pass sized these far too large,
  // rivaling the wingspan of a bird, which read as "winged" rather than
  // "finned").
  const finSpan = length * 0.32;
  const finChord = length * 0.2;
  const wingLeft = buildPectoralFinGeometry(length, finSpan, finChord, 1);
  const wingRight = buildPectoralFinGeometry(length, finSpan, finChord, -1);

  const tail = buildCaudalFinGeometry(length, width);

  return {
    body,
    wingLeft,
    wingRight,
    tail,
    // See SHARK_TAIL_PIVOT_FRACTION: hinging at the fin's own root keeps the
    // root end from sweeping out through the side of the body.
    //
    // Yaws about MODEL_UP (0,0,1), the dorsoventral axis, so the whole fin
    // swings side to side as one unit. It used to rotate about (0,1,0) — the
    // SPINE axis — which is a roll, not a sway: it drove the upper and lower
    // lobes in OPPOSITE lateral directions, tracing an X. The shark's tail is
    // heterocercal (upper lobe reaches z=+15.0, lower only z=-6.3), so the
    // upper lobe swung 2.3x further than the lower and the scissor was
    // impossible to miss. See sharkTailSway.test.ts.
    tailRig: swayingTailRig({ pivot: [0, sharkTailPivotY(rawLength), 0], axis: [0, 0, 1] }),
  };
}

/**
 * Radially-symmetric (lathed) torpedo body: a pointed, conical snout at
 * +Y (matching FORWARD_AXIS), widening through a slender midsection near
 * the gills/pectoral-fin root, then tapering down to a slim caudal
 * peduncle — the narrow "handle" the tail fin attaches to — at -Y. Kept
 * noticeably slimmer (lower max-radius-to-length ratio) than an earlier
 * pass, which read as a stubby, bulky torpedo rather than the long,
 * lean, streamlined silhouette real sharks have. Squashed only slightly
 * non-uniformly (unlike the small fish's more pronounced dorsoventral
 * stretch) since a shark's body reads as fairly round/torpedo-like in
 * cross-section rather than a thin, laterally-compressed disc. A pair
 * of dorsal fins, a row of gill-slit accents, and eye dots are merged
 * onto the body afterward.
 */
const BODY_SIDE_SQUASH = 0.88; // barely narrower side-to-side than tall
const BODY_HEIGHT_STRETCH = 1.08; // very slightly taller dorsal-to-ventral

// Lathe profile (radius vs. local Y) shared between the body mesh itself
// and anything that needs to know the body's actual surface radius at a
// given point along its length — e.g. buildDorsalFinsGeometry, which
// roots its fins at the body's own back line rather than a rough
// estimate, so there's no visible gap/floating seam between fin base
// and body surface.
function buildSharkBodyProfile(halfLen: number, width: number): THREE.Vector2[] {
  const controlPoints = [
    new THREE.Vector2(width * 0.015, -halfLen * 1.0), // peduncle tip, where the caudal fin attaches
    new THREE.Vector2(width * 0.07, -halfLen * 0.8), // slender peduncle
    new THREE.Vector2(width * 0.19, -halfLen * 0.52), // rear body widening
    new THREE.Vector2(width * 0.32, -halfLen * 0.16), // widest point, just behind center
    new THREE.Vector2(width * 0.31, halfLen * 0.06), // gill/pectoral-fin region, still broad
    new THREE.Vector2(width * 0.24, halfLen * 0.32), // shoulder, head taper begins
    new THREE.Vector2(width * 0.15, halfLen * 0.56), // snout base
    new THREE.Vector2(width * 0.07, halfLen * 0.78), // snout narrows further
    new THREE.Vector2(width * 0.01, halfLen * 0.97), // snout tip (open lathe ring — capped by a disc below)
  ];
  // Resample the authored silhouette along a smooth spline so the flat-shaded
  // lathe reads as a smooth surface with many gently-varying facets instead of
  // a few long banded ones (matches the barracuda body treatment).
  return new THREE.SplineCurve(controlPoints).getPoints(66);
}

function buildSharkBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = buildSharkBodyProfile(halfLen, width);
  const body = new THREE.LatheGeometry(profile, 32);
  // The lathe leaves the snout profile's final ring open (a small hole at the
  // tip) which reads as a transparent see-through dot. Seal it with a flat
  // disc matching that ring, merged before the squash/stretch so the cap
  // inherits the body's elliptical cross-section.
  const tip = profile[profile.length - 1];
  const snoutCap = buildSnoutCapGeometry(tip.y, tip.x, 32);
  const bodyShell = mergePositionOnlyGeometries([body, snoutCap]);
  bodyShell.scale(BODY_SIDE_SQUASH, 1, BODY_HEIGHT_STRETCH);

  const dorsalFins = buildDorsalFinsGeometry(length, width, profile);
  const gillSlits = buildGillSlitsGeometry(length, width, profile);

  const eyeY = halfLen * 0.48;
  const eyeRadius = width * 0.024;
  const eyeZ = width * 0.01 * BODY_HEIGHT_STRETCH;
  // A disc that follows the flank. The previous code sank a full sphere by half
  // its radius to tame its bulge; nothing may be sunk now, since the disc is
  // thin enough that any inward offset would bury it entirely.
  const eyes = buildFlankEyeDiscsGeometry({
    y: eyeY,
    z: eyeZ,
    radius: eyeRadius,
    profile,
    sideSquash: BODY_SIDE_SQUASH,
    heightStretch: BODY_HEIGHT_STRETCH,
    offset: eyeRadius * FISH_EYE_SURFACE_OFFSET,
    thickness: eyeRadius * FISH_EYE_DISC_THICKNESS,
  });

  const parts = [
    { geometry: mergePositionOnlyGeometries([bodyShell, dorsalFins]), color: WHITE_VERTEX_COLOR, suppress: false },
    { geometry: gillSlits, color: GILL_SLIT_COLOR, suppress: false },
    // The eye is not skin: without this the scale pattern tiles over the disc.
    { geometry: eyes, color: EYE_COLOR, suppress: true },
  ];
  const merged = mergeGeometriesWithColor(parts);
  setScaleSuppressAttribute(merged, parts);
  return merged;
}

/**
 * A flat, double-sided disc in the XZ plane at local Y = `y`, used to seal the
 * open ring the lathe leaves at the snout tip so it no longer reads as a
 * see-through hole. Double-sided (each wedge emitted with both windings) so it
 * looks solid whether the camera sees the snout from in front or behind.
 */
function buildSnoutCapGeometry(y: number, radius: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    positions.push(
      0, y, 0, x0, y, z0, x1, y, z1,
      0, y, 0, x1, y, z1, x0, y, z0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Near-black accents baked onto the shark's head/flank — stay visually
// correct under any per-species per-instance body tint multiply (near-
// black stays near-black regardless of what it's multiplied against),
// same trick fishGeometry.ts uses for its eye dots.
const EYE_COLOR = new THREE.Color(0x0a0908);
const GILL_SLIT_COLOR = new THREE.Color(0x1a1414);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);

/**
 * A tall, swept-back triangular dorsal fin roughly over the widest part
 * of the body — the single most important silhouette cue that reads as
 * "shark" from nearly any viewing angle — plus a much smaller second
 * dorsal fin further back near the peduncle, matching real sharks' twin-
 * dorsal-fin layout. Each fin's root Z is derived from the body's own
 * lathed profile (latheBodyRadiusAt), buried very slightly below the
 * body's actual surface (the BURY_FRACTION multiplier) rather than an
 * independent estimate, so the fin base is guaranteed to sit flush
 * against/inside the body with no visible floating gap at the seam —
 * an earlier version used a rough fixed-Z estimate for the main fin's
 * root that didn't quite track the body's own curved surface at that Y,
 * leaving a visible sliver of daylight between fin base and back.
 * Both fins are built via extrudeRingGeometryAlongX (a real 3D prism)
 * rather than a flat zero-thickness plane, so they keep their silhouette
 * instead of vanishing when viewed exactly edge-on.
 */
const DORSAL_FIN_BURY_FRACTION = 0.88; // sink the root slightly below the surface, never above it

function buildDorsalFinParts(
  length: number,
  width: number,
  profile: THREE.Vector2[],
): { mainFin: THREE.BufferGeometry; secondFin: THREE.BufferGeometry } {
  const halfLen = length * 0.5;

  const mainRootY = halfLen * 0.02;
  const mainBackY = -halfLen * 0.32;
  const mainTipY = -halfLen * 0.08;
  const mainRootZ = latheBodyRadiusAt(mainRootY, profile) * BODY_HEIGHT_STRETCH * DORSAL_FIN_BURY_FRACTION;
  const mainBackZ = latheBodyRadiusAt(mainBackY, profile) * BODY_HEIGHT_STRETCH * DORSAL_FIN_BURY_FRACTION;
  const mainFinHeight = width * 0.6375;
  const mainRoot = new THREE.Vector3(0, mainRootY, mainRootZ);
  const mainBack = new THREE.Vector3(0, mainBackY, mainBackZ);
  const mainTip = new THREE.Vector3(0, mainTipY, mainRootZ + mainFinHeight);
  const mainThickness = fishtankFinThickness(width);
  const mainFin = extrudeRingGeometryAlongX([mainRoot, mainBack, mainTip], mainThickness);

  const secondRootY = -halfLen * 0.58;
  const secondBackY = -halfLen * 0.72;
  const secondTipY = -halfLen * 0.63;
  const secondRootZ = latheBodyRadiusAt(secondRootY, profile) * BODY_HEIGHT_STRETCH * DORSAL_FIN_BURY_FRACTION;
  const secondBackZ = latheBodyRadiusAt(secondBackY, profile) * BODY_HEIGHT_STRETCH * DORSAL_FIN_BURY_FRACTION;
  const secondFinHeight = width * 0.225;
  const secondRoot = new THREE.Vector3(0, secondRootY, secondRootZ);
  const secondBack = new THREE.Vector3(0, secondBackY, secondBackZ);
  const secondTip = new THREE.Vector3(0, secondTipY, secondRootZ + secondFinHeight);
  const secondThickness = fishtankFinThickness(width);
  const secondFin = extrudeRingGeometryAlongX([secondRoot, secondBack, secondTip], secondThickness);

  return { mainFin, secondFin };
}

function buildDorsalFinsGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const { mainFin, secondFin } = buildDorsalFinParts(length, width, profile);
  return mergePositionOnlyGeometries([mainFin, secondFin]);
}

/**
 * A row of short, dark gill-slit accents on the flank just behind the
 * head — real sharks have five (occasionally six or seven) visible
 * slits, the other single biggest "this is a shark, not a generic fish"
 * identifying feature besides the tail. Each slit is a small solid box
 * set clearly outside the body's own surface (rather than straddling
 * it, which z-fights against the body mesh and reads as a flickering
 * dark smear instead of clean slits) and kept short/shallow so it just
 * grazes the flank as a subtle accent.
 */
function buildGillSlitsGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const slitCount = 5;
  const slitY = halfLen * 0.22; // just behind the head/shoulder taper, clear of the dorsal fin base
  const slitSpacingY = length * 0.028;
  const slitHeight = width * 0.16 * BODY_HEIGHT_STRETCH;
  const slitWidthY = length * 0.008;
  const slitDepthX = width * 0.03;

  const slits: THREE.BufferGeometry[] = [];
  for (let i = 0; i < slitCount; i++) {
    const y = slitY - i * slitSpacingY;
    // Anchor each slit to the body's actual (squashed) surface radius at its
    // own Y so the row hugs the tapering flank instead of floating off it,
    // pulled in just slightly (0.97) so the slits sit a touch tighter to the
    // body as a subtle accent.
    const flankX = latheBodyRadiusAt(y, profile) * BODY_SIDE_SQUASH * 0.95;
    for (const side of [1, -1] as const) {
      const slit = new THREE.BoxGeometry(slitDepthX, slitWidthY, slitHeight);
      slit.translate(flankX * side, y, 0);
      slits.push(slit);
    }
  }
  return mergePositionOnlyGeometries(slits);
}

/**
 * A modest, swept, pointed pectoral fin extending sideways and slightly
 * backward from near the gill region. `side` is +1 for the fin
 * extending toward +X (left) or -1 toward -X (right, mirrored). Rooted
 * with a slight forward offset (+Y) so it reads as attached just behind
 * the head rather than dead-center on the body. Built as a 4-point ring
 * (root -> leadingShoulder -> tip -> trailingSweep) extruded into a real
 * 3D prism via extrudeRingGeometry (this ring lies flat in the X/Y
 * plane, so — unlike the dorsal/caudal fins — the shared helper's own
 * Z-thickening axis is exactly the right one here) rather than a flat
 * zero-thickness pair of triangles, so it doesn't vanish when viewed
 * from directly above or below.
 */
function buildPectoralFinGeometry(length: number, span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const rootY = length * 0.06;
  const tipX = span * side;
  const leadingShoulderX = span * 0.32 * side;
  const trailingSweepX = span * 0.6 * side;
  const root = new THREE.Vector3(0, rootY, 0);
  const leadingShoulder = new THREE.Vector3(leadingShoulderX, rootY + chord * 0.15, 0);
  const tip = new THREE.Vector3(tipX, rootY - chord * 0.25, 0);
  const trailingSweep = new THREE.Vector3(trailingSweepX, rootY - chord * 0.75, 0);
  const thickness = fishtankFinThickness(chord);
  return extrudeRingGeometry([root, leadingShoulder, tip, trailingSweep], thickness);
}

// Fraction of raw (pre-SHARK_LENGTH_SCALE) creature length at which the
// caudal fin's root sits along local Y — essentially the body's own
// peduncle tip once SHARK_LENGTH_SCALE and the 0.97/0.5 halfLen math
// below are folded in.
//
// CAVEAT, because the comment this replaces got it wrong and cost someone a
// debugging session: this offset currently has NO effect on the sway. The
// tail sweeps about MODEL_UP (0,1,0) and this pivot differs from the origin
// only along Y — and a translation *along* the rotation axis commutes with
// the rotation, so pivoting here is mathematically identical to pivoting at
// the origin. The earlier claim that this fixed the fin's root sweeping out
// through the body was therefore never true; whatever fixed that, it wasn't
// this. It is still declared because it is the honest attachment point, and
// it would start mattering the moment the sway axis gained an X or Z
// component. Do not treat the number as a tuning knob: it isn't one, which
// is exactly the mistake that led to it being fed a fictional "reference
// length" of 4.0 instead of the shark's real length.
const SHARK_TAIL_PIVOT_FRACTION = -0.97 * 0.5 * SHARK_LENGTH_SCALE;

/** Local-Y position of the caudal fin's root/attachment point, given the
 * same `rawLength` passed to createSharkGeometries. */
function sharkTailPivotY(rawLength: number): number {
  return SHARK_TAIL_PIVOT_FRACTION * rawLength;
}

/**
 * A heterocercal caudal (tail) fin — a tall upper lobe and a much
 * smaller lower lobe, both swept back from the peduncle — the classic
 * asymmetric shark tail silhouette, unlike fishGeometry.ts's caudal fin
 * (whose two lobes fork left-right/X, matching a bony fish's vertical
 * tail blade viewed edge-on). A shark's tail asymmetry is a dorsoventral
 * (up/down, local Z) feature, not a left-right one, so this deliberately
 * builds the fork along Z instead — the single biggest visual cue that
 * reads as "shark tail" rather than "fish tail" from the tank's typical
 * side/three-quarter viewing angles.
 *
 * Rooted at the body's own peduncle tip (see buildSharkBodyGeometry's
 * profile, whose rearmost point sits at y = -halfLen) rather than the
 * model's local origin. An earlier attempt bridged the origin to this
 * root with an extra solid "stalk" merged into this same rotating part,
 * meaning to hide the seam — but since the tail-sway rotation swings the
 * *entire* tail part around the shared local origin, that stalk's own
 * far end (out near the peduncle tip, a significant distance from the
 * pivot) swept through just as wide an arc as the fin itself, so it
 * poked out through the side of the (non-rotating) body instead of
 * hiding inside it. The actual fix lives in updateInstances(): the tail
 * part's sway rotation is applied around *this fin's own root point*
 * (via SHARK_TAIL_PIVOT_FRACTION) rather than the shared origin, so the
 * root vertex built here stays perfectly still (matching the static
 * body's own peduncle tip) while only the fin fan beyond it visibly
 * swings — no stalk geometry needed at all. The fin fan itself is a
 * quadrilateral boundary (root -> upperTip -> notch -> lowerTip)
 * extruded into a real 3D prism via extrudeRingGeometryAlongX so it
 * doesn't vanish when viewed edge-on.
 */
function buildCaudalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const peduncleY = -halfLen * 0.97;

  const root = new THREE.Vector3(0, peduncleY, 0);
  const upperTip = new THREE.Vector3(0, -halfLen * 1.42, width * 0.95);
  const notch = new THREE.Vector3(0, -halfLen * 1.12, width * 0.08);
  const lowerTip = new THREE.Vector3(0, -halfLen * 1.22, -width * 0.4);
  const thickness = fishtankFinThickness(width);
  return extrudeRingGeometryAlongX([root, upperTip, notch, lowerTip], thickness);
}

export function createSharkFinThicknessSamples(rawLength: number, width: number): FinThicknessSample[] {
  const length = rawLength * SHARK_LENGTH_SCALE;
  const profile = buildSharkBodyProfile(length * 0.5, width);
  const finSpan = length * 0.32;
  const finChord = length * 0.2;
  const { mainFin, secondFin } = buildDorsalFinParts(length, width, profile);
  return [
    { label: 'main-dorsal', geometry: mainFin, referenceSize: width, thinAxis: 'x' },
    { label: 'second-dorsal', geometry: secondFin, referenceSize: width, thinAxis: 'x' },
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
    { label: 'caudal', geometry: buildCaudalFinGeometry(length, width), referenceSize: width, thinAxis: 'x' },
  ];
}
