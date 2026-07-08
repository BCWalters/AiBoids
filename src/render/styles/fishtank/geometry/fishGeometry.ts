import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  buildEyeDotsGeometry,
} from '../../../geometry/creatureGeometry';

// Fish tank style: originally a duplicate of nature's birdGeometry.ts;
// createFishGeometries (the function actually used for the
// small-species instances — see Renderer3D's createFishtankFishGeometries
// alias) has since been reskinned below into a real small-fish silhouette
// (laterally-compressed torpedo body, dorsal fin, forked caudal fin,
// small paddle-shaped pectoral fins) instead of the bird shape it started
// as. createArcadeFishGeometries and buildWingGeometry below are unused
// leftovers from that original duplicate, kept only in case a future
// arcade+fishtank combination needs them.
/**
 * Builds a simple low-poly bird silhouette: an elongated diamond body
 * (nose pointing along local +Y, matching the orientation convention used
 * elsewhere in Renderer3D) plus a pair of flat, swept-back triangular
 * wings that extend sideways from the body's origin. Wings are separate
 * geometries (rather than baked into the body) so each can be given its
 * own per-instance flap rotation in the render loop.
 */
export function createArcadeFishGeometries(length: number, width: number): CreatureGeometries {
  const body = new THREE.OctahedronGeometry(1, 0);
  body.scale(width, length, width);

  const wingSpan = length * 1.1;
  const wingChord = length * 0.55;

  const wingLeft = buildWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildWingGeometry(wingSpan, wingChord, -1);

  return { body, wingLeft, wingRight };
}


/**
 * A flat triangular wing rooted at the origin, extending along the X axis.
 * `side` is +1 for the wing extending toward +X (left) or -1 toward -X
 * (right, mirrored). Swept back slightly (negative Y) for a more natural
 * silhouette than a plain rectangle.
 */
function buildWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const tipX = span * side;
  const positions = new Float32Array([
    0, 0, 0, // root, at the body's pivot
    tipX, -chord * 0.5, 0, // swept-back tip
    tipX * 0.45, chord * 0.35, 0, // leading-edge shoulder point
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}


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
 * slightly flattened egg". Built via extrudeRingGeometry (rather than a
 * flat zero-thickness plane) so it keeps its silhouette instead of
 * vanishing when viewed exactly edge-on from the front or back.
 */
function buildDorsalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const finHeight = width * 0.9;
  const root = new THREE.Vector3(0, halfLen * 0.05, width * 0.3 * BODY_HEIGHT_STRETCH);
  const back = new THREE.Vector3(0, -halfLen * 0.35, width * 0.32 * BODY_HEIGHT_STRETCH);
  const tip = new THREE.Vector3(0, -halfLen * 0.12, width * 0.3 * BODY_HEIGHT_STRETCH + finHeight);
  const thickness = width * 0.05;
  return extrudeRingGeometry([root, back, tip], thickness);
}

/**
 * A small paddle/kite-shaped pectoral fin extending sideways from near
 * the body's origin. `side` is +1 for the fin extending toward +X (left)
 * or -1 toward -X (right, mirrored). Rooted with a slight forward offset
 * (+Y) so it reads as attached near the "gills", ahead of the body's
 * center, rather than dead-center like the wings this replaced. Built as
 * a 4-point kite (root -> leadingBulge -> tip -> trailingBulge, fanned
 * from the root) rather than a single thin 3-point spike, so it reads as
 * a rounded paddle rather than a sharp antenna/spike at small scale.
 */
function buildPectoralFinGeometry(length: number, span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const rootY = length * 0.12;
  const geometry = new THREE.BufferGeometry();
  const tipX = span * side;
  const leadingBulgeX = span * 0.55 * side;
  const trailingBulgeX = span * 0.45 * side;
  const positions = new Float32Array([
    // triangle 1: root -> leading bulge -> tip
    0, rootY, 0,
    leadingBulgeX, rootY + chord * 0.4, 0,
    tipX, rootY - chord * 0.1, 0,
    // triangle 2: root -> tip -> trailing bulge
    0, rootY, 0,
    tipX, rootY - chord * 0.1, 0,
    trailingBulgeX, rootY - chord * 0.5, 0,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * A wing with a solid inner panel plus a fan of thin, separated triangular
 * "finger" feathers at the tip (rooted along the outer trailing edge, each
 * angled slightly differently) — the visual cue that reads as "wingtip
 * primary feathers" on a soaring bird of prey.
 */
export function buildFingeredWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const lerp3 = (a: number[], b: number[], t: number) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  const mainSpan = span * 0.72;
  const root = [0, 0, 0];
  const tip = [mainSpan * s, -chord * 0.4, 0];
  const shoulder = [mainSpan * 0.42 * s, chord * 0.42, 0];
  pushTri(root, shoulder, tip);

  // fingerCount raised from 5->6 and each feather now has an explicit,
  // deliberate gap to its neighbors (rather than nearly-touching bases)
  // so individual feathers read as separate shapes rather than one solid
  // scalloped edge — closer to a real fanned primary-feather look.
  const fingerCount = 6;
  const innerAnchor = [mainSpan * 0.5 * s, -chord * 0.1, 0];
  const outerAnchor = tip;
  const halfWidth = 0.075;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const rootPt = lerp3(innerAnchor, outerAnchor, Math.max(0, t - halfWidth));
    const rootPt2 = lerp3(innerAnchor, outerAnchor, Math.min(1, t + halfWidth));
    // Lengthened back up from the prior pass (which overcorrected to
    // 0.08-0.25*span and read as "fingering effect gone" — barely
    // visible against the solid main panel). Longest (outermost) feather
    // now reaches almost exactly to the wing's own nominal total span
    // (mainSpan 0.72 + 0.28 = 1.0*span) rather than needle-spiking well
    // past it (the old 0.3-0.42*span bug) or staying tucked well inside
    // it (barely past the main panel's own edge).
    const fingerLen = span * (0.12 + 0.16 * t);
    const spreadRad = ((-16 + 42 * t) * Math.PI) / 180;

    const baseDirX = s;
    const baseDirY = -0.55;
    const mag = Math.hypot(baseDirX, baseDirY);
    const dx = baseDirX / mag;
    const dy = baseDirY / mag;
    const rot = spreadRad * s;
    const rdx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const rdy = dx * Math.sin(rot) + dy * Math.cos(rot);
    const tipPt = [rootPt[0] + rdx * fingerLen, rootPt[1] + rdy * fingerLen, 0];

    pushTri(rootPt, rootPt2, tipPt);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
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

