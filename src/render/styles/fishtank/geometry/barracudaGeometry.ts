import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mergeGeometriesWithColor,
  buildEyeDotsGeometry,
} from '../../../geometry/sharedGeometry';
import { extrudeRingGeometryAlongX, latheBodyRadiusAt } from './fishSharedGeometry';

/**
 * Barracuda predator geometry (the normal fishtank predator): a very long,
 * near-cylindrical silver hunter with a sharply pointed pike head, a menacing
 * agape jaw (upper + underslung lower jaw with a dark mouth cavity and small
 * white fangs), a regular row of pale rectangular markings along the upper
 * flank, two small widely-separated spiky dorsal fins, and a deeply forked,
 * dark-tipped caudal tail. Deliberately distinct from sharkGeometry's stout
 * body + tall triangular dorsal + heterocercal tail so the normal/monster
 * predators read as separate species at a glance.
 *
 * Coloring strategy: the body bakes a dorsal-to-ventral vertex-color gradient
 * (dark steel back → bright silver flank → pale belly) that multiplies against
 * the per-instance silver base color, plus near-black accents (eyes, open-mouth
 * cavity) and bright near-white flank marks. The caudal fin bakes absolute
 * silver→near-black vertex colors so its lobe tips read dark independent of
 * the hunt-state body tint (the flat color path drives a color-baked tail with
 * a white instance color — see FlatColorApplicator).
 */
const BARRACUDA_LENGTH_SCALE = 1.35;
const BODY_SIDE_SQUASH = 0.8;
const BODY_HEIGHT_STRETCH = 1.0;

const EYE_COLOR = new THREE.Color(0x08070a);
const MOUTH_CAVITY_COLOR = new THREE.Color(0x0b0d10); // dark open-mouth interior
const FANG_COLOR = new THREE.Color(0xffffff); // small white teeth
const FLANK_MARK_COLOR = new THREE.Color(0xffffff); // pale rectangular flank marks
const LOWER_JAW_COLOR = new THREE.Color(0x8a949e); // gray underslung lower jaw

// Dorsal-to-ventral body gradient stops (multipliers against the silver base).
const BACK_COLOR = new THREE.Color(0x3d3f42); // dark neutral gray back + upper fins
const FLANK_COLOR = new THREE.Color(0xdfe6ec); // bright silver flank
const BELLY_COLOR = new THREE.Color(0xffffff); // pale silver belly

// Caudal fin absolute colors (silver root → near-black lobe tips).
const TAIL_ROOT_COLOR = new THREE.Color(0x9aa6b0);
const TAIL_TIP_COLOR = new THREE.Color(0x121417);

// Root of the caudal fin (local Y), as a fraction of raw input length.
const BARRACUDA_TAIL_PIVOT_FRACTION = -0.88 * 0.5 * BARRACUDA_LENGTH_SCALE;

export function getBarracudaTailPivotY(rawLength: number): number {
  return BARRACUDA_TAIL_PIVOT_FRACTION * rawLength;
}

export function createBarracudaGeometries(rawLength: number, width: number): CreatureGeometries {
  const length = rawLength * BARRACUDA_LENGTH_SCALE;
  const body = buildBarracudaBodyGeometry(length, width);
  const finSpan = length * 0.11;
  const finChord = length * 0.095;
  const wingLeft = buildPectoralFinGeometry(length, finSpan, finChord, 1);
  const wingRight = buildPectoralFinGeometry(length, finSpan, finChord, -1);
  const tail = buildCaudalFinGeometry(length, width);
  return { body, wingLeft, wingRight, tail };
}

/**
 * Slim, near-uniform body girth held well forward before tapering to a
 * pointed snout — the elongated pike silhouette of a barracuda, far leaner
 * than the shark's stout profile. The nose is left slightly blunt (last stop
 * doesn't collapse fully to a point) so the agape jaw has a mouth to open.
 * Authored tail(-Y) → nose(+Y).
 */
function buildBarracudaBodyProfile(halfLen: number, width: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, -halfLen * 1.0),
    new THREE.Vector2(width * 0.05, -halfLen * 0.9),
    new THREE.Vector2(width * 0.1, -halfLen * 0.72),
    new THREE.Vector2(width * 0.145, -halfLen * 0.5),
    new THREE.Vector2(width * 0.172, -halfLen * 0.22),
    new THREE.Vector2(width * 0.18, halfLen * 0.02),
    new THREE.Vector2(width * 0.172, halfLen * 0.26),
    new THREE.Vector2(width * 0.15, halfLen * 0.46),
    new THREE.Vector2(width * 0.118, halfLen * 0.64),
    new THREE.Vector2(width * 0.075, halfLen * 0.8),
    new THREE.Vector2(width * 0.04, halfLen * 0.92),
    new THREE.Vector2(0, halfLen * 1.0),
  ];
}

function buildBarracudaBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = buildBarracudaBodyProfile(halfLen, width);
  const body = new THREE.LatheGeometry(profile, 16);
  body.scale(BODY_SIDE_SQUASH, 1, BODY_HEIGHT_STRETCH);

  const dorsalFins = buildDorsalFinsGeometry(length, width, profile);
  // Base the countershading gradient on the BODY's own vertical extent, not the
  // merged shell: the dorsal fins rise well above the back, and if their tips
  // set maxZ the body gets squeezed into the pale belly→flank half and never
  // reaches the dark back color. Fins above the body's back simply clamp to it.
  body.computeBoundingBox();
  const bodyMinZ = body.boundingBox!.min.z;
  const bodyMaxZ = body.boundingBox!.max.z;
  const shell = bakeDorsalVentralGradient(
    mergePositionOnlyGeometries([body, dorsalFins]),
    bodyMinZ,
    bodyMaxZ,
  );

  const lowerJaw = buildLowerJawGeometry(length, width, profile);
  const mouthCavity = buildMouthCavityGeometry(length, width, profile);
  const fangs = buildFangsGeometry(length, width, profile);
  const flankMarks = buildFlankMarksGeometry(length, width, profile);

  const eyeY = halfLen * 0.66;
  const eyeSurfaceRadius = latheBodyRadiusAt(eyeY, profile);
  const eyeX = eyeSurfaceRadius * BODY_SIDE_SQUASH * 0.9; // just inside the flank
  const eyeZ = eyeSurfaceRadius * BODY_HEIGHT_STRETCH * 0.2; // slightly above the midline
  const eyeRadius = width * 0.03;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: shell, color: FLANK_COLOR },
    { geometry: lowerJaw, color: LOWER_JAW_COLOR },
    { geometry: flankMarks, color: FLANK_MARK_COLOR },
    { geometry: mouthCavity, color: MOUTH_CAVITY_COLOR },
    { geometry: fangs, color: FANG_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

/**
 * Bakes a dorsal(+Z, dark steel) → flank(silver) → belly(-Z, pale) vertex
 * color gradient onto a lathed body (plus its upper dorsal fins and jaws), so
 * the countershaded silver look survives the per-instance base-color multiply.
 */
function bakeDorsalVentralGradient(geometry: THREE.BufferGeometry, minZ: number, maxZ: number): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = nonIndexed.getAttribute('position');
  const span = maxZ - minZ || 1;
  const colors = new Float32Array(position.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getZ(i) - minZ) / span, 0, 1);
    if (t < 0.5) {
      tmp.copy(BELLY_COLOR).lerp(FLANK_COLOR, t / 0.5);
    } else {
      tmp.copy(FLANK_COLOR).lerp(BACK_COLOR, (t - 0.5) / 0.5);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (nonIndexed !== geometry) geometry.dispose();
  return nonIndexed;
}

/**
 * Two small, spiky, widely-separated dorsal fins — a short first dorsal near
 * mid-body and a smaller second dorsal set well back toward the tail. Both are
 * modest spikes rather than the shark's single tall triangular sail.
 */
function buildDorsalFinsGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const bury = 0.9;

  const firstFrontY = halfLen * 0.12;
  const firstBackY = -halfLen * 0.16;
  const firstFrontZ = latheBodyRadiusAt(firstFrontY, profile) * BODY_HEIGHT_STRETCH * bury;
  const firstBackZ = latheBodyRadiusAt(firstBackY, profile) * BODY_HEIGHT_STRETCH * bury;
  const firstTip = new THREE.Vector3(0, halfLen * 0.05, firstFrontZ + width * 0.26);
  const firstFin = extrudeRingGeometryAlongX(
    [new THREE.Vector3(0, firstFrontY, firstFrontZ), new THREE.Vector3(0, firstBackY, firstBackZ), firstTip],
    width * 0.05,
  );

  const secondFrontY = -halfLen * 0.5;
  const secondBackY = -halfLen * 0.78;
  const secondFrontZ = latheBodyRadiusAt(secondFrontY, profile) * BODY_HEIGHT_STRETCH * bury;
  const secondBackZ = latheBodyRadiusAt(secondBackY, profile) * BODY_HEIGHT_STRETCH * bury;
  const secondTip = new THREE.Vector3(0, -halfLen * 0.57, secondFrontZ + width * 0.17);
  const secondFin = extrudeRingGeometryAlongX(
    [new THREE.Vector3(0, secondFrontY, secondFrontZ), new THREE.Vector3(0, secondBackY, secondBackZ), secondTip],
    width * 0.045,
  );

  return mergePositionOnlyGeometries([firstFin, secondFin]);
}

// ---------------------------------------------------------------------------
// Agape jaw. The sleek lathed snout itself is the upper jaw (it already tapers
// to a point from every angle); the mouth is a small gape tucked under the
// front of the head — a short lower jaw dropped open, a dark cavity, and a
// couple of tiny fangs. The lower jaw is a tapered wedge with a V-keel
// underside so it stays pointed (not a blocky slab) from below, and tapers to
// a point in X at the front so the head still "curves in" from directly above.
// Y=+halfLen is forward (nose); +Z is up (dorsal); X is flank-to-flank.
// ---------------------------------------------------------------------------

const JAW_HINGE_Y_FRACTION = 0.84; // where the lower jaw meets the head
const LOWER_JAW_TIP_Y = 0.99; // lower jaw point sits just short of the snout tip
const MOUTH_FLOOR_Z = -0.06; // how far the open lower jaw drops below center
const MOUTH_ROOF_Z = -0.008; // underside of the upper jaw / snout (top of the cavity)
const MOUTH_CAVITY_FLOOR_Z = MOUTH_FLOOR_Z + 0.025; // top surface of the lower jaw (cavity floor)

/**
 * Builds a small convex solid from a point cloud and an explicit face list,
 * auto-orienting every triangle outward (centroid dot-product test, the same
 * robust trick used by extrudeRingGeometry) so it renders correctly under a
 * single-sided material regardless of the hand-authored winding.
 */
function buildConvexSolid(points: THREE.Vector3[], faces: Array<[number, number, number]>): THREE.BufferGeometry {
  const centroid = new THREE.Vector3();
  points.forEach((p) => centroid.add(p));
  centroid.divideScalar(points.length);
  const positions: number[] = [];
  for (const [a, b, c] of faces) {
    const p0 = points[a];
    const p1 = points[b];
    const p2 = points[c];
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(p1, p0),
      new THREE.Vector3().subVectors(p2, p0),
    );
    const triCentroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(triCentroid, centroid);
    if (normal.dot(outward) < 0) {
      positions.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p1.x, p1.y, p1.z);
    } else {
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A short lower jaw dropped open below the snout. Built as a solid: a triangular
 * top surface (the floor of the open mouth) with a chin bar that juts down and
 * forward near the front, while the back edge stays flush at body level so the
 * jaw blends smoothly into the throat instead of ending in a squared-off wall.
 * Deepest at the chin, tapering up to nothing at the hinge — genuine 3D volume,
 * solid from below, pointed from above.
 */
function buildLowerJawGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const hingeY = halfLen * JAW_HINGE_Y_FRACTION;
  const tipY = halfLen * LOWER_JAW_TIP_Y;
  const hw = latheBodyRadiusAt(hingeY, profile) * BODY_SIDE_SQUASH * 0.92;
  const zTop = width * MOUTH_CAVITY_FLOOR_Z; // top surface = floor of the mouth
  const zChin = width * (MOUTH_FLOOR_Z - 0.012); // chin hangs lowest, near the front

  const tipTop = new THREE.Vector3(0, tipY, zTop);
  const topL = new THREE.Vector3(hw, hingeY, zTop);
  const topR = new THREE.Vector3(-hw, hingeY, zTop);
  const chinY = tipY - halfLen * 0.05;
  const chinL = new THREE.Vector3(hw * 0.55, chinY, zChin);
  const chinR = new THREE.Vector3(-hw * 0.55, chinY, zChin);

  return buildConvexSolid(
    [tipTop, topL, topR, chinL, chinR],
    [
      [0, 1, 2], // top (mouth floor)
      [0, 1, 3], // left upper
      [0, 2, 4], // right upper
      [0, 3, 4], // front underside
      [1, 2, 4], [1, 4, 3], // back underside, sweeping up to the hinge
    ],
  );
}

/**
 * The dark interior of the open mouth — a genuine 3D wedge volume filling the
 * gape between the snout underside (roof) and the lower jaw (floor). It tapers
 * to a point at the front so the head still reads pointed, but has real depth in
 * Z so the shadowed cavity is visible from every angle (side, front, and below),
 * not just as a flat sheet from one direction.
 */
function buildMouthCavityGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const hingeY = halfLen * JAW_HINGE_Y_FRACTION;
  const tipY = halfLen * 0.93; // kept well back so it stays enclosed by the snout
  const hw = latheBodyRadiusAt(hingeY, profile) * BODY_SIDE_SQUASH * 0.6;
  const hwTip = latheBodyRadiusAt(tipY, profile) * BODY_SIDE_SQUASH * 0.55;
  const zRoof = width * MOUTH_ROOF_Z;
  const zFloor = width * MOUTH_CAVITY_FLOOR_Z;
  const zTipMid = width * (MOUTH_CAVITY_FLOOR_Z + MOUTH_ROOF_Z) * 0.5;

  const tipTop = new THREE.Vector3(hwTip, tipY, zRoof);
  const tipBot = new THREE.Vector3(0, tipY, zTipMid);
  const tipTopR = new THREE.Vector3(-hwTip, tipY, zRoof);
  const roofL = new THREE.Vector3(hw, hingeY, zRoof);
  const roofR = new THREE.Vector3(-hw, hingeY, zRoof);
  const floorL = new THREE.Vector3(hw * 0.9, hingeY, zFloor);
  const floorR = new THREE.Vector3(-hw * 0.9, hingeY, zFloor);

  return buildConvexSolid(
    [tipBot, roofL, roofR, floorL, floorR, tipTop, tipTopR],
    [
      [5, 1, 2], [5, 2, 6], // roof (under the snout)
      [0, 4, 3], // floor (top of the lower jaw)
      [0, 3, 5], [5, 3, 1], // left wall
      [0, 6, 4], [6, 2, 4], // right wall
      [1, 3, 4], [1, 4, 2], // back opening
    ],
  );
}

/**
 * A couple of small white fangs at the mouth — one row hanging down from the
 * upper jaw, one row pointing up from the lower jaw, interlocking inside the
 * gape. Kept short and set inside the cavity so bases stay embedded in the jaws
 * and only the tips read, the barracuda's signature interlocking teeth.
 */
function buildFangsGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const teeth: THREE.BufferGeometry[] = [];
  const toothLen = width * 0.024;
  const toothThick = width * 0.008;
  const zRoof = width * MOUTH_ROOF_Z;
  const zFloor = width * MOUTH_CAVITY_FLOOR_Z;
  const upperY = halfLen * 0.96;
  const lowerY = halfLen * 0.965;
  const upperHw = latheBodyRadiusAt(upperY, profile) * BODY_SIDE_SQUASH * 0.5;
  for (const side of [1, -1] as const) {
    const upper = new THREE.ConeGeometry(toothThick, toothLen, 4);
    upper.rotateX(-Math.PI / 2); // aim down (-Z), into the gape
    upper.translate(upperHw * side, upperY, zRoof - toothLen * 0.3);
    teeth.push(upper);

    const lower = new THREE.ConeGeometry(toothThick, toothLen, 4);
    lower.rotateX(Math.PI / 2); // aim up (+Z), into the gape
    lower.translate(upperHw * 0.85 * side, lowerY, zFloor + toothLen * 0.3);
    teeth.push(lower);
  }
  return mergePositionOnlyGeometries(teeth);
}

/**
 * A regular row of small pale rectangular markings running along the upper
 * flank, from a little in front of the tail forward to the leading edge of
 * the first dorsal fin — the evenly-spaced light blotches visible in the
 * reference photo. Mirrored on both flanks.
 */
function buildFlankMarksGeometry(length: number, width: number, profile: THREE.Vector2[]): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const marks: THREE.BufferGeometry[] = [];
  const startYf = -0.64; // a little in front of the tail
  const endYf = 0.16; // front of the first dorsal fin
  const count = 8;
  for (let i = 0; i < count; i++) {
    const yf = startYf + ((endYf - startYf) * i) / (count - 1);
    const y = halfLen * yf;
    const radius = latheBodyRadiusAt(y, profile);
    const flankX = radius * BODY_SIDE_SQUASH * 0.86;
    const z = radius * BODY_HEIGHT_STRETCH * 0.5; // upper flank, near the lateral line
    for (const side of [1, -1] as const) {
      const mark = new THREE.BoxGeometry(width * 0.02, length * 0.028, width * 0.05 * BODY_HEIGHT_STRETCH);
      mark.translate(flankX * side, y, z);
      marks.push(mark);
    }
  }
  return mergePositionOnlyGeometries(marks);
}

function buildPectoralFinGeometry(length: number, span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const rootY = length * 0.24;
  const tipX = span * side;
  const leadingShoulder = new THREE.Vector3(span * 0.34 * side, rootY + chord * 0.1, 0);
  const tip = new THREE.Vector3(tipX, rootY - chord * 0.3, 0);
  const trailingSweep = new THREE.Vector3(span * 0.6 * side, rootY - chord * 0.78, 0);
  const root = new THREE.Vector3(0, rootY, 0);
  return extrudeRingGeometry([root, leadingShoulder, tip, trailingSweep], chord * 0.06);
}

/**
 * A deeply forked, symmetric caudal fin with dark lobe tips baked in as
 * absolute vertex colors (silver near the peduncle → near-black at the two
 * points), matching the reference barracuda's blackish tail.
 */
function buildCaudalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const peduncleY = -halfLen * 0.88;
  const root = new THREE.Vector3(0, peduncleY, 0);
  const upperTip = new THREE.Vector3(0, -halfLen * 1.6, width * 0.36);
  const notch = new THREE.Vector3(0, -halfLen * 1.32, 0);
  const lowerTip = new THREE.Vector3(0, -halfLen * 1.6, -width * 0.36);
  const fin = extrudeRingGeometryAlongX([root, upperTip, notch, lowerTip], width * 0.05);
  return bakeCaudalTipColors(fin, peduncleY, halfLen * 1.6);
}

/**
 * Bakes absolute silver→near-black colors onto the caudal fin by how far each
 * vertex sits below the peduncle (root silver, lobe tips dark).
 */
function bakeCaudalTipColors(geometry: THREE.BufferGeometry, rootY: number, tipDepth: number): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = nonIndexed.getAttribute('position');
  const span = Math.abs(-tipDepth - rootY) || 1;
  const colors = new Float32Array(position.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((rootY - position.getY(i)) / span, 0, 1);
    tmp.copy(TAIL_ROOT_COLOR).lerp(TAIL_TIP_COLOR, THREE.MathUtils.smoothstep(t, 0.15, 1));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (nonIndexed !== geometry) geometry.dispose();
  return nonIndexed;
}
