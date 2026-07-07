import * as THREE from 'three';
import type { CreatureGeometries } from './creatureGeometry';
import {
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  addRainbowVertexColors,
  addRainbowVertexColorsByDistance,
} from './creatureGeometry';
import { buildFingeredWingGeometry } from './birdGeometry';

/**
 * "Unicorn" predator geometry: a proper horse-like silhouette — a barrel-
 * chested lathed torso with a distinctly slender neck and blunt muzzle
 * (not the plump, beaked hawk taper), four straight hoofed legs (the same
 * "read as a real creature, not a bird" cue the dragon's clawed legs give
 * it), a single horn standing straight up off the top of the head, plus
 * feathered pegasus-style wings (the hawk's fingered wing shape, given a
 * rainbow vertex-color gradient — see addRainbowVertexColors) and a
 * flowing fanned tail.
 */
export function createUnicornGeometries(length: number, width: number): CreatureGeometries {
  const body = buildUnicornBodyGeometry(length, width);

  const wingSpan = length * 1.3;
  const wingChord = length * 0.6;
  const wingLeft = addRainbowVertexColors(buildFingeredWingGeometry(wingSpan, wingChord, 1), wingSpan);
  const wingRight = addRainbowVertexColors(buildFingeredWingGeometry(wingSpan, wingChord, -1), wingSpan);
  // Shift the wing root back off the shoulder/chest (where the shared
  // wing-geometry builder attaches it by default, y=0 — fine for a
  // dragon, but reads as too dragon-like here) by a quarter of the
  // torso's length, so the wings sit further back over the barrel
  // instead of right at the very front.
  const wingBackOffset = length * 0.25;
  wingLeft.translate(0, -wingBackOffset, 0);
  wingRight.translate(0, -wingBackOffset, 0);

  const tail = buildUnicornTailGeometry(length, width);
  const legs = buildUnicornLegsGeometry(length, width);

  return { body, wingLeft, wingRight, tail, legs };
}


/**
 * Horse-proportioned torso plus a small horn merged onto the top of the
 * head — see buildHorseBodyProfileGeometry / buildUnicornHornGeometry.
 * (No ears for now — an earlier pass added small paired ears here, but
 * they read wildly out of proportion, so they've been dropped pending a
 * better approach.) The horn is baked gold via mergeGeometriesWithColor
 * so it stands out against the lavender body — see that helper's doc
 * comment for why vertex colors (rather than a second material) are
 * needed here.
 */
function buildUnicornBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: bodyGeometry, pollY, pollZ, pollRadius, headTop } = buildHorseBodyProfileGeometry(length, width);
  const hornGeometry = buildUnicornHornGeometry(pollY, pollZ, pollRadius);
  const eyesGeometry = buildUnicornEyesGeometry(headTop.y, headTop.z, headTop.radius);
  const merged = mergeGeometriesWithColor([
    { geometry: bodyGeometry, color: new THREE.Color(0xffffff) },
    { geometry: hornGeometry, color: UNICORN_HORN_COLOR },
    { geometry: eyesGeometry, color: UNICORN_EYE_COLOR },
  ]);
  bodyGeometry.dispose();
  hornGeometry.dispose();
  eyesGeometry.dispose();
  return merged;
}


// Gold, to make the horn stand out clearly against the lavender body
// rather than blending in as just another body-colored bump.
const UNICORN_HORN_COLOR = new THREE.Color(0xffd54a);
// Legs stay white (neutral — multiplies harmlessly against the lavender
// per-instance body tint), hooves are tinted dark gray so they read as a
// distinct hoof rather than continuing the body's color.
const UNICORN_LEG_COLOR = new THREE.Color(0xffffff);
const UNICORN_HOOF_COLOR = new THREE.Color(0x3a3a3a);
// Near-black "dark dot" eyes.
const UNICORN_EYE_COLOR = new THREE.Color(0x101014);
// Multiplied against the lavender per-instance body tint (not an
// absolute color) to make the muzzle read as a darker shade of purple
// rather than just another lavender patch — see buildHorseBodyProfileGeometry.
const UNICORN_MUZZLE_TINT = new THREE.Color(0.55, 0.35, 0.75);
// Neutral multiplier (no tint) for spine rings without an explicit color.
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);


/**
 * A single point along the body's centerline spine, used to sweep a
 * cross-section along to build the torso/neck/head (see
 * buildHorseBodyProfileGeometry). `y` is the body's forward axis
 * (matches FORWARD_AXIS), `z` is how far up/down the spine sits at that
 * point (dorsal axis — see WORLD_UP_AXIS/MODEL_UP_AXIS), and `radius` is
 * the baseline size of the cross-section there (see crossSectionOffset).
 * `zScale` optionally overrides how tall (vs. wide) the cross-section is
 * at this one point (see crossSectionOffset) — used to flatten the
 * muzzle relative to the rest of the body. `color` optionally tints just
 * this ring (e.g. a darker purple for the muzzle); rings without an
 * explicit color default to white (no tint).
 */
interface SpinePoint {
  y: number;
  z: number;
  radius: number;
  zScale?: number;
  color?: THREE.Color;
}


/**
 * A rounded-square ("squircle") cross-section, deliberately *not* a
 * circle: flatter sides than an ellipse would give, and taller (in Z)
 * than it is wide (in X) — a real horse's barrel/neck reads as a
 * flattened-oval column, not a perfect cylinder. Using a Lamé-curve
 * exponent > 2 (rather than radiusX === radiusZ and a plain circle, or
 * an ellipse at exponent 2) is what produces the flatter sides. zScale
 * (default 1) scales just the Z (height) radius, letting individual
 * rings — namely the muzzle — flatten out relative to the rest of the
 * body.
 */
function crossSectionOffset(radius: number, angle: number, zScale: number = 1): { x: number; z: number } {
  const radiusX = radius * 0.85;
  // Height:width ratio eased slightly (1.05 vs the previous 1.2) — still
  // taller than wide per direct feedback, just a little less extreme.
  const radiusZ = radius * 1.05 * zScale;
  const squareness = 4;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = radiusX * Math.sign(c) * Math.pow(Math.abs(c), 2 / squareness);
  const z = radiusZ * Math.sign(s) * Math.pow(Math.abs(s), 2 / squareness);
  return { x, z };
}


/**
 * Sweeps the crossSectionOffset ring along a spine path in the Y-Z plane
 * (see SpinePoint) to build the torso, replacing the earlier single-axis
 * THREE.LatheGeometry approach — a lathe can only ever produce a
 * circular cross-section revolved straight along one axis, which can't
 * give flattened/non-circular cross-sections (per direct feedback) or a
 * neck/head that rises and bends away from the torso's axis (also per
 * direct feedback: "a distinct neck that projects... at an upward angle,
 * and a horse-shaped head pointing somewhat downward"). Ring cross-
 * sections here stay in X-Z planes (perpendicular to the *body's* Y
 * axis, not tangent to the spine path) rather than tangent-frame swept —
 * a simplification that's visually fine for the gentle bend used here
 * and much simpler than tracking a full parallel-transport frame.
 *
 * Outward-facing triangle winding is verified per-triangle (see
 * pushOutwardTri) rather than derived analytically, so it's correct
 * regardless of the cross-section/spine parameterization above. Colors
 * are carried per-vertex (not per-triangle) from each ring's SpinePoint,
 * so a color change between two adjacent rings (e.g. entering the
 * muzzle) blends smoothly across that connecting band instead of
 * snapping abruptly.
 */
function buildHorseBodyProfileGeometry(
  length: number,
  width: number,
): {
  geometry: THREE.BufferGeometry;
  pollY: number;
  pollZ: number;
  pollRadius: number;
  headTop: { y: number; z: number; radius: number };
} {
  const halfLen = length * 0.5;
  const spine: SpinePoint[] = [
    // Torso (tail root -> withers) scaled ~12% shorter toward the withers
    // anchor point — per direct feedback the body read as slightly too
    // long overall (neck/head keep their own already-tuned proportions
    // below, scaled the same way in an earlier feedback round).
    { y: -halfLen * 0.8, z: 0, radius: width * 0.04 }, // tail root (rump end)
    { y: -halfLen * 0.62, z: length * 0.01, radius: width * 0.32 }, // hindquarter
    { y: -halfLen * 0.29, z: length * 0.02, radius: width * 0.4 }, // barrel (widest point)
    { y: -halfLen * 0.01, z: length * 0.02, radius: width * 0.34 }, // chest/shoulder
    { y: halfLen * 0.08, z: length * 0.1, radius: width * 0.22 }, // withers — neck starts rising
    // Neck (withers -> poll) shortened to ~2/3 of its previous length —
    // per direct feedback the neck read as too long. Scaled toward the
    // withers point rather than re-deriving from scratch.
    { y: halfLen * 0.147, z: length * 0.193, radius: width * 0.17 }, // neck, lower-mid
    { y: halfLen * 0.207, z: length * 0.287, radius: width * 0.13 }, // neck, upper-mid
    { y: halfLen * 0.247, z: length * 0.353, radius: width * 0.12 }, // poll — peak of the neck, horn sits here
    // Head (poll -> muzzle) keeps its original shape/proportions,
    // just re-anchored to the new, closer-in poll position above.
    // Head shortened (poll -> muzzle distance scaled toward the poll)
    // and widened (radii increased) per direct feedback: "slightly
    // wider and slightly shorter".
    { y: halfLen * 0.303, z: length * 0.337, radius: width * 0.16 }, // top of head, starting to bend down+forward
    // Mouth/muzzle area: flattened (reduced zScale) and tinted a darker
    // purple (multiplies against the lavender instance color) so it
    // reads as a distinct muzzle rather than a continuation of the neck.
    // Widened considerably and the taper eased (radii step down more
    // gradually from the head/poll instead of pinching sharply) — per
    // direct feedback the previous abrupt taper read as an anteater
    // snout rather than a horse muzzle, and the muzzle itself needed to
    // end larger.
    { y: halfLen * 0.373, z: length * 0.277, radius: width * 0.145, zScale: 0.75, color: UNICORN_MUZZLE_TINT }, // nose bridge — head angling down
    { y: halfLen * 0.447, z: length * 0.161, radius: width * 0.09, zScale: 0.68, color: UNICORN_MUZZLE_TINT }, // muzzle tip — down and forward of the poll
  ];

  const segments = 10;
  const rings: THREE.Vector3[][] = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      const { x, z } = crossSectionOffset(point.radius, angle, point.zScale ?? 1);
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });
  const ringColors: THREE.Color[] = spine.map((point) => point.color ?? WHITE_VERTEX_COLOR);

  const positions: number[] = [];
  const colors: number[] = [];
  const pushOutwardTri = (
    a: THREE.Vector3,
    colorA: THREE.Color,
    b: THREE.Vector3,
    colorB: THREE.Color,
    c: THREE.Vector3,
    colorC: THREE.Color,
    center: THREE.Vector3,
  ) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const faceNormal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    const pushVertex = (p: THREE.Vector3, color: THREE.Color) => {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    };
    if (faceNormal.dot(outward) < 0) {
      pushVertex(a, colorA);
      pushVertex(c, colorC);
      pushVertex(b, colorB);
    } else {
      pushVertex(a, colorA);
      pushVertex(b, colorB);
      pushVertex(c, colorC);
    }
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const ringA = rings[i];
    const ringB = rings[i + 1];
    const colorA = ringColors[i];
    const colorB = ringColors[i + 1];
    const center = new THREE.Vector3(
      0,
      (spine[i].y + spine[i + 1].y) / 2,
      (spine[i].z + spine[i + 1].z) / 2,
    );
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      pushOutwardTri(ringA[j], colorA, ringA[k], colorA, ringB[j], colorB, center);
      pushOutwardTri(ringA[k], colorA, ringB[k], colorB, ringB[j], colorB, center);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();

  const poll = spine[7];
  const headTopPoint = spine[8];
  return {
    geometry,
    pollY: poll.y,
    pollZ: poll.z,
    pollRadius: poll.radius,
    headTop: { y: headTopPoint.y, z: headTopPoint.z, radius: headTopPoint.radius },
  };
}


/**
 * Two small dark "dot" eyes, placed on either side of the head near the
 * poll/head-top junction (roughly where a real horse's eyes sit — at
 * the base of the head, not out on the muzzle) and merged into the body
 * geometry via mergeGeometriesWithColor. Uses the same outward-normal-
 * safe approach as the rest of the body (a sphere's normals are already
 * correct outward from its own center, so no extra winding fix-up is
 * needed here).
 */
function buildUnicornEyesGeometry(headTopY: number, headTopZ: number, headTopRadius: number): THREE.BufferGeometry {
  const eyeRadius = headTopRadius * 0.22;
  const sideOffset = headTopRadius * 0.8;
  const upOffset = headTopRadius * 0.15;
  const leftEye = new THREE.SphereGeometry(eyeRadius, 8, 6);
  leftEye.translate(-sideOffset, headTopY, headTopZ + upOffset);
  const rightEye = new THREE.SphereGeometry(eyeRadius, 8, 6);
  rightEye.translate(sideOffset, headTopY, headTopZ + upOffset);
  return mergePositionOnlyGeometries([leftEye, rightEye]);
}


/**
 * Four bent legs with distinct, explicitly-angled joints (measured from
 * straight down) modeled directly on real horse-leg anatomy, plus a
 * dark-gray hoof tint — per direct, detailed feedback describing the
 * exact joint bends to use. Built as true box-section segments (see
 * pushBoxSegment) rather than a flat, zero-depth ribbon (which had no
 * thickness front-to-back, so it visually vanished from some viewing
 * angles — "2D instead of 3D"/"appear and disappear"). Built along local
 * -Z ("belly-down") so they hang beneath the body rather than
 * overlapping the wings, which lie in the Z=0 plane.
 *
 * Front leg: upper segment juts forward from the hip, the lower segment
 * (below the knee) sweeps back just past vertical, and the hoof bends
 * back further still.
 * Rear leg: upper segment (thigh) angles backward from the hip at ~45
 * degrees, the lower segment (below the hock) swings forward again to
 * about 30 degrees off vertical (not all the way back to vertical), and
 * the hoof bends backward, same as the front.
 */
function buildUnicornLegsGeometry(length: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  };

  // Outward-normal-safe box segment between two points, with a
  // rectangular (legWidth x legDepth) cross-section — a real 3D volume
  // with thickness along both the left-right (X) and front-back (Y)
  // axes, unlike a flat single-axis-offset ribbon.
  function pushBoxSegment(
    a: THREE.Vector3,
    b: THREE.Vector3,
    halfX: number,
    halfY: number,
    capStart: boolean,
    capEnd: boolean,
    color: THREE.Color,
  ) {
    const corner = (p: THREE.Vector3, sx: number, sy: number) => new THREE.Vector3(p.x + sx * halfX, p.y + sy * halfY, p.z);
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const ca = signs.map(([sx, sy]) => corner(a, sx, sy));
    const cb = signs.map(([sx, sy]) => corner(b, sx, sy));
    const axisCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, center: THREE.Vector3) => {
      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const normal = new THREE.Vector3().crossVectors(e1, e2);
      const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
      const outward = new THREE.Vector3().subVectors(centroid, center);
      if (normal.dot(outward) < 0) {
        pushTri(p0, p2, p1, color);
      } else {
        pushTri(p0, p1, p2, color);
      }
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pushOutward(ca[i], cb[i], cb[j], axisCenter);
      pushOutward(ca[i], cb[j], ca[j], axisCenter);
    }
    if (capStart) {
      pushOutward(ca[0], ca[1], ca[2], axisCenter);
      pushOutward(ca[0], ca[2], ca[3], axisCenter);
    }
    if (capEnd) {
      pushOutward(cb[0], cb[1], cb[2], axisCenter);
      pushOutward(cb[0], cb[2], cb[3], axisCenter);
    }
  }

  // Angle is measured from straight down (-Z); positive = forward (+Y),
  // negative = backward (-Y) — matches how each joint bend was described.
  function jointOffset(angleDeg: number, segLength: number): { dy: number; dz: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return { dy: Math.sin(rad) * segLength, dz: -Math.cos(rad) * segLength };
  }

  function buildLeg(hipX: number, hipY: number, hipZ: number, upperAngleDeg: number, lowerAngleDeg: number, hoofAngleDeg: number) {
    const legLength = length * 0.38;
    const legHalfWidth = width * 0.09;
    const legHalfDepth = width * 0.07;
    const flareX = hipX * 1.05;

    const hip = new THREE.Vector3(hipX, hipY, hipZ);
    const upper = jointOffset(upperAngleDeg, legLength * 0.42);
    const knee = new THREE.Vector3(flareX, hipY + upper.dy, hipZ + upper.dz);
    const lower = jointOffset(lowerAngleDeg, legLength * 0.42);
    const hoofTop = new THREE.Vector3(flareX, knee.y + lower.dy, knee.z + lower.dz);
    const hoof = jointOffset(hoofAngleDeg, legLength * 0.16);
    const hoofTip = new THREE.Vector3(flareX, hoofTop.y + hoof.dy, hoofTop.z + hoof.dz);

    pushBoxSegment(hip, knee, legHalfWidth, legHalfDepth, true, false, UNICORN_LEG_COLOR);
    pushBoxSegment(knee, hoofTop, legHalfWidth * 0.85, legHalfDepth * 0.85, false, false, UNICORN_LEG_COLOR);
    // Small squared-off hoof block, tinted dark gray to read as a hoof
    // distinct from the rest of the leg, instead of the dragon's fanned
    // claws.
    pushBoxSegment(hoofTop, hoofTip, legHalfWidth * 0.7, legHalfDepth * 0.7, false, true, UNICORN_HOOF_COLOR);
  }

  const frontY = length * 0.02; // near the chest
  const backY = -length * 0.42; // near the haunch
  const stanceX = width * 0.26;
  // Legs now emerge a bit lower on the belly (more negative Z, "down")
  // rather than right at the body's central spine axis (z=0) — per
  // direct feedback the legs looked like they came out too high up the
  // barrel rather than from the underside of the body.
  const hipZ = -width * 0.16;

  // Front legs: jut forward (+35 deg), lower leg sweeps back just past
  // vertical (-15 deg), hoof bends back further (-35 deg).
  buildLeg(-stanceX, frontY, hipZ, 35, -15, -35);
  buildLeg(stanceX, frontY, hipZ, 35, -15, -35);
  // Rear legs: thigh angles back further (-58 deg, was -45 — "top of the
  // leg should point farther backward"), and the hock/knee bend is wider
  // now so the lower leg swings only slightly forward of vertical
  // (-10 deg, was +30 — "bottom half of the legs point slightly
  // backward" instead of forward), hoof bends back (-35 deg) same as
  // the front.
  buildLeg(-stanceX, backY, hipZ, -58, -10, -35);
  buildLeg(stanceX, backY, hipZ, -58, -10, -35);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * A long, flowing tail hanging from the rump, built the same way as the
 * legs (true 3D box-section segments — see pushBoxSegment in
 * buildUnicornLegsGeometry — not a flat, zero-depth ribbon) so it has
 * real depth from every viewing angle. The tail starts by curving up and
 * back at a 45 degree angle right at the rump (a natural little flick,
 * like a horse tail lifted at the dock), then sweeps progressively
 * downward along its length as if gravity were pulling the loose hair
 * down, ending pointing mostly straight down (and very slightly forward,
 * curling under) by the tip. Built from several segments (7, giving 6
 * internal joints) so the curve reads as a smooth arc rather than a
 * single rigid straight or bent piece. Tinted with the same violet-root
 * -> red-tip rainbow gradient as the wings (see
 * addRainbowVertexColorsByDistance) for a more dramatic look than a flat
 * tint, and tapers from a thicker root to a thin tip.
 */
function buildUnicornTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  };

  // Same outward-normal-safe box-segment helper used by the legs (see
  // buildUnicornLegsGeometry's pushBoxSegment) — a real 3D volume with
  // thickness along both the left-right (X) and front-back (Y) axes,
  // rather than a flat single-axis-offset ribbon.
  function pushBoxSegment(
    a: THREE.Vector3,
    b: THREE.Vector3,
    halfX: number,
    halfY: number,
    capStart: boolean,
    capEnd: boolean,
    color: THREE.Color,
  ) {
    const corner = (p: THREE.Vector3, sx: number, sy: number) => new THREE.Vector3(p.x + sx * halfX, p.y + sy * halfY, p.z);
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const ca = signs.map(([sx, sy]) => corner(a, sx, sy));
    const cb = signs.map(([sx, sy]) => corner(b, sx, sy));
    const axisCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, center: THREE.Vector3) => {
      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const normal = new THREE.Vector3().crossVectors(e1, e2);
      const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
      const outward = new THREE.Vector3().subVectors(centroid, center);
      if (normal.dot(outward) < 0) {
        pushTri(p0, p2, p1, color);
      } else {
        pushTri(p0, p1, p2, color);
      }
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pushOutward(ca[i], cb[i], cb[j], axisCenter);
      pushOutward(ca[i], cb[j], ca[j], axisCenter);
    }
    if (capStart) {
      pushOutward(ca[0], ca[1], ca[2], axisCenter);
      pushOutward(ca[0], ca[2], ca[3], axisCenter);
    }
    if (capEnd) {
      pushOutward(cb[0], cb[1], cb[2], axisCenter);
      pushOutward(cb[0], cb[2], cb[3], axisCenter);
    }
  }

  // Longer than the previous stubby tail — a real flowing horse tail
  // rather than a short bunch.
  const tailLength = length * 0.68;
  const numSegments = 7; // 6 internal joints between root and tip
  // Trails mostly backward with a gentle downward sag, rather than
  // curling almost straight down (-95deg tip, from an earlier pass tuned
  // for a different flight-pose model) — now that unicorns fly upright
  // and nearly flat (see updateInstances' uprightStyle === 'unicorn'),
  // a tail hanging down like a rope under gravity reads wrong; a mostly-
  // horizontal streaming tail (like a horse's tail flowing behind it in
  // motion, e.g. the reference pegasus image) reads much better.
  const startAngleDeg = 20; // slight up-and-back flick right at the rump
  const endAngleDeg = -30; // trailing back with a gentle downward droop at the tip
  const smoothstep = (t: number) => t * t * (3 - 2 * t);

  // Root anchor matches the body's now-slightly-shorter rump (tail root
  // spine point, see buildHorseBodyProfileGeometry) so the tail still
  // starts flush against the body rather than floating off the back of a
  // now-shorter torso.
  const root = new THREE.Vector3(0, -halfLen * 0.78, width * 0.05);
  const points: THREE.Vector3[] = [root];
  let prev = root;
  const segLength = tailLength / numSegments;
  for (let i = 0; i < numSegments; i++) {
    const tMid = (i + 0.5) / numSegments;
    const angleDeg = THREE.MathUtils.lerp(startAngleDeg, endAngleDeg, smoothstep(tMid));
    const rad = (angleDeg * Math.PI) / 180;
    // angleDeg measured from the backward horizontal (-Y): positive
    // tilts upward (+Z), negative tilts downward, and as it swings past
    // -90 the backward component flips slightly forward (curling under).
    const dy = -Math.cos(rad) * segLength;
    const dz = Math.sin(rad) * segLength;
    const next = new THREE.Vector3(0, prev.y + dy, prev.z + dz);
    points.push(next);
    prev = next;
  }

  const rootHalfWidth = width * 0.15;
  const tipHalfWidth = width * 0.03;
  for (let i = 0; i < points.length - 1; i++) {
    const t = i / (points.length - 2);
    const halfX = THREE.MathUtils.lerp(rootHalfWidth, tipHalfWidth, t);
    const halfY = halfX * 0.8;
    pushBoxSegment(points[i], points[i + 1], halfX, halfY, i === 0, i === points.length - 2, WHITE_VERTEX_COLOR);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();

  const tip = points[points.length - 1];
  addRainbowVertexColorsByDistance(geometry, root, root.distanceTo(tip));
  return geometry;
}


/**
 * A single horn standing straight up (local +Z, the model's dorsal/up
 * direction — see the wings' shared Z=0 plane) from the poll (top of the
 * neck, where the profile's Z is at its peak — see
 * buildHorseBodyProfileGeometry's spine array), rather than jutting
 * forward off the nose — a horn "sticking up" is the single most
 * important unicorn-vs-bird visual read. Kept small and proportionate to
 * the horse-scaled head, rather than the oversized spike of the first
 * pass.
 */
function buildUnicornHornGeometry(
  pollY: number,
  pollZ: number,
  pollRadius: number,
): THREE.BufferGeometry {
  const hornLength = pollRadius * 1.95; // 1.3 * 1.5 — 50% larger, per feedback
  const hornRadius = pollRadius * 0.45; // 0.3 * 1.5
  const cone = new THREE.ConeGeometry(hornRadius, hornLength, 8);
  // ConeGeometry is built along +Y by default, apex at +Y/2, base at
  // -Y/2. Rotating +90 degrees about X maps +Y onto +Z, sending the
  // apex to +Z (up) — rotating the *other* way (-90 degrees, the
  // previous code here) instead sends +Y to -Z, which put the apex
  // pointing down and the (wider) base up: an upside-down cone.
  cone.rotateX(Math.PI / 2);
  // Base sits right at the skull surface (pollRadius above the spine
  // axis at the poll) and extends further upward from there.
  cone.translate(0, pollY, pollZ + pollRadius + hornLength / 2);
  return cone;
}

