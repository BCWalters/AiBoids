import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  mergeGeometriesWithColor,
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
} from '../../../geometry/sharedGeometry';

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

const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
interface ParrotPalette {
  beak: THREE.Color;
  feet: THREE.Color;
  facePatch: THREE.Color;
  eyeOuter: THREE.Color;
  back: THREE.Color;
  backLight: THREE.Color;
  belly: THREE.Color;
  wingTopFront: THREE.Color;
  wingTopRear: THREE.Color;
  wingUndersideFront: THREE.Color;
  wingUndersideRear: THREE.Color;
  tailRoot: THREE.Color;
  tailTip: THREE.Color;
  /** When true, the torso uses a smooth dorsal→ventral Z-axis gradient
   * (back color at crown/dorsal surface, belly color at ventral surface)
   * instead of the default dominant-weight back/belly region split. */
  dorsalGradient: boolean;
}

const GREEN_FOCUS_PARROT_PALETTE: ParrotPalette = {
  beak: new THREE.Color(0xe35d2b),
  feet: new THREE.Color(0x707070),
  facePatch: new THREE.Color(0x44b749),
  eyeOuter: new THREE.Color(0x44b749),
  back: new THREE.Color(0x44b749),
  backLight: new THREE.Color(0x4fbf52),
  belly: new THREE.Color(0xc8e455),
  wingTopFront: new THREE.Color(0x389c3d),
  wingTopRear: new THREE.Color(0x2d8532),
  wingUndersideFront: new THREE.Color(0xe3ef63),
  wingUndersideRear: new THREE.Color(0x9da3a9),
  tailRoot: new THREE.Color(0x44b749),
  tailTip: new THREE.Color(0xc8e455),
  dorsalGradient: true,
};

const BLUE_GOLD_FOCUS_PARROT_PALETTE: ParrotPalette = {
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x5a5a5a),
  facePatch: new THREE.Color(0x2f75ff),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0x2f75ff),
  backLight: new THREE.Color(0x5d98ff),
  belly: new THREE.Color(0xffe033),
  wingTopFront: new THREE.Color(0x4f8fff),
  wingTopRear: new THREE.Color(0x245fdb),
  wingUndersideFront: new THREE.Color(0xffe033),
  wingUndersideRear: new THREE.Color(0xffcc00),
  tailRoot: new THREE.Color(0x2f75ff),
  tailTip: new THREE.Color(0xffe033),
  dorsalGradient: false,
};

const SCARLET_FOCUS_PARROT_PALETTE: ParrotPalette = {
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x6a6a6a),
  facePatch: new THREE.Color(0xe12832),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0xe12832),
  backLight: new THREE.Color(0xf13a45),
  belly: new THREE.Color(0x2f61c9),
  wingTopFront: new THREE.Color(0xe43a44),
  wingTopRear: new THREE.Color(0x2a5fbf),
  wingUndersideFront: new THREE.Color(0xd7c56c),
  wingUndersideRear: new THREE.Color(0x36549a),
  tailRoot: new THREE.Color(0xe0c45d),
  tailTip: new THREE.Color(0x2b57b0),
  dorsalGradient: false,
};

const PURPLE_LAVENDER_FOCUS_PARROT_PALETTE: ParrotPalette = {
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x9a9a9a),
  facePatch: new THREE.Color(0x6b4bb3),
  eyeOuter: new THREE.Color(0x39ff14),
  back: new THREE.Color(0x6b4bb3),
  backLight: new THREE.Color(0x9a7fe0),
  belly: new THREE.Color(0xc8b4ff),
  wingTopFront: new THREE.Color(0xb49af3),
  wingTopRear: new THREE.Color(0x7a5dc7),
  wingUndersideFront: new THREE.Color(0xd8c9ff),
  wingUndersideRear: new THREE.Color(0xa99ec4),
  tailRoot: new THREE.Color(0x7b60c8),
  tailTip: new THREE.Color(0xd1c2ff),
  dorsalGradient: false,
};

const NEUTRAL_PARROT_PALETTE: ParrotPalette = {
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x707070),
  facePatch: new THREE.Color(0xffffff),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0xffffff),
  backLight: new THREE.Color(0xffffff),
  belly: new THREE.Color(0xffffff),
  wingTopFront: new THREE.Color(0xffffff),
  wingTopRear: new THREE.Color(0xffffff),
  wingUndersideFront: new THREE.Color(0xffffff),
  wingUndersideRear: new THREE.Color(0xbfc4cb),
  tailRoot: new THREE.Color(0xffffff),
  tailTip: new THREE.Color(0xffffff),
  dorsalGradient: false,
};

let ACTIVE_PARROT_PALETTE: ParrotPalette = GREEN_FOCUS_PARROT_PALETTE;
// Near-black eye dots — stay near-black under any per-instance body tint
// multiply (see the multiply-color reasoning in unicornGeometry.ts), so
// this single baked color works correctly across every macaw color
// pattern in PARROT_COLOR_PATTERNS.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const PARROT_EYE_SIDE_ANGLE_DEG = 90;
const PARROT_EYE_BOTTOM_OUTWARD_CANT_DEG = 18;
const PARROT_BODY_LATHE_SEGMENTS = 24;
const PARROT_BODY_SLIM_SCALE = 0.8;
const PARROT_HEAD_TILT_RAD = THREE.MathUtils.degToRad(-21);
const PARROT_HEAD_TILT_BLEND_START_FRAC = 0.3;
const PARROT_BEAK_DOWN_PITCH_RAD = THREE.MathUtils.degToRad(-8);

export function createParrotGeometries(
  length: number,
  width: number,
  paletteProfile: 'green-focus' | 'blue-gold-focus' | 'scarlet-focus' | 'purple-lavender-focus' | 'neutral' = 'green-focus',
): CreatureGeometries {
  const previousPalette = ACTIVE_PARROT_PALETTE;
  ACTIVE_PARROT_PALETTE = paletteProfile === 'neutral'
    ? NEUTRAL_PARROT_PALETTE
    : paletteProfile === 'blue-gold-focus'
      ? BLUE_GOLD_FOCUS_PARROT_PALETTE
      : paletteProfile === 'scarlet-focus'
        ? SCARLET_FOCUS_PARROT_PALETTE
      : paletteProfile === 'purple-lavender-focus'
        ? PURPLE_LAVENDER_FOCUS_PARROT_PALETTE
        : GREEN_FOCUS_PARROT_PALETTE;
  try {
    const body = buildParrotBodyGeometry(length, width);

    // Parrots have proportionally broader, more paddle-shaped wings than a
    // soaring hawk (built for short powerful flaps through canopy, not
    // long glides) — see buildParrotWingGeometry for the shape itself.
    const wingSpan = length * 1.05;
    const wingChord = length * 0.58;
    const wingLeft = buildParrotWingGeometry(wingSpan, wingChord, 1);
    const wingRight = buildParrotWingGeometry(wingSpan, wingChord, -1);

    const tail = buildParrotTailGeometry(length, width);
    const legs = buildParrotLegsGeometry(length, width);

    return { body, wingLeft, wingRight, tail, legs };
  } finally {
    ACTIVE_PARROT_PALETTE = previousPalette;
  }
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
  const headTiltPivotY = halfLen * HEAD_START_FRAC;
  const headTiltBlendStartY = halfLen * PARROT_HEAD_TILT_BLEND_START_FRAC;
  // Face radius kept smaller than the head-crown bulge (a real, if
  // gentle, step down) so the head reads as a rounded mass with a
  // distinctly narrower face the beak grows out of, rather than the
  // beak's base being the same girth as the whole skull.
  const faceRadius = width * 0.145 * HEAD_NARROW_SCALE;
  const faceY = halfLen * HEAD_END_FRAC;
  const profile = [
    new THREE.Vector2(width * 0.045 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.95), // tail-root taper
    new THREE.Vector2(width * 0.21 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.65),
    new THREE.Vector2(width * 0.3 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.2), // belly bulge
    new THREE.Vector2(width * 0.31 * PARROT_BODY_SLIM_SCALE, halfLen * 0.12), // chest
    // Head reworked to be noticeably taller (a longer Y-span from neck
    // pinch to face) relative to its radius than the previous profile —
    // that version spanned only ~0.38*halfLen in Y against a ~0.46*width
    // peak radius, an oblate-spheroid ratio that read as a flat, wide
    // "smooshed"/Lego-brick head rather than a rounded skull. Pushing the
    // neck pinch earlier and the face further out (plus trimming the
    // peak radius down a touch) roughly doubles that span:radius ratio.
    // Every radius/position past this point is additionally scaled by
    // HEAD_NARROW_SCALE/HEAD_LENGTHEN_SCALE above.
    new THREE.Vector2(width * 0.26 * PARROT_BODY_SLIM_SCALE, halfLen * HEAD_START_FRAC), // neck pinch
    new THREE.Vector2(width * 0.29 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.5)), // head base
    new THREE.Vector2(width * 0.32 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.62)), // crown, kept near front-body diameter
    new THREE.Vector2(width * 0.27 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.74)), // forehead
    new THREE.Vector2(width * 0.22 * HEAD_NARROW_SCALE, halfLen * headFrac(0.84)), // brow, just above the eyes
    new THREE.Vector2(faceRadius, faceY), // face, where the beak attaches
  ];
  const torso = new THREE.LatheGeometry(profile, PARROT_BODY_LATHE_SEGMENTS);
  tintParrotTorsoRegions(torso, halfLen);
  pitchHeadRegionDown(torso, headTiltBlendStartY, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  // Two-part macaw beak: a large, strongly hooked upper mandible that
  // overhangs a shorter, triangular lower mandible with a slight gape.
  const beak = buildSolidParrotBeakGeometry(faceY, faceRadius, length * 0.29);
  const beakPitchPivotY = faceY + faceRadius * 0.22;
  rotateGeometryAroundXPivot(beak.upper, beakPitchPivotY, PARROT_BEAK_DOWN_PITCH_RAD);
  rotateGeometryAroundXPivot(beak.lower, beakPitchPivotY, PARROT_BEAK_DOWN_PITCH_RAD);
  rotateGeometryAroundXPivot(beak.upper, headTiltPivotY, PARROT_HEAD_TILT_RAD);
  rotateGeometryAroundXPivot(beak.lower, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  // Close the rear lathe opening; the face opening is sealed by the
  // socket filler below to avoid a visible "crown-like" frontal disk.
  const rearCap = buildDoubleSidedDiskCap(-halfLen * 0.95, width * 0.07, 12);

  // Keep one internal filler at the face opening so the beak/body
  // junction never reveals the lathe cavity from front angles.
  const beakSocketFill = new THREE.SphereGeometry(faceRadius * 1.2, 12, 10);
  beakSocketFill.scale(0.96, 0.9, 0.902);
  beakSocketFill.translate(0, faceY - length * 0.004, -length * 0.02 + faceRadius * 0.26);
  rotateGeometryAroundXPivot(beakSocketFill, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  const eyeY = halfLen * headFrac(0.79);
  const eyeX = width * 0.252 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE;
  const eyeZ = width * 0.084 * HEAD_NARROW_SCALE;
  const eyeRing = buildParrotEyeDisks(eyeX, eyeY, eyeZ, width * 0.02925 * HEAD_NARROW_SCALE, width * 0.004);
  const pupils = buildParrotEyeDisks(eyeX, eyeY, eyeZ, width * 0.01603125 * HEAD_NARROW_SCALE, width * 0.007);
  rotateGeometryAroundXPivot(eyeRing, headTiltPivotY, PARROT_HEAD_TILT_RAD);
  rotateGeometryAroundXPivot(pupils, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  return mergeGeometriesWithColor([
    { geometry: torso, color: WHITE_VERTEX_COLOR },
    { geometry: rearCap, color: WHITE_VERTEX_COLOR },
    { geometry: beakSocketFill, color: ACTIVE_PARROT_PALETTE.facePatch },
    { geometry: eyeRing, color: ACTIVE_PARROT_PALETTE.eyeOuter },
    { geometry: beak.upper, color: ACTIVE_PARROT_PALETTE.beak },
    { geometry: beak.lower, color: ACTIVE_PARROT_PALETTE.beak },
    { geometry: pupils, color: EYE_COLOR },
  ]);
}

function pitchHeadRegionDown(
  geometry: THREE.BufferGeometry,
  blendStartY: number,
  pivotY: number,
  angleRad: number,
): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y <= blendStartY) continue;
    const z = position.getZ(i);
    const t = THREE.MathUtils.smoothstep(y, blendStartY, pivotY);
    const angle = angleRad * t;
    const dy = y - pivotY;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    position.setY(i, pivotY + dy * cosA - z * sinA);
    position.setZ(i, dy * sinA + z * cosA);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function rotateGeometryAroundXPivot(geometry: THREE.BufferGeometry, pivotY: number, angleRad: number): void {
  geometry.translate(0, -pivotY, 0);
  geometry.rotateX(angleRad);
  geometry.translate(0, pivotY, 0);
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
    const lowerOutwardCant = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -side * THREE.MathUtils.degToRad(PARROT_EYE_BOTTOM_OUTWARD_CANT_DEG),
    );
    disk.applyQuaternion(rotation);
    disk.applyQuaternion(lowerOutwardCant);
    disk.translate(
      side * (eyeX + thickness * Math.cos(sideTiltRad) * 1.0),
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
  lower.translate(0, faceY + lowerLen * 0.82 + faceRadius * 0.45, -beakLen * 0.13);

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
  const maxLen = length * 0.7875; // center (longest) feather length
  const minLenFrac = 0.54; // outermost feathers' length relative to maxLen
  // Distribute tail-feather roots across a short horizontal span instead
  // of pinning every feather to a single center point, so the tail reads
  // as emerging from the full rump width rather than a needle point.
  const rootHalfSpan = width * 0.052;

  const featherGeometries: THREE.BufferGeometry[] = [];
  // Blend tail fan into the body so the root doesn't read as a hard collar.
  const rootBlend = new THREE.SphereGeometry(width * 0.14, 10, 8);
  rootBlend.scale(1.1, 0.56, 0.76);
  rootBlend.translate(0, rootY + length * 0.026, -length * 0.015);
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

    const root = new THREE.Vector3(t * rootHalfSpan, rootY, 0);
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

  const geometry = mergePositionOnlyGeometries(featherGeometries);
  tintParrotTailGradient(geometry, rootY, maxLen);
  return geometry;
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
  const sheetHalfThickness = chord * 0.006;

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
    const rootTop: number[] = [root[0], root[1], sheetHalfThickness];
    const aTop: number[] = [boundary[i][0], boundary[i][1], sheetHalfThickness];
    const bTop: number[] = [next[0], next[1], sheetHalfThickness];
    const rootBottom: number[] = [root[0], root[1], -sheetHalfThickness];
    const aBottom: number[] = [boundary[i][0], boundary[i][1], -sheetHalfThickness];
    const bBottom: number[] = [next[0], next[1], -sheetHalfThickness];
    pushTri(rootTop, aTop, bTop);
    pushTri(rootBottom, bBottom, aBottom);
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
  const fingerCount = 12;
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
    chord * 0.016,
  );
  const halfGap = 0.034;
  const outerFeatherTaperStartIndex = fingerCount - 4;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const featherT = THREE.MathUtils.smoothstep(t, 0, 1);
    const baseA = lerp(trailInner, trailOuter, Math.max(0, featherT - halfGap));
    const baseB = lerp(trailInner, trailOuter, Math.min(1, featherT + halfGap));
    const tipTaperT = THREE.MathUtils.smoothstep(i, outerFeatherTaperStartIndex, fingerCount - 1);
    const tipTaperScale = THREE.MathUtils.lerp(1, 0.62, tipTaperT);
    const fingerLen = span * (0.13 + 0.14 * featherT) * tipTaperScale;
    const midBase = lerp(baseA, baseB, 0.5);
    // Inner feathers trail almost straight back; outer feathers cant outward
    // progressively toward the wingtip.
    const outwardBias = Math.pow(featherT, 1.1);
    const outerTwoBoost = i >= fingerCount - 2 ? 0.12 : 0;
    const lateral = 0.01 + 0.34 * outwardBias + outerTwoBoost;
    const forward = new THREE.Vector2(s * lateral, -(1.1 + 0.22 * t)).normalize();
    const sideward = new THREE.Vector2(-forward.y, forward.x);
    const rootHalfWidth = Math.max(0.0001, Math.hypot(baseB[0] - baseA[0], baseB[1] - baseA[1]) * 0.5) * 1.16;
    const shoulderDist = fingerLen * 0.56;
    const tipDist = fingerLen * 0.88;
    const capDist = fingerLen * 1.01;
    const shoulderHalfWidth = rootHalfWidth * 0.82;
    const tipHalfWidth = rootHalfWidth * 0.58;
    const capHalfWidth = rootHalfWidth * 0.4;
    const capMidHalfWidth = capHalfWidth * 0.6;
    const zDroop = -chord * (0.008 + 0.04 * t);
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
    // Keep a tiny amount of volume so feathers stay 3D, but minimize
    // top/bottom protrusion off the wing plane.
    fingerGeometries.push(extrudeRingGeometry(ring, chord * 0.011));
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

function buildParrotLegsGeometry(length: number, width: number): THREE.BufferGeometry {
  const legRadius = width * 0.038;
  const legLength = length * 0.105;
  const toeLength = length * 0.074;
  const footY = -length * 0.18;
  const hipZ = -width * 0.08;
  const footZ = hipZ - legLength * 0.95;
  const buildLeg = (side: 1 | -1): THREE.BufferGeometry => {
    const x = side * width * 0.115;
    const leg = new THREE.CylinderGeometry(legRadius * 0.92, legRadius, legLength, 8);
    leg.rotateX(Math.PI / 2);
    leg.translate(x, footY, hipZ - legLength * 0.5);

    const makeToe = (xOffset: number, yBias: number): THREE.BufferGeometry => {
      const toe = new THREE.ConeGeometry(legRadius * 0.42, toeLength, 6);
      toe.translate(x + xOffset, footY + yBias + toeLength * 0.45, footZ);
      return toe;
    };
    const toes = [
      makeToe(side * legRadius * 0.55, toeLength * 0.05),
      makeToe(0, toeLength * 0.12),
      makeToe(-side * legRadius * 0.55, toeLength * 0.05),
    ];
    const hindToe = new THREE.ConeGeometry(legRadius * 0.3, toeLength * 0.62, 6);
    hindToe.rotateX(Math.PI);
    hindToe.translate(x, footY - toeLength * 0.28, footZ + toeLength * 0.02);
    return mergePositionOnlyGeometries([leg, ...toes, hindToe]);
  };
  const left = buildLeg(1);
  const right = buildLeg(-1);
  return mergeGeometriesWithColor([
    { geometry: mergePositionOnlyGeometries([left, right]), color: ACTIVE_PARROT_PALETTE.feet },
  ]);
}

function tintParrotTorsoRegions(geometry: THREE.BufferGeometry, halfLen: number): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  if (ACTIVE_PARROT_PALETTE.dorsalGradient) {
    // Smooth dorsal→ventral gradient purely in Z: back color at the crown
    // (max Z, dorsal surface), belly color at the underside (min Z).
    // Using the geometry's own bounding-box extent so the gradient spans
    // exactly from surface to surface regardless of body proportions.
    geometry.computeBoundingBox();
    const minZ = geometry.boundingBox?.min.z ?? -halfLen * 0.3;
    const maxZ = geometry.boundingBox?.max.z ?? halfLen * 0.3;
    const zSpan = Math.max(1e-5, maxZ - minZ);
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const t = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((z - minZ) / zSpan, 0, 1), 0, 1);
      colors[i * 3]     = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.r, ACTIVE_PARROT_PALETTE.back.r, t);
      colors[i * 3 + 1] = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.g, ACTIVE_PARROT_PALETTE.back.g, t);
      colors[i * 3 + 2] = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.b, ACTIVE_PARROT_PALETTE.back.b, t);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return;
  }

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const backT = THREE.MathUtils.clamp((z / (halfLen * 0.2) + 1) * 0.5, 0, 1);
    const bellyT = THREE.MathUtils.clamp((-z / (halfLen * 0.24) + 1) * 0.5, 0, 1);
    const bodyForwardT = THREE.MathUtils.clamp((y + halfLen * 0.25) / (halfLen * 1.2), 0, 1);
    const backWeight = backT * (0.6 + bodyForwardT * 0.45);
    const bellyWeight = bellyT * 0.82;
    const backDominant = backWeight >= bellyWeight;
    let r: number;
    let g: number;
    let b: number;
    if (backDominant) {
      const lightMix = Math.min(0.08, backWeight * 0.1);
      r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.backLight.r, lightMix);
      g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.backLight.g, lightMix);
      b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.backLight.b, lightMix);
    } else {
      const strength = Math.min(0.92, bellyWeight * 1.05);
      if (ACTIVE_PARROT_PALETTE === SCARLET_FOCUS_PARROT_PALETTE) {
        const backToFrontT = 1 - bodyForwardT;
        const bellyGradientR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.belly.r, backToFrontT);
        const bellyGradientG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.belly.g, backToFrontT);
        const bellyGradientB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.belly.b, backToFrontT);
        r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, bellyGradientR, strength);
        g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, bellyGradientG, strength);
        b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, bellyGradientB, strength);
      } else {
        r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.belly.r, strength);
        g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.belly.g, strength);
        b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.belly.b, strength);
      }
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function tintParrotTailGradient(geometry: THREE.BufferGeometry, rootY: number, maxLen: number): void {
  const pos = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const minZ = geometry.boundingBox?.min.z ?? -maxLen * 0.08;
  const colors = new Float32Array(pos.count * 3);
  const tipY = rootY - maxLen * 1.08;
  const span = Math.max(1e-5, rootY - tipY);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((rootY - y) / span, 0, 1), 0, 1);
    const undersideWeight = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp(((-z) - minZ * 0.12) / Math.max(1e-5, -minZ * 0.88), 0, 1),
      0,
      1,
    );
    const topR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.tailRoot.r, ACTIVE_PARROT_PALETTE.tailTip.r, t);
    const topG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.tailRoot.g, ACTIVE_PARROT_PALETTE.tailTip.g, t);
    const topB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.tailRoot.b, ACTIVE_PARROT_PALETTE.tailTip.b, t);
    const undersideTipT = THREE.MathUtils.smoothstep(t, 0, 1);
    const undersideR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.r, ACTIVE_PARROT_PALETTE.tailTip.r, undersideTipT);
    const undersideG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.g, ACTIVE_PARROT_PALETTE.tailTip.g, undersideTipT);
    const undersideB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.b, ACTIVE_PARROT_PALETTE.tailTip.b, undersideTipT);
    colors[i * 3] = THREE.MathUtils.lerp(topR, undersideR, undersideWeight);
    colors[i * 3 + 1] = THREE.MathUtils.lerp(topG, undersideG, undersideWeight);
    colors[i * 3 + 2] = THREE.MathUtils.lerp(topB, undersideB, undersideWeight);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function tintParrotWingRegions(geometry: THREE.BufferGeometry, chord: number): void {
  const pos = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? -chord * 0.62;
  const maxY = geometry.boundingBox?.max.y ?? chord * 0.62;
  const minZ = geometry.boundingBox?.min.z ?? -chord * 0.08;
  const ySpan = Math.max(1e-5, maxY - minY);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const frontToBackT = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp((y - minY) / ySpan, 0, 1),
      0,
      1,
    );
    const undersideWeight = Math.max(
      THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp(((-z) - chord * 0.001) / Math.max(1e-5, chord * 0.01), 0, 1),
        0,
        1,
      ),
      Math.pow(
        THREE.MathUtils.smoothstep(
          THREE.MathUtils.clamp(((-z) - minZ * 0.08) / Math.max(1e-5, -minZ * 0.44), 0, 1),
          0,
          1,
        ),
        0.6,
      ),
    );

    const topsideR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingTopRear.r, ACTIVE_PARROT_PALETTE.wingTopFront.r, frontToBackT);
    const topsideG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingTopRear.g, ACTIVE_PARROT_PALETTE.wingTopFront.g, frontToBackT);
    const topsideB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingTopRear.b, ACTIVE_PARROT_PALETTE.wingTopFront.b, frontToBackT);

    const rearGrayWeight = Math.pow(1 - frontToBackT, 2.4);
    const undersideR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingUndersideFront.r, ACTIVE_PARROT_PALETTE.wingUndersideRear.r, rearGrayWeight);
    const undersideG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingUndersideFront.g, ACTIVE_PARROT_PALETTE.wingUndersideRear.g, rearGrayWeight);
    const undersideB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.wingUndersideFront.b, ACTIVE_PARROT_PALETTE.wingUndersideRear.b, rearGrayWeight);

    const undersideMix = Math.pow(undersideWeight, 0.72);
    const targetR = THREE.MathUtils.lerp(topsideR, undersideR, undersideMix);
    const targetG = THREE.MathUtils.lerp(topsideG, undersideG, undersideMix);
    const targetB = THREE.MathUtils.lerp(topsideB, undersideB, undersideMix);

    const strength = THREE.MathUtils.lerp(0.99, 1.0, undersideWeight);
    const r = THREE.MathUtils.lerp(1, targetR, strength);
    const g = THREE.MathUtils.lerp(1, targetG, strength);
    const b = THREE.MathUtils.lerp(1, targetB, strength);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
