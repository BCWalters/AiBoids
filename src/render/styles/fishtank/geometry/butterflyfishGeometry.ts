import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import {
  extrudeRingGeometry,
  extrudeRingGeometryAlongX,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  bakeVerticalStripeColors,
  buildEyeDotsGeometry,
  latheBodyRadiusAt,
} from '../../../geometry/creatureGeometry';

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
  const profile = buildButterflyfishBodyProfile(halfLen, width);
  const body = new THREE.LatheGeometry(profile, 16);
  body.scale(BODY_SIDE_SQUASH, 1, BODY_HEIGHT_STRETCH);

  const dorsalFin = buildDorsalFinGeometry(halfLen, width, profile);
  const analFin = buildAnalFinGeometry(halfLen, width, profile);

  // Stripes are baked across body + fins together (rather than the body
  // alone) so the banding reads as continuing naturally into the
  // dorsal/anal finnage instead of stopping abruptly at the body's own
  // silhouette edge — real butterflyfish striping often does exactly
  // this. halfLen (not the fins' own, slightly different Y extents)
  // anchors the band boundaries since every part shares the same
  // model-local Y axis/scale.
  const merged = mergePositionOnlyGeometries([body, dorsalFin, analFin]);
  const striped = bakeVerticalStripeColors(merged, halfLen, STRIPE_COUNT, WHITE_VERTEX_COLOR, STRIPE_BAND_COLOR);

  const eyeY = halfLen * 0.72;
  const eyeX = width * 0.16 * BODY_SIDE_SQUASH;
  const eyeZ = width * 0.1 * BODY_HEIGHT_STRETCH;
  const eyeRadius = width * 0.06;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: striped, color: WHITE_VERTEX_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
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
function buildDorsalFinGeometry(halfLen: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const buryFraction = 0.9; // slightly buried below the surface, same trick as the shark's dorsal fins
  const finHeight = width * 0.34;

  const frontRootY = halfLen * 0.3;
  const backRootY = -halfLen * 0.6;
  const frontRootZ = latheBodyRadiusAt(frontRootY, profile) * BODY_HEIGHT_STRETCH * buryFraction;
  const backRootZ = latheBodyRadiusAt(backRootY, profile) * BODY_HEIGHT_STRETCH * buryFraction;

  const frontRoot = new THREE.Vector3(0, frontRootY, frontRootZ);
  const backRoot = new THREE.Vector3(0, backRootY, backRootZ);
  // Peaks higher near the front-middle, tapering back down toward the
  // tail — a real butterflyfish's dorsal fin silhouette.
  const backTip = new THREE.Vector3(0, backRootY + halfLen * 0.1, backRootZ + finHeight * 0.55);
  const frontTip = new THREE.Vector3(0, frontRootY - halfLen * 0.05, frontRootZ + finHeight);

  const thickness = width * 0.05;
  return extrudeRingGeometryAlongX([frontRoot, backRoot, backTip, frontTip], thickness);
}

/**
 * The anal (ventral) fin — a shorter, mirrored counterpart to the dorsal
 * fin along the belly, real butterflyfish's other prominent sail-like
 * fin. Shorter front-to-back and shallower than the dorsal fin (a real
 * anal fin base is noticeably smaller than the dorsal one), rooted the
 * same flush-to-surface way.
 */
function buildAnalFinGeometry(halfLen: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const buryFraction = 0.9;
  const finHeight = width * 0.24;

  const frontRootY = halfLen * 0.0;
  const backRootY = -halfLen * 0.55;
  const frontRootZ = -latheBodyRadiusAt(frontRootY, profile) * BODY_HEIGHT_STRETCH * buryFraction;
  const backRootZ = -latheBodyRadiusAt(backRootY, profile) * BODY_HEIGHT_STRETCH * buryFraction;

  const frontRoot = new THREE.Vector3(0, frontRootY, frontRootZ);
  const backRoot = new THREE.Vector3(0, backRootY, backRootZ);
  const backTip = new THREE.Vector3(0, backRootY + halfLen * 0.08, backRootZ - finHeight * 0.6);
  const frontTip = new THREE.Vector3(0, frontRootY - halfLen * 0.05, frontRootZ - finHeight);

  const thickness = width * 0.05;
  return extrudeRingGeometryAlongX([frontRoot, backRoot, backTip, frontTip], thickness);
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
  const tipX = span * side;
  const leadingBulgeX = span * 0.55 * side;
  const trailingBulgeX = span * 0.45 * side;
  const root = new THREE.Vector3(0, rootY, 0);
  const leadingBulge = new THREE.Vector3(leadingBulgeX, rootY + chord * 0.35, 0);
  const tip = new THREE.Vector3(tipX, rootY - chord * 0.1, 0);
  const trailingBulge = new THREE.Vector3(trailingBulgeX, rootY - chord * 0.5, 0);
  const thickness = chord * 0.08;
  return extrudeRingGeometry([root, leadingBulge, tip, trailingBulge], thickness);
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
  const thickness = width * 0.05;
  return extrudeRingGeometryAlongX([root, upperTip, midOut, lowerTip], thickness);
}
