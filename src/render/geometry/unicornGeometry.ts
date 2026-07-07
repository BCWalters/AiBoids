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
 * Horse-proportioned torso plus a small horn, small paired ears, a
 * flowing neck mane, and a rounded nose bulb merged onto the top/front
 * of the head/neck — see buildHorseBodyProfileGeometry /
 * buildUnicornHornGeometry / buildUnicornEarsGeometry /
 * buildUnicornManeGeometry / buildUnicornNoseGeometry. (An earlier pass
 * added ears that read wildly out of proportion and they were dropped;
 * this pass re-adds them at a much smaller scale — see
 * buildUnicornEarsGeometry's doc comment.) The horn is baked gold via
 * mergeGeometriesWithColor so it stands out against the lavender body —
 * see that helper's doc comment for why vertex colors (rather than a
 * second material) are needed here.
 */
function buildUnicornBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: bodyGeometry, pollY, pollZ, pollRadius, headTop, muzzleTip } = buildHorseBodyProfileGeometry(length, width);
  const hornGeometry = buildUnicornHornGeometry(pollY, pollZ, pollRadius);
  const earsGeometry = buildUnicornEarsGeometry(pollY, pollZ, pollRadius);
  const eyesGeometry = buildUnicornEyesGeometry(headTop.y, headTop.z, headTop.radius);
  const maneGeometry = buildUnicornManeGeometry(length, width, pollY, pollZ, pollRadius);
  const noseGeometry = buildUnicornNoseGeometry(muzzleTip.y, muzzleTip.z, muzzleTip.radius);
  const merged = mergeGeometriesWithColor([
    { geometry: bodyGeometry, color: new THREE.Color(0xffffff) },
    { geometry: hornGeometry, color: UNICORN_HORN_COLOR },
    { geometry: earsGeometry, color: new THREE.Color(0xffffff) },
    { geometry: eyesGeometry, color: UNICORN_EYE_COLOR },
    { geometry: maneGeometry, color: new THREE.Color(0xffffff) },
    { geometry: noseGeometry, color: UNICORN_MUZZLE_TINT },
  ]);
  bodyGeometry.dispose();
  hornGeometry.dispose();
  earsGeometry.dispose();
  eyesGeometry.dispose();
  maneGeometry.dispose();
  noseGeometry.dispose();
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
  muzzleTip: { y: number; z: number; radius: number };
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
    { y: halfLen * 0.29, z: length * 0.345, radius: width * 0.185 }, // top of head/forehead, starting to bend down+forward
    // Cheek/jaw bulge — a distinct wider point partway down the face
    // (real horses have a noticeably thicker jaw/cheek area right below
    // the forehead, before the face narrows into the muzzle) so the
    // taper isn't one continuous pinch from poll to nose-tip, which read
    // as a thin anteater snout. zScale eased slightly (0.9, not fully
    // round) since the jaw is a touch flatter than the throat/neck.
    { y: halfLen * 0.325, z: length * 0.32, radius: width * 0.175, zScale: 0.9 }, // cheek/jaw
    // Mouth/muzzle area: flattened (reduced zScale) and tinted a darker
    // purple (multiplies against the lavender instance color) so it
    // reads as a distinct muzzle rather than a continuation of the neck.
    // Shortened considerably (was reaching halfLen*0.447 — a long thin
    // taper that read as an anteater snout) and the taper eased so the
    // muzzle stays noticeably thick right up until the blunt nose tip.
    { y: halfLen * 0.365, z: length * 0.29, radius: width * 0.15, zScale: 0.8, color: UNICORN_MUZZLE_TINT }, // nose bridge — head angling down
    { y: halfLen * 0.4, z: length * 0.24, radius: width * 0.115, zScale: 0.72, color: UNICORN_MUZZLE_TINT }, // muzzle tip — blunt, not pinched to a point
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

  // Cap the muzzle-tip ring with a flat fan of triangles. Without this,
  // the sweep's final ring was simply an open hole — combined with the
  // small terminal radius there, the head read as tapering to a bare
  // point/hollow "anteater snout" rather than ending in a blunt nose
  // surface (per direct feedback: "it looks like it's missing its nose
  // ... ends at a point"). A flat cap alone gives a blunt end; the
  // rounded nose bulb merged in separately (see buildUnicornNoseGeometry)
  // sits just in front of this cap for the fleshy "muzzle" read.
  const tipIndex = spine.length - 1;
  const tipRing = rings[tipIndex];
  const tipColor = ringColors[tipIndex];
  // A point behind the tip (toward the previous ring) so pushOutwardTri
  // can correctly tell the cap's outward direction is forward (+Y).
  const tipCapBehind = new THREE.Vector3(0, spine[tipIndex - 1].y, spine[tipIndex - 1].z);
  const tipCenter = new THREE.Vector3(0, spine[tipIndex].y, spine[tipIndex].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(tipCenter, tipColor, tipRing[j], tipColor, tipRing[k], tipColor, tipCapBehind);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();

  const poll = spine[7];
  const headTopPoint = spine[8];
  const muzzleTipPoint = spine[spine.length - 1];
  return {
    geometry,
    pollY: poll.y,
    pollZ: poll.z,
    pollRadius: poll.radius,
    headTop: { y: headTopPoint.y, z: headTopPoint.z, radius: headTopPoint.radius },
    muzzleTip: { y: muzzleTipPoint.y, z: muzzleTipPoint.z, radius: muzzleTipPoint.radius },
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
 * A subtle rounded nose-cap (tinted the same muzzle purple as the nose
 * bridge — see buildHorseBodyProfileGeometry) sitting flush against the
 * muzzle-tip ring, plus two small dark nostril dots. Per direct
 * feedback ("looking at the unicorn... it looks like it's missing its
 * nose, from the side it looks like it ends at a point") — the
 * swept-tube head profile's final ring, even now capped flat (see
 * buildHorseBodyProfileGeometry), still read as an abrupt/pointed
 * cutoff rather than an actual nose. A first pass at fixing this used a
 * full sphere offset forward of the tip, which then read as a distinct
 * ball sticking out ("like a Rudolph nose") rather than part of the
 * face. This is a half-sphere (thetaLength = PI/2, so only the dome
 * half is built, with a flat cut face at the equator) sized close to
 * the tip ring's own radius and sitting almost flush against it (only
 * a small forward offset) — a gentle rounded pad blending into the
 * muzzle rather than a separate protruding bulb.
 */
function buildUnicornNoseGeometry(muzzleTipY: number, muzzleTipZ: number, muzzleTipRadius: number): THREE.BufferGeometry {
  const bulbRadius = muzzleTipRadius * 0.7;
  const bulbRadiusZ = muzzleTipRadius * 0.55;
  // Only a small fraction of the bulb's own radius pokes past the
  // tip ring — mostly flush with it, not projecting forward as its own
  // separate shape.
  const noseY = muzzleTipY + bulbRadius * 0.2;
  // thetaStart=0, thetaLength=PI/2 keeps just the pole cap (a dome/half-
  // sphere bulging forward in local +Y, the sphere's default pole axis,
  // which already matches the model's forward axis here) with a flat
  // circular cut face at the equator — no full-sphere "ball" silhouette.
  const bulb = new THREE.SphereGeometry(bulbRadius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  bulb.scale(1, 1, bulbRadiusZ / bulbRadius);
  bulb.translate(0, noseY, muzzleTipZ);

  const nostrilRadius = muzzleTipRadius * 0.15;
  const nostrilSideOffset = muzzleTipRadius * 0.35;
  const nostrilY = noseY + bulbRadius * 0.4;
  const leftNostril = new THREE.SphereGeometry(nostrilRadius, 6, 5);
  leftNostril.translate(-nostrilSideOffset, nostrilY, muzzleTipZ);
  const rightNostril = new THREE.SphereGeometry(nostrilRadius, 6, 5);
  rightNostril.translate(nostrilSideOffset, nostrilY, muzzleTipZ);

  const merged = mergeGeometriesWithColor([
    { geometry: bulb, color: UNICORN_MUZZLE_TINT },
    { geometry: leftNostril, color: UNICORN_EYE_COLOR },
    { geometry: rightNostril, color: UNICORN_EYE_COLOR },
  ]);
  bulb.dispose();
  leftNostril.dispose();
  rightNostril.dispose();
  return merged;
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
  // Rear hip Y was -length*0.42 — *behind* the body's own rear-most spine
  // point (the tail root sits at -halfLen*0.8 = -length*0.4, see
  // buildHorseBodyProfileGeometry), so the back legs floated in empty
  // space past the rump instead of actually attaching to the haunch —
  // read as "detached" legs. Moved forward into the hindquarter bulge
  // (spine's hindquarter ring sits at -halfLen*0.62 = -length*0.31,
  // radius width*0.32 — the widest part of the rear body) so the hip
  // socket sits inside/at the body surface.
  const backY = -length * 0.3; // inside the hindquarter bulge
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


/**
 * Two small paired ears flanking the horn at the poll, tilted slightly
 * outward and back. An earlier attempt at ears read "wildly out of
 * proportion" and was removed; the fix here is scale — these are sized
 * as a small fraction of the horn (which is itself already tuned small
 * relative to the head), not the head/body directly, so they can't
 * balloon out of proportion the way a width-relative size did before.
 * Built as flattened cones (short, wide-based, tapering to a point) so
 * they read as small horse ears rather than horn-like spikes.
 */
function buildUnicornEarsGeometry(pollY: number, pollZ: number, pollRadius: number): THREE.BufferGeometry {
  const earLength = pollRadius * 0.85;
  const earRadius = pollRadius * 0.4;
  const sideOffset = pollRadius * 0.55;
  // Ears sit just behind/beside the horn base, not stacked directly on
  // top of it, and lean outward+backward (away from the face) the way a
  // real horse's ears angle.
  const baseZ = pollZ + pollRadius * 0.55;
  const baseY = pollY - pollRadius * 0.25;

  function buildEar(side: 1 | -1): THREE.BufferGeometry {
    const ear = new THREE.ConeGeometry(earRadius, earLength, 6);
    ear.rotateX(Math.PI / 2); // point along +Z like the horn, before leaning
    // Lean outward (away from the midline) and slightly backward.
    ear.rotateY((side * Math.PI) / 8);
    ear.rotateX(-Math.PI / 10);
    ear.translate(side * sideOffset, baseY, baseZ + earLength * 0.4);
    return ear;
  }

  return mergePositionOnlyGeometries([buildEar(1), buildEar(-1)]);
}


/**
 * A flowing mane draping down one side of the neck from the poll back
 * toward the withers, matching the reference pegasus image's most
 * distinctive missing feature. Built the same way as the tail (true 3D
 * box segments — see pushBoxSegment in buildUnicornLegsGeometry/
 * buildUnicornTailGeometry — not a flat ribbon), tapering from a
 * thicker base near the poll to a thin wisp near the withers, and
 * offset to hang along +X (one side of the neck) with a slight
 * trailing lag (-Y) as if blown back in flight, rather than standing
 * straight up off the topline.
 */
function buildUnicornManeGeometry(
  length: number,
  width: number,
  pollY: number,
  pollZ: number,
  pollRadius: number,
): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  };

  // Same outward-normal-safe box-segment helper duplicated in
  // buildUnicornLegsGeometry/buildUnicornTailGeometry — each of these
  // "hair"/"limb" builders stays self-contained rather than sharing a
  // module-level helper, matching this file's existing pattern.
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

  // Anchor points follow the same neck curve used in
  // buildHorseBodyProfileGeometry's spine (withers -> poll), recomputed
  // here from length/width rather than threading the whole spine array
  // through — the mane only needs these four points, and they're cheap
  // to re-derive from the same length-relative fractions. `radius`
  // mirrors each point's actual neck cross-section radius there (also
  // from that same spine array) so the mane can be pushed clear of the
  // neck's own surface at each point, not just at the (much narrower)
  // poll — using a single poll-sized offset for the whole mane buried
  // most of it inside the thicker withers end of the neck.
  const necklinePoints: { y: number; z: number; radius: number }[] = [
    { y: halfLen * 0.08, z: length * 0.1, radius: width * 0.22 }, // withers
    { y: halfLen * 0.147, z: length * 0.193, radius: width * 0.17 },
    { y: halfLen * 0.207, z: length * 0.287, radius: width * 0.13 },
    { y: pollY, z: pollZ, radius: pollRadius }, // poll (base of the mane, just behind the ears/horn)
  ];

  // Root sits a bit above the topline (so the mane reads as hair sitting
  // on top of the neck, not buried inside it) and drapes slightly to one
  // side (+X) with a small backward lag, growing more pronounced toward
  // the withers end as if trailing in the airflow.
  const points: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = necklinePoints.length - 1; i >= 0; i--) {
    const t = (necklinePoints.length - 1 - i) / (necklinePoints.length - 1); // 0 at poll, 1 at withers
    const p = necklinePoints[i];
    const topOffset = p.radius * 0.7;
    const sideDrape = width * 0.06 * (0.3 + t);
    const backLag = length * 0.02 * t;
    points.push(new THREE.Vector3(sideDrape, p.y - backLag, p.z + topOffset));
    radii.push(p.radius);
  }

  // Thickness follows each segment's own neck radius (thicker where the
  // neck itself is thicker, near the withers) rather than a single
  // poll-sized value throughout, which read as too uniformly thin.
  for (let i = 0; i < points.length - 1; i++) {
    const avgRadius = (radii[i] + radii[i + 1]) / 2;
    const halfX = avgRadius * 0.4;
    const halfY = halfX * 0.9;
    pushBoxSegment(points[i], points[i + 1], halfX, halfY, i === 0, i === points.length - 2, WHITE_VERTEX_COLOR);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

