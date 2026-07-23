import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  buildEyeDotsGeometry,
} from '../../../geometry/sharedGeometry';
import { extrudeRingGeometryAlongX } from './fishSharedGeometry';

// Fish tank style: createFishGeometries builds the small-fish silhouette
// used for the small-species instances (see Renderer3D's
// createFishtankFishGeometries alias): a laterally-compressed torpedo
// body, dorsal fin, forked caudal fin, and small paddle-shaped pectoral
// fins.

/**
 * Small-fish geometry: a laterally-compressed (taller than it is wide,
 * seen head-on), torpedo-shaped lathed body with a triangular dorsal fin
 * baked onto its back, a pair of small paddle-shaped pectoral fins (using
 * the wingLeft/wingRight slots so they get the existing per-instance
 * flap animation — reads as a paddling/steering motion), and a forked
 * caudal (tail) fin. Replaces the small-bird silhouette this file started
 * as (see the file-level comment above).
 */
export function createFishGeometries(length: number, width: number): CreatureGeometries {
  const body = buildFishBodyGeometry(length, width);

  // Deliberately small relative to body length — real pectoral fins are
  // modest paddles, not another pair of wings. An earlier pass sized
  // these off `width` (finSpan = width * 1.6) which, once width was
  // itself boosted for the fishtank species' fatter proportions, made
  // the fins nearly as long as the whole body and read as spiky
  // antennae rather than fins.
  const finSpan = length * 0.3;
  const finChord = length * 0.26;
  const wingLeft = buildPectoralFinGeometry(length, finSpan, finChord, 1);
  const wingRight = buildPectoralFinGeometry(length, finSpan, finChord, -1);

  const tail = buildCaudalFinGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}


/**
 * Radially-symmetric (lathed) torpedo body profile: nose points along
 * local +Y to match FORWARD_AXIS, tapering to a slender peduncle (the
 * narrow "handle" a real fish's tail fin attaches to) at -Y. A lathe
 * alone produces a body round in cross-section (equally wide as it is
 * tall); real fish read as fish rather than "a floating egg" mostly
 * because they're laterally compressed — noticeably taller (dorsal-to-
 * ventral) than they are wide (side-to-side) — so BODY_SIDE_SQUASH/
 * BODY_HEIGHT_STRETCH apply that compression as a non-uniform scale
 * after the lathe (X is the model's local left-right axis, Z is local
 * up — see MODEL_RIGHT_AXIS/MODEL_UP_AXIS in Renderer3D.ts). A dorsal
 * fin (see buildDorsalFinGeometry) and a pair of near-black eye dots are
 * merged onto the body afterward, same trick as the small-bird geometry
 * this replaced.
 */
const BODY_SIDE_SQUASH = 0.62; // narrower side-to-side
const BODY_HEIGHT_STRETCH = 1.3; // taller dorsal-to-ventral

function buildFishBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.05, -halfLen * 1.0), // peduncle tip, where the caudal fin attaches
    new THREE.Vector2(width * 0.14, -halfLen * 0.82), // slender peduncle
    new THREE.Vector2(width * 0.32, -halfLen * 0.55), // rear body widening
    new THREE.Vector2(width * 0.46, -halfLen * 0.2), // widest point, just behind center
    new THREE.Vector2(width * 0.44, halfLen * 0.12), // shoulder, just past center
    new THREE.Vector2(width * 0.3, halfLen * 0.45), // head taper begins
    new THREE.Vector2(width * 0.16, halfLen * 0.68), // snout base
    new THREE.Vector2(width * 0.05, halfLen * 0.85), // blunt nose tip
  ];
  const body = new THREE.LatheGeometry(profile, 14);
  body.scale(BODY_SIDE_SQUASH, 1, BODY_HEIGHT_STRETCH);

  const dorsalFin = buildDorsalFinGeometry(length, width);

  const eyeY = halfLen * 0.62;
  const eyeX = width * 0.22 * BODY_SIDE_SQUASH;
  const eyeZ = width * 0.08 * BODY_HEIGHT_STRETCH;
  const eyeRadius = width * 0.055;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: mergePositionOnlyGeometries([body, dorsalFin]), color: WHITE_VERTEX_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

// Near-black eye baked onto every small-fish species' head — stays
// visually correct under any per-species per-instance body tint multiply
// (near-black stays near-black regardless of what it's multiplied
// against), same trick as the small-bird geometry it replaced.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);

/**
 * A single triangular dorsal fin standing up (+Z, the model's local "up")
 * from the fish's back, roughly over the widest part of the body — the
 * single most important silhouette cue that separates "a fish" from "a
 * slightly flattened egg". Built via extrudeRingGeometryAlongX rather
 * than the shared (Z-axis) extrudeRingGeometry or a flat zero-thickness
 * plane: this fin's ring lies in the Y-Z plane (every point has X=0), so
 * it needs thickness added along X (flank-to-flank) to keep a visible
 * silhouette from any angle — Z-axis extrusion would only nudge its
 * already-dominant Y/Z shape, leaving it just as vanishingly thin when
 * viewed edge-on from the front or back (the same bug the shark's dorsal
 * fin had before this fix — see sharkGeometry.ts's history).
 */
function buildDorsalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const finHeight = width * 0.9;
  const root = new THREE.Vector3(0, halfLen * 0.05, width * 0.3 * BODY_HEIGHT_STRETCH);
  const back = new THREE.Vector3(0, -halfLen * 0.35, width * 0.32 * BODY_HEIGHT_STRETCH);
  const tip = new THREE.Vector3(0, -halfLen * 0.12, width * 0.3 * BODY_HEIGHT_STRETCH + finHeight);
  const thickness = width * 0.12;
  return extrudeRingGeometryAlongX([root, back, tip], thickness);
}

/**
 * A small paddle/kite-shaped pectoral fin extending sideways from near
 * the body's origin. `side` is +1 for the fin extending toward +X (left)
 * or -1 toward -X (right, mirrored). Rooted with a slight forward offset
 * (+Y) so it reads as attached near the "gills", ahead of the body's
 * center, rather than dead-center like the wings this replaced. Built as
 * a 4-point kite (root -> leadingBulge -> tip -> trailingBulge, fanned
 * from the root) extruded into a real 3D prism via extrudeRingGeometry
 * (this ring lies flat in the X/Y plane, so the shared helper's own
 * Z-thickening axis is exactly the right one here) rather than a flat
 * zero-thickness pair of triangles, so it doesn't vanish when viewed
 * from directly above or below — the same fix applied to the shark's
 * pectoral fins.
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
 * A forked caudal (tail) fin trailing behind the body (toward local -Y),
 * built from a quadrilateral boundary (root -> upperTip -> notch ->
 * lowerTip) extruded into a real 3D prism via extrudeRingGeometry — reads
 * as a forked fish tail from a distance, but (unlike a flat zero-
 * thickness plane) doesn't disappear when viewed edge-on from directly
 * the side. `notch` is pulled forward toward the root (rather than out
 * to the tips, as the bird tail-fan this replaces did) to cut a V-shaped
 * notch into the trailing edge — the classic forked-tail silhouette.
 * extrudeRingGeometry triangulates this quad via the diagonal from
 * `root` to `notch`, which correctly handles `notch` being a reflex
 * (concave) vertex. Static (does not flap).
 */
function buildCaudalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const root = new THREE.Vector3(0, 0, 0);
  const upperTip = new THREE.Vector3(-width * 0.85, -length * 0.5, 0);
  const lowerTip = new THREE.Vector3(width * 0.85, -length * 0.5, 0);
  const notch = new THREE.Vector3(0, -length * 0.18, 0);
  const thickness = width * 0.05;

  return extrudeRingGeometry([root, upperTip, notch, lowerTip], thickness);
}

