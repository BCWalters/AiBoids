import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import {
  mergeGeometriesWithColor,
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
} from '../../../geometry/creatureGeometry';

/**
 * Parrot-specific geometry — split out from the shared "realistic bird"
 * builder (birdGeometry.ts, still used by hawks/sparrows/goldfinch/
 * cardinal/bluejay) so a macaw-style silhouette (large curved hooked
 * beak, compact rounded body, long trailing tail streamers, broad
 * rounded wings) can be iterated on independently without touching the
 * small-songbird shape. Wings are also parrot-specific (see
 * buildParrotWingGeometry below): the shared birdGeometry.ts wing is
 * shaped like a swept, pointed falcon/hawk wing, which combined with a
 * parrot's bright saturated color patterns read as a solid "shark fin"
 * rather than a bird wing — a broader, rounder paddle-shaped wing
 * (closer to a real parrot's) reads much better.
 */

// Beaks read as dark gray/black on virtually every parrot species — baked
// as a per-vertex tint (multiplied against whatever bright per-instance
// body color a given macaw color-pattern uses, see Renderer3D's
// getParrotColors) rather than left the same white-vertex default as the
// rest of the body.
const BEAK_COLOR = new THREE.Color(0x23201c);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
const FACE_PATCH_COLOR = new THREE.Color(0xe6ded1);
const BACK_REGION_COLOR = new THREE.Color(0x6d88c2);
const BELLY_REGION_COLOR = new THREE.Color(0xf2bf84);
const WING_FRONT_COLOR = new THREE.Color(0xf6c187);
const WING_REAR_COLOR = new THREE.Color(0x6a84bc);
// Near-black eye dots — stay near-black under any per-instance body tint
// multiply (see the multiply-color reasoning in unicornGeometry.ts), so
// this single baked color works correctly across every macaw color
// pattern in PARROT_COLOR_PATTERNS.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const PARROT_EYE_SIDE_ANGLE_DEG = 70;
const PARROT_BODY_LATHE_SEGMENTS = 24;

export function createParrotGeometries(length: number, width: number): CreatureGeometries {
  const body = buildParrotBodyGeometry(length, width);

  // Parrots have proportionally broader, more paddle-shaped wings than a
  // soaring hawk (built for short powerful flaps through canopy, not
  // long glides) — see buildParrotWingGeometry for the shape itself.
  const wingSpan = length * 1.05;
  const wingChord = length * 0.58;
  const wingLeft = buildParrotWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildParrotWingGeometry(wingSpan, wingChord, -1);

  const tail = buildParrotTailGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}

/**
 * Compact, rounded lathed torso topped with a distinctly separate,
 * rounded head (its own bulge, connected via a real pinched neck rather
 * than one continuous blob) plus a large, prominently protruding curved
 * hooked beak — the single most important visual cue for reading
 * "parrot" rather than "vaguely bird-shaped blob". Earlier passes had
 * the beak too short/subtle: it read as a tiny stub half-swallowed by
 * the head's own silhouette from most angles instead of a clearly
 * visible hooked beak. The beak length and the neck pinch depth are both
 * pushed noticeably further here so the head+beak silhouette reads
 * unambiguously as a parrot face from any side-on viewing angle.
 */
// Same head-narrowing/lengthening treatment requested for the small-bird
// species (see birdGeometry.ts's HEAD_NARROW_SCALE/HEAD_LENGTHEN_SCALE
// doc comment) applied here too, for visual consistency across all three
// bird shapes — 25% narrower, 10% longer, pivoting at the neck pinch so
// only the head region (not the neck/torso below it) stretches.
const HEAD_NARROW_SCALE = 0.78;
const HEAD_LENGTHEN_SCALE = 1.12;
const HEAD_START_FRAC = 0.38; // neck pinch
const HEAD_END_FRAC = HEAD_START_FRAC + (0.9 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face point (was faceY = halfLen*0.9)

function buildParrotBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  // Face radius kept smaller than the head-crown bulge (a real, if
  // gentle, step down) so the head reads as a rounded mass with a
  // distinctly narrower face the beak grows out of, rather than the
  // beak's base being the same girth as the whole skull.
  const faceRadius = width * 0.16 * HEAD_NARROW_SCALE;
  const faceY = halfLen * HEAD_END_FRAC;
  const profile = [
    new THREE.Vector2(width * 0.045, -halfLen * 0.95), // tail-root taper
    new THREE.Vector2(width * 0.21, -halfLen * 0.65),
    new THREE.Vector2(width * 0.4, -halfLen * 0.2), // belly bulge, rounder than a hawk's — trimmed slightly narrower
    new THREE.Vector2(width * 0.37, halfLen * 0.12), // chest — trimmed slightly narrower
    // Head reworked to be noticeably taller (a longer Y-span from neck
    // pinch to face) relative to its radius than the previous profile —
    // that version spanned only ~0.38*halfLen in Y against a ~0.46*width
    // peak radius, an oblate-spheroid ratio that read as a flat, wide
    // "smooshed"/Lego-brick head rather than a rounded skull. Pushing the
    // neck pinch earlier and the face further out (plus trimming the
    // peak radius down a touch) roughly doubles that span:radius ratio.
    // Every radius/position past this point is additionally scaled by
    // HEAD_NARROW_SCALE/HEAD_LENGTHEN_SCALE above.
    new THREE.Vector2(width * 0.24, halfLen * HEAD_START_FRAC), // real pinched neck — widened a bit on its own (not the head/body) so it doesn't read as pinched to a thread
    new THREE.Vector2(width * 0.32 * HEAD_NARROW_SCALE, halfLen * headFrac(0.5)), // head base, bulging back out past the neck pinch
    new THREE.Vector2(width * 0.37 * HEAD_NARROW_SCALE, halfLen * headFrac(0.62)), // crown — the widest point of the head
    new THREE.Vector2(width * 0.3 * HEAD_NARROW_SCALE, halfLen * headFrac(0.74)), // forehead, narrowing toward the face
    new THREE.Vector2(width * 0.22 * HEAD_NARROW_SCALE, halfLen * headFrac(0.84)), // brow, just above the eyes
    new THREE.Vector2(faceRadius, faceY), // face, where the beak attaches
  ];
  const torso = new THREE.LatheGeometry(profile, PARROT_BODY_LATHE_SEGMENTS);
  tintParrotTorsoRegions(torso, halfLen);

  // Two-part macaw beak: a large, strongly hooked upper mandible that
  // overhangs a shorter, triangular lower mandible with a slight gape.
  const beak = buildSolidParrotBeakGeometry(faceY, faceRadius, length * 0.29);

  // Close both open lathe ends so no line-of-sight can pass through the
  // hollow body cavity from the beak junction to the rear opening.
  const faceCap = buildDoubleSidedDiskCap(faceY + length * 0.01, faceRadius * 1.16, 18);
  const rearCap = buildDoubleSidedDiskCap(-halfLen * 0.95, width * 0.07, 12);

  // Keep one internal filler behind the face cap so the beak/body
  // junction never reveals the lathe cavity from front angles.
  const beakSocketFill = new THREE.SphereGeometry(faceRadius * 1.2, 12, 10);
  beakSocketFill.scale(1.06, 0.94, 0.86);
  beakSocketFill.translate(0, faceY - length * 0.004, -length * 0.02);

  const eyeY = halfLen * headFrac(0.78);
  const eyeX = width * 0.255 * HEAD_NARROW_SCALE;
  const eyeZ = width * 0.06 * HEAD_NARROW_SCALE;
  const eyeRing = buildParrotEyeDisks(eyeX, eyeY, eyeZ, width * 0.078 * HEAD_NARROW_SCALE, width * 0.012);
  const pupils = buildParrotEyeDisks(eyeX, eyeY, eyeZ, width * 0.038 * HEAD_NARROW_SCALE, width * 0.016);

  return mergeGeometriesWithColor([
    { geometry: torso, color: WHITE_VERTEX_COLOR },
    { geometry: faceCap, color: WHITE_VERTEX_COLOR },
    { geometry: rearCap, color: WHITE_VERTEX_COLOR },
    { geometry: beakSocketFill, color: WHITE_VERTEX_COLOR },
    { geometry: eyeRing, color: FACE_PATCH_COLOR },
    { geometry: beak.upper, color: BEAK_COLOR },
    { geometry: beak.lower, color: BEAK_COLOR },
    { geometry: pupils, color: EYE_COLOR },
  ]);
}

function buildDoubleSidedDiskCap(y: number, radius: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    positions.push(
      0, y, 0,
      x0, y, z0,
      x1, y, z1,
      0, y, 0,
      x1, y, z1,
      x0, y, z0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildParrotEyeDisks(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  radius: number,
  thickness: number,
): THREE.BufferGeometry {
  const sideTiltRad = THREE.MathUtils.degToRad(90 - PARROT_EYE_SIDE_ANGLE_DEG);
  const buildEyeDisk = (side: 1 | -1): THREE.BufferGeometry => {
    const disk = new THREE.CylinderGeometry(radius, radius, thickness, 16);
    const axis = new THREE.Vector3(side * Math.cos(sideTiltRad), Math.sin(sideTiltRad), 0).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    disk.applyQuaternion(rotation);
    disk.translate(
      side * (eyeX + thickness * Math.cos(sideTiltRad) * 0.62),
      eyeY + thickness * Math.sin(sideTiltRad) * 0.4,
      eyeZ,
    );
    return disk;
  };
  const left = buildEyeDisk(1);
  const right = buildEyeDisk(-1);
  return mergePositionOnlyGeometries([left, right]);
}

function buildSolidParrotBeakGeometry(
  faceY: number,
  faceRadius: number,
  beakLen: number,
): { upper: THREE.BufferGeometry; lower: THREE.BufferGeometry } {
  const upperLen = beakLen * 0.4464;
  const lowerLen = beakLen * 0.252;

  // Upper beak mostly straight; the final section is explicitly rotated
  // downward so the hook is visibly curved (not just a slight skew).
  const upper = new THREE.ConeGeometry(faceRadius * 0.54, upperLen, 18, 10);
  upper.scale(1, 1, 0.8);
  const upperPos = upper.getAttribute('position');
  const upperYMin = -upperLen * 0.5;
  const upperYMax = upperLen * 0.5;
  const upperSpan = upperYMax - upperYMin;
  const hookStartT = 0.4;
  const hookPivotY = upperYMin + upperSpan * hookStartT;
  const maxHookAngle = THREE.MathUtils.degToRad(45);
  for (let i = 0; i < upperPos.count; i++) {
    const y = upperPos.getY(i);
    const t = THREE.MathUtils.clamp((y - upperYMin) / upperSpan, 0, 1);
    const hookT = THREE.MathUtils.smoothstep(t, hookStartT, 1);
    const tipNarrow = THREE.MathUtils.lerp(1.0, 0.76, hookT);
    const x = upperPos.getX(i) * tipNarrow;
    const z = upperPos.getZ(i);
    const angle = -maxHookAngle * hookT;
    const dy = y - hookPivotY;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const bentY = hookPivotY + dy * cosA - z * sinA;
    const bentZ = dy * sinA + z * cosA;
    upperPos.setX(i, x);
    upperPos.setY(i, bentY);
    upperPos.setZ(i, bentZ);
  }
  upperPos.needsUpdate = true;
  upper.computeVertexNormals();
  upper.translate(0, faceY + upperLen * 0.54 + beakLen * 0.1, beakLen * 0.045);

  // Triangular lower mandible (slightly open) so the upper hook visibly
  // overlaps it in side profile.
  const lower = new THREE.ConeGeometry(faceRadius * 0.5, lowerLen, 3);
  lower.rotateY(Math.PI / 3);
  lower.scale(1, 1, 0.74);
  const lowerPos = lower.getAttribute('position');
  const lowerYMin = -lowerLen * 0.5;
  const lowerYMax = lowerLen * 0.5;
  const lowerSpan = lowerYMax - lowerYMin;
  for (let i = 0; i < lowerPos.count; i++) {
    const y = lowerPos.getY(i);
    const t = THREE.MathUtils.clamp((y - lowerYMin) / lowerSpan, 0, 1);
    const taper = THREE.MathUtils.lerp(0.98, 0.56, t);
    const rearTrim = THREE.MathUtils.smoothstep(t, 0.08, 0.46);
    lowerPos.setX(i, lowerPos.getX(i) * taper);
    lowerPos.setZ(i, lowerPos.getZ(i) + beakLen * 0.1 * Math.pow(t, 1.3));
    lowerPos.setY(i, lowerPos.getY(i) + beakLen * 0.08 * Math.pow(t, 1.2));
    lowerPos.setX(i, lowerPos.getX(i) * (0.68 + 0.32 * rearTrim));
    lowerPos.setY(i, y + beakLen * 0.01 * Math.pow(t, 1.2));
  }
  lowerPos.needsUpdate = true;
  lower.computeVertexNormals();
  lower.rotateX(THREE.MathUtils.degToRad(1));
  lower.translate(0, faceY + lowerLen * 0.82 + faceRadius * 0.45, -beakLen * 0.16);

  return { upper, lower };
}

/**
 * A graduated fan of individually shaped tail feathers — a real macaw
 * tail is a continuous fan of several feathers of different lengths
 * (the central pair much longer, tapering shorter toward the outer
 * edges), each feather a slender vane (narrow quill at the root,
 * bulging out to its widest a bit past the middle, then tapering to a
 * point at the tip), all rooted at the same point flush against the
 * body so the fan reads as one continuous structure rather than a flat
 * paddle base with a couple of bare sticks poking out of it (the
 * earlier "fan + 2 quill streamers" version, which read as artificial).
 * Feathers overlap slightly at the root (each is a solid quad fanned
 * out at its own angle from dead-center) and every feather droops
 * slightly in -Z (gravity droop, matching the rest of the body's
 * plumage) with the droop growing toward the tip. Each vane is run
 * through extrudeRingGeometry for real Z-thickness so it doesn't
 * vanish edge-on.
 */
function buildParrotTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const thickness = width * 0.046;

  // Root sits at (or slightly ahead of, for guaranteed overlap) the
  // body lathe's own tail-root profile point (-halfLen*0.95 = -length*0.475
  // — see buildParrotBodyGeometry's profile): a shallower root left a
  // visible gap between where the body's own taper ended and where the
  // tail began, reading as "the tail is separated from the body".
  const rootY = -length * 0.46;

  const featherCount = 9;
  const maxSpreadDeg = 34; // total angular spread of the fan, center feather at 0deg
  const maxLen = length * 0.63; // center (longest) feather length
  const minLenFrac = 0.54; // outermost feathers' length relative to maxLen

  const featherGeometries: THREE.BufferGeometry[] = [];
  // Blend tail fan into the body so the root doesn't read as a hard collar.
  const rootBlend = new THREE.SphereGeometry(width * 0.14, 10, 8);
  rootBlend.scale(1.25, 0.55, 0.75);
  rootBlend.translate(0, rootY + length * 0.03, -length * 0.015);
  featherGeometries.push(rootBlend);
  for (let i = 0; i < featherCount; i++) {
    // -1 (leftmost) .. 0 (center) .. +1 (rightmost)
    const t = (i / (featherCount - 1)) * 2 - 1;
    const angle = THREE.MathUtils.degToRad(t * maxSpreadDeg);
    const lenFrac = minLenFrac + (1 - minLenFrac) * Math.pow(Math.cos((t * Math.PI) / 2), 1.4);
    const featherLen = maxLen * lenFrac;

    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle); // fan opens backward (-Y)
    const droop = -length * 0.09 * lenFrac; // longer feathers droop a bit more

    // Vane outline: a slender quill at the root widening to its
    // fullest a bit past the middle, then tapering to a fine point —
    // built as a 4-point diamond (root, left-bulge, tip, right-bulge)
    // rather than a plain thin sliver, so each feather reads as a real
    // vane rather than a wire.
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const vaneHalfWidth = width * 0.082 * lenFrac;
    const bulgeAt = 0.55; // fraction along the feather where it's widest

    const root = new THREE.Vector3(0, rootY, 0);
    const bulgeCenterX = dirX * featherLen * bulgeAt;
    const bulgeCenterY = rootY + dirY * featherLen * bulgeAt;
    const leftBulge = new THREE.Vector3(
      bulgeCenterX - perpX * vaneHalfWidth,
      bulgeCenterY - perpY * vaneHalfWidth,
      droop * bulgeAt,
    );
    const rightBulge = new THREE.Vector3(
      bulgeCenterX + perpX * vaneHalfWidth,
      bulgeCenterY + perpY * vaneHalfWidth,
      droop * bulgeAt,
    );
    const tipCoreX = dirX * featherLen;
    const tipCoreY = rootY + dirY * featherLen;
    const tipHalfWidth = vaneHalfWidth * 0.52;
    const leftShoulder = new THREE.Vector3(
      dirX * featherLen * 0.84 - perpX * vaneHalfWidth * 0.72,
      rootY + dirY * featherLen * 0.84 - perpY * vaneHalfWidth * 0.72,
      droop * 0.84,
    );
    const rightShoulder = new THREE.Vector3(
      dirX * featherLen * 0.84 + perpX * vaneHalfWidth * 0.72,
      rootY + dirY * featherLen * 0.84 + perpY * vaneHalfWidth * 0.72,
      droop * 0.84,
    );
    const leftTip = new THREE.Vector3(
      tipCoreX - perpX * tipHalfWidth,
      tipCoreY - perpY * tipHalfWidth,
      droop * 0.98,
    );
    const tipCap = new THREE.Vector3(dirX * featherLen * 1.04, rootY + dirY * featherLen * 1.04, droop * 1.05);
    const rightTip = new THREE.Vector3(
      tipCoreX + perpX * tipHalfWidth,
      tipCoreY + perpY * tipHalfWidth,
      droop * 0.98,
    );

    featherGeometries.push(
      extrudeRingGeometry([root, leftBulge, leftShoulder, leftTip, tipCap, rightTip, rightShoulder, rightBulge], thickness),
    );
  }

  return mergePositionOnlyGeometries(featherGeometries);
}

/**
 * A broad, rounded "paddle" wing — parrots have short, rounded wings
 * built for quick maneuvering through canopy, quite different from a
 * falcon/hawk's long, sharply swept-back, pointed wing (the shared
 * birdGeometry.ts buildFingeredWingGeometry). That pointed dagger shape,
 * combined with a parrot's bright saturated color patterns, read as a
 * "shark fin" rather than a wing. This shape uses a wider fan of
 * boundary points for a convex, rounded leading edge and a blunt
 * (not pointed) wingtip, plus a few short, closely-spaced finger
 * feathers along the trailing edge near the tip — shorter and less
 * needle-like than the hawk's, so they read as soft flight-feather tips
 * rather than long spikes.
 */
function buildParrotWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  const root: number[] = [0, 0, 0];
  // Broad wing with a comparatively straighter front edge and a more
  // curved trailing edge, matching typical parrot/macaw silhouettes.
  const boundary: number[][] = [
    [0.22 * span * s, chord * 0.5, 0],
    [0.56 * span * s, chord * 0.49, 0],
    [0.82 * span * s, chord * 0.45, 0],
    [1.0 * span * s, chord * 0.28, 0],
    [0.95 * span * s, -chord * 0.04, 0],
    [0.86 * span * s, -chord * 0.28, 0],
    [0.68 * span * s, -chord * 0.47, 0],
    [0.46 * span * s, -chord * 0.58, 0],
    [0.22 * span * s, -chord * 0.46, 0],
  ];

  for (let i = 0; i < boundary.length; i++) {
    const next = boundary[(i + 1) % boundary.length];
    pushTri(root, boundary[i], next);
  }

  // A handful of short finger feathers growing from the panel's own
  // trailing-edge boundary (between the tip and the trailing-inner
  // point) rather than floating separately — kept short (relative to
  // span) and closely spaced so they read as soft feather tips, not
  // long spiky needles.
  const trailOuter = boundary[4];
  const trailInner = boundary[8];
  const lerp = (a: number[], b: number[], t: number) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const fingerCount = 8;
  const fingerGeometries: THREE.BufferGeometry[] = [];
  const shoulderCovert = new THREE.SphereGeometry(chord * 0.17, 12, 10);
  shoulderCovert.scale(0.92, 0.58, 0.5);
  shoulderCovert.translate(0.13 * span * s, chord * 0.01, -chord * 0.01);
  const trailingCovertStrip = extrudeRingGeometry(
    [
      new THREE.Vector3(trailInner[0], trailInner[1] + chord * 0.04, 0),
      new THREE.Vector3(trailOuter[0], trailOuter[1] + chord * 0.035, 0),
      new THREE.Vector3(trailOuter[0], trailOuter[1] - chord * 0.035, 0),
      new THREE.Vector3(trailInner[0], trailInner[1] - chord * 0.03, 0),
    ],
    chord * 0.028,
  );
  const halfGap = 0.048;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const featherT = THREE.MathUtils.smoothstep(t, 0, 1);
    const baseA = lerp(trailInner, trailOuter, Math.max(0, featherT - halfGap));
    const baseB = lerp(trailInner, trailOuter, Math.min(1, featherT + halfGap));
    const fingerLen = span * (0.14 + 0.16 * featherT);
    const midBase = lerp(baseA, baseB, 0.5);
    // Inner feathers trail almost straight back; outer feathers cant outward
    // progressively toward the wingtip.
    const outwardBias = Math.pow(featherT, 1.1);
    const outerTwoBoost = i >= fingerCount - 2 ? 0.22 : 0;
    const lateral = 0.02 + 0.46 * outwardBias + outerTwoBoost;
    const forward = new THREE.Vector2(s * lateral, -(1.04 + 0.16 * t)).normalize();
    const sideward = new THREE.Vector2(-forward.y, forward.x);
    const rootHalfWidth = Math.max(0.0001, Math.hypot(baseB[0] - baseA[0], baseB[1] - baseA[1]) * 0.5) * 1.38;
    const shoulderDist = fingerLen * 0.56;
    const tipDist = fingerLen * 0.88;
    const capDist = fingerLen * 1.01;
    const shoulderHalfWidth = rootHalfWidth * 0.98;
    const tipHalfWidth = rootHalfWidth * 0.9;
    const capHalfWidth = rootHalfWidth * 0.74;
    const capMidHalfWidth = capHalfWidth * 0.72;
    const zDroop = -chord * (0.01 + 0.06 * t);
    const toPoint = (dist: number, halfWidth: number, sideSign: 1 | -1, z: number): THREE.Vector3 =>
      new THREE.Vector3(
        midBase[0] + forward.x * dist + sideward.x * halfWidth * sideSign,
        midBase[1] + forward.y * dist + sideward.y * halfWidth * sideSign,
        z,
      );
    const ring = [
      new THREE.Vector3(baseA[0], baseA[1], 0),
      toPoint(shoulderDist, shoulderHalfWidth, -1, zDroop * 0.58),
      toPoint(tipDist, tipHalfWidth, -1, zDroop * 0.94),
      toPoint(capDist * 0.97, capHalfWidth, -1, zDroop),
      toPoint(capDist * 1.02, capMidHalfWidth, -1, zDroop),
      toPoint(capDist * 1.08, 0, 1, zDroop),
      toPoint(capDist * 1.02, capMidHalfWidth, 1, zDroop),
      toPoint(capDist * 0.97, capHalfWidth, 1, zDroop),
      toPoint(tipDist, tipHalfWidth, 1, zDroop * 0.94),
      toPoint(shoulderDist, shoulderHalfWidth, 1, zDroop * 0.58),
      new THREE.Vector3(baseB[0], baseB[1], 0),
    ];
    fingerGeometries.push(extrudeRingGeometry(ring, chord * 0.041));
  }

  const baseWing = new THREE.BufferGeometry();
  baseWing.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const geometry = mergePositionOnlyGeometries([baseWing, shoulderCovert, trailingCovertStrip, ...fingerGeometries]);
  baseWing.dispose();
  shoulderCovert.dispose();
  trailingCovertStrip.dispose();
  fingerGeometries.forEach((f) => f.dispose());
  tintParrotWingRegions(geometry, chord);
  geometry.computeVertexNormals();
  return geometry;
}

function tintParrotTorsoRegions(geometry: THREE.BufferGeometry, halfLen: number): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const backT = THREE.MathUtils.clamp((z / (halfLen * 0.2) + 1) * 0.5, 0, 1);
    const bellyT = THREE.MathUtils.clamp((-z / (halfLen * 0.24) + 1) * 0.5, 0, 1);
    const bodyForwardT = THREE.MathUtils.clamp((y + halfLen * 0.25) / (halfLen * 1.2), 0, 1);
    const backWeight = backT * bodyForwardT * 1.1;
    const bellyWeight = bellyT * 1.05;
    const backDominant = backWeight >= bellyWeight;
    const target = backDominant ? BACK_REGION_COLOR : BELLY_REGION_COLOR;
    const strength = Math.min(0.92, (backDominant ? backWeight : bellyWeight) * 1.05);
    const r = THREE.MathUtils.lerp(1, target.r, strength);
    const g = THREE.MathUtils.lerp(1, target.g, strength);
    const b = THREE.MathUtils.lerp(1, target.b, strength);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function tintParrotWingRegions(geometry: THREE.BufferGeometry, chord: number): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const frontT = THREE.MathUtils.clamp((y / (chord * 0.55) + 1) * 0.5, 0, 1);
    const rearT = THREE.MathUtils.clamp((-y / (chord * 0.55) + 1) * 0.5, 0, 1);
    const frontDominant = frontT >= rearT;
    const target = frontDominant ? WING_FRONT_COLOR : WING_REAR_COLOR;
    const strength = Math.min(0.9, (frontDominant ? frontT : rearT) * 0.95);
    const r = THREE.MathUtils.lerp(1, target.r, strength);
    const g = THREE.MathUtils.lerp(1, target.g, strength);
    const b = THREE.MathUtils.lerp(1, target.b, strength);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
