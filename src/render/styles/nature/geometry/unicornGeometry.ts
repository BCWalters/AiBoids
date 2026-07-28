import * as THREE from 'three';
import type { CreatureGeometries, CreatureLegPart } from '../../../geometry/sharedGeometry';
import {
  jointBarrelForBoxSection,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  pushJointBarrel,
  smoothNormalsByPosition,
} from '../../../geometry/sharedGeometry';
import type { PartDrive, Triple } from '../../../motion/rig';
import { buildFingeredWingGeometry } from './birdSharedGeometry';

/**
 * How the cannon bone folds relative to the thigh above it.
 *
 * The unicorn flies rather than runs, so its legs shouldn't gallop — they
 * should retract like landing gear as it picks up speed and hang loose when it
 * slows. The shared leg drive already produces exactly that shape (an
 * oscillation plus a speed-proportional draw-back), so the knee reuses it with
 * two changes:
 *
 *  - it bends *further* than the hip swings, because in a real fold the lower
 *    leg closes up more than the thigh rotates, and that closing is what reads
 *    as a joint rather than a stiff plank
 *  - it lags slightly behind the hip, since a limb segment is dragged by the
 *    one above it rather than moving in lockstep with it
 *
 * There is deliberately no rest offset: the resting bend is already baked into
 * the geometry, so leaving this at zero keeps a stationary unicorn posed
 * exactly as it was before it could bend at all.
 */
const UNICORN_KNEE_DRIVE: PartDrive = {
  source: 'legSwing',
  amplitudeScale: 1.35,
  phaseOffsetRad: -0.45,
};

/**
 * Radial cross-section segments for the unicorn body sweep.  Raising this
 * from the old value of 10 gives the body a smoothly rounded silhouette
 * rather than a visibly faceted one (issues #247).  Exported so the
 * creatureSmoothness regression test can assert the exact resulting
 * triangle count against this constant.
 */
export const UNICORN_BODY_RADIAL_SEGMENTS = 16;

// Rainbow vertex-color gradients used only by the unicorn's pegasus
// wings and rainbow tail (violet at the root, red at the tip), read by a
// vertexColors-enabled material — see Renderer3D's buildRenderBatch
// rainbowWings handling. Kept local to this file since the unicorn is
// their sole user.

/**
 * Bakes a rainbow hue gradient (violet at the wing root, red at the tip)
 * into a per-vertex 'color' attribute, read by a vertexColors-enabled
 * material — see Renderer3D's buildRenderBatch rainbowWings handling.
 * The base geometry (position-only triangle soup) is otherwise
 * untouched, so this can wrap any of the flat-shaded wing builders above.
 */
function addRainbowVertexColors(geometry: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(Math.abs(position.getX(i)) / span, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Same idea as addRainbowVertexColors, but the gradient follows straight-
 * line distance from a given root point (e.g. where the tail meets the
 * rump) rather than |x| — needed for parts like the tail whose "root to
 * tip" axis isn't a simple left-right span.
 */
function addRainbowVertexColorsByDistance(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  maxDistance: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(vertex.distanceTo(root) / maxDistance, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

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
  const legs = buildUnicornLegParts(length, width);

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
  const { geometry: bodyGeometry, pollY, pollZ, pollRadius, headTop } = buildHorseBodyProfileGeometry(length, width);
  const hornGeometry = buildUnicornHornGeometry(pollY, pollZ, pollRadius);
  const earsGeometry = buildUnicornEarsGeometry(pollY, pollZ, pollRadius);
  const eyesGeometry = buildUnicornEyesGeometry(headTop.y, headTop.z, headTop.radius);
  // The mane is deliberately absent. buildUnicornManeGeometry built a single
  // chunky 4-sided box-section strand draped along +X only, so the neck read
  // as smooth and round from the left and hard-edged and blocky from the
  // right — an asymmetry that looked like a modelling defect rather than
  // hair. A bare, smooth neck reads better than a one-sided blocky one, so
  // it stays off until there's a real mane (many fine strands, or a shaped
  // crest sitting symmetrically on the topline).
  const merged = mergeGeometriesWithColor([
    { geometry: bodyGeometry, color: new THREE.Color(0xffffff) },
    { geometry: hornGeometry, color: UNICORN_HORN_COLOR },
    { geometry: earsGeometry, color: new THREE.Color(0xffffff) },
    { geometry: eyesGeometry, color: UNICORN_EYE_COLOR },
  ]);
  bodyGeometry.dispose();
  hornGeometry.dispose();
  earsGeometry.dispose();
  eyesGeometry.dispose();
  return merged;
}


// Gold, to make the horn stand out clearly against the lavender body
// rather than blending in as just another body-colored bump.
const UNICORN_HORN_COLOR = new THREE.Color(0xffd54a);
// Legs carry a neutral multiplier so they render in exactly the per-instance
// body color. They used to be tinted a lighter lavender (0xd8cef0) to
// "harmonise" with the body, but a near-match reads as a mismatch: the legs
// looked like separate paler parts stuck onto the horse. Hooves stay dark
// gray so they still read as a distinct hoof.
const UNICORN_LEG_COLOR = new THREE.Color(0xffffff);
const UNICORN_HOOF_COLOR = new THREE.Color(0x3a3a3a);
// Leg cross-section, as fractions of body width. Module-level rather than
// local so the front-leg placement below can be expressed in terms of the
// leg's own front-to-back depth instead of a magic number that would drift
// out of step if the legs were ever made thicker or thinner.
const UNICORN_LEG_HALF_WIDTH_FRAC = 0.09;
const UNICORN_LEG_HALF_DEPTH_FRAC = 0.07;
// Near-black "dark dot" eyes.
const UNICORN_EYE_COLOR = new THREE.Color(0x101014);
// Multiplied against the lavender per-instance body tint (not an
// absolute color) to make the muzzle read as a darker shade of purple
// rather than just another lavender patch — see buildHorseBodyProfileGeometry.
const UNICORN_MUZZLE_TINT = new THREE.Color(0.55, 0.35, 0.75);
// Neutral multiplier (no tint) for spine rings without an explicit color.
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
// Top-of-body tint for the vertical body gradient. Multiplied against the
// per-instance lavender (0xc9a8f0), so components above 1 lighten rather than
// darken. Red and green are lifted well past 1 while blue is left almost
// alone, which walks the lavender toward a very light pink over the topline
// while the underside keeps the body color exactly as it is. Applied per
// vertex by height within each body ring, not per ring, so the transition is
// smooth around the barrel rather than banded along the spine.
const UNICORN_TOP_TINT = new THREE.Color(1.42, 1.3, 1.04);


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
    { y: halfLen * 0.29, z: length * 0.345, radius: width * 0.215 }, // top of head/forehead, starting to bend down+forward
    // Cheek/jaw bulge — a distinct wider point partway down the face
    // (real horses have a noticeably thicker jaw/cheek area right below
    // the forehead, before the face narrows into the muzzle) so the
    // taper isn't one continuous pinch from poll to nose-tip, which read
    // as a thin anteater snout. zScale kept near-round (per feedback the
    // head read as too flat — it now stays rounder/deeper front-to-back).
    { y: halfLen * 0.325, z: length * 0.32, radius: width * 0.205, zScale: 0.97 }, // cheek/jaw
    // Mouth/muzzle area: only gently flattened (reduced zScale) and
    // tinted a darker purple (multiplies against the lavender instance
    // color) so it reads as a distinct muzzle rather than a continuation
    // of the neck. The muzzle is carried forward across several rings —
    // rather than a short taper capped with a separate nose bulb (which
    // read as a disconnected ball and made the face drop off abruptly) —
    // so the head continues forward and rounds off into a blunt horse
    // muzzle, matching real horse-head proportions.
    { y: halfLen * 0.365, z: length * 0.29, radius: width * 0.175, zScale: 0.9, color: UNICORN_MUZZLE_TINT }, // nose bridge — head angling down
    { y: halfLen * 0.4, z: length * 0.245, radius: width * 0.15, zScale: 0.92, color: UNICORN_MUZZLE_TINT }, // upper muzzle
    { y: halfLen * 0.44, z: length * 0.205, radius: width * 0.14, zScale: 0.95, color: UNICORN_MUZZLE_TINT }, // muzzle carried forward
    // Front of the muzzle rounds off: the final rings shrink and their
    // centers rise back up (z increases again) instead of continuing
    // straight down, so the underside/"chin" tucks back up toward the
    // jaw rather than ending in a sharp vertical point. This gives the
    // blunt, slightly up-curled nose front of a real horse muzzle rather
    // than a flat wall dropping to a pointed chin.
    { y: halfLen * 0.47, z: length * 0.185, radius: width * 0.115, zScale: 1.0, color: UNICORN_MUZZLE_TINT }, // nose front — starting to round
    { y: halfLen * 0.487, z: length * 0.2, radius: width * 0.07, zScale: 1.1, color: UNICORN_MUZZLE_TINT }, // rounded nose tip, curling up so the chin recedes
  ];

  const segments = UNICORN_BODY_RADIAL_SEGMENTS;
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

  /**
   * Vertical body gradient: the underside keeps the per-instance body color
   * exactly, and the topline fades to a very light pink.
   *
   * Graded per vertex by its height *within its own ring* rather than by
   * absolute Z. The spine rises and falls a lot between rump, withers and
   * muzzle, so an absolute-Z ramp would put the light end on the head and the
   * dark end on the tail — a front-to-back gradient, not a top-to-bottom one.
   * Normalising against each ring's own half-height instead means every
   * cross-section runs body-color at its belly to pink at its spine, all the
   * way along the horse.
   *
   * Each ring's own tint (the muzzle's darker purple, say) is preserved and
   * the height tint multiplies on top of it, so the muzzle still reads darker
   * while still catching light along its bridge.
   */
  const smoothstep01 = (t: number) => t * t * (3 - 2 * t);
  const gradedColorAt = (base: THREE.Color, vertex: THREE.Vector3, point: SpinePoint): THREE.Color => {
    const halfHeight = point.radius * (point.zScale ?? 1);
    if (halfHeight < 1e-6) return base;
    const t = THREE.MathUtils.clamp(0.5 + (0.5 * (vertex.z - point.z)) / halfHeight, 0, 1);
    const tint = WHITE_VERTEX_COLOR.clone().lerp(UNICORN_TOP_TINT, smoothstep01(t));
    return base.clone().multiply(tint);
  };
  const ringVertexColors: THREE.Color[][] = rings.map((ring, i) =>
    ring.map((vertex) => gradedColorAt(ringColors[i], vertex, spine[i])),
  );

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
    const colorA = ringVertexColors[i];
    const colorB = ringVertexColors[i + 1];
    const center = new THREE.Vector3(
      0,
      (spine[i].y + spine[i + 1].y) / 2,
      (spine[i].z + spine[i + 1].z) / 2,
    );
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      pushOutwardTri(ringA[j], colorA[j], ringA[k], colorA[k], ringB[j], colorB[j], center);
      pushOutwardTri(ringA[k], colorA[k], ringB[k], colorB[k], ringB[j], colorB[j], center);
    }
  }

  // Cap the muzzle-tip ring with a flat fan of triangles. Without this,
  // the sweep's final ring would be an open hole. The muzzle now carries
  // forward across several rings and rounds off (zScale eased back toward
  // 1 at the tip) so this cap sits at the blunt front of the muzzle,
  // reading as a horse's nose end rather than an abrupt cutoff. (An
  // earlier version added a separate rounded nose bulb here, which read
  // as a disconnected ball; it was removed in favor of extending the
  // muzzle itself.)
  const tipIndex = spine.length - 1;
  const tipRing = rings[tipIndex];
  const tipColor = ringVertexColors[tipIndex];
  // A point behind the tip (toward the previous ring) so pushOutwardTri
  // can correctly tell the cap's outward direction is forward (+Y).
  const tipCapBehind = new THREE.Vector3(0, spine[tipIndex - 1].y, spine[tipIndex - 1].z);
  const tipCenter = new THREE.Vector3(0, spine[tipIndex].y, spine[tipIndex].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(
      tipCenter,
      gradedColorAt(ringColors[tipIndex], tipCenter, spine[tipIndex]),
      tipRing[j],
      tipColor[j],
      tipRing[k],
      tipColor[k],
      tipCapBehind,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  // Averaged rather than per-face normals. computeVertexNormals() on this
  // non-indexed sweep gave every triangle its own flat normal, so the body
  // stayed visibly faceted even after PR #267 raised the ring count from 10
  // to 16 — more segments only made the facets smaller, never smooth. The
  // crease rule keeps genuinely sharp joins (muzzle tip, tip cap) crisp.
  smoothNormalsByPosition(geometry);

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
 *
 * That resting bend used to be purely cosmetic: all four legs shared one mesh,
 * so they could only rotate as a single rigid unit and the knee angle never
 * changed — a bend painted onto a plank. The legs are emitted as a four-part
 * rig instead (front/rear x thigh/lower), so the joints actually articulate.
 *
 * Four parts rather than eight because left and right legs of a pair differ
 * only in X, and the swing axis *is* X — so a single pivot line serves both.
 */
function buildUnicornLegParts(length: number, width: number): CreatureLegPart[] {
  // One buffer per rig part rather than one merged buffer for all four legs.
  // A part can only rotate as a unit, so a segment that needs to bend
  // independently needs its own vertices.
  type Buffer = { positions: number[]; colors: number[] };
  const newBuffer = (): Buffer => ({ positions: [], colors: [] });
  const frontUpper = newBuffer();
  const frontLower = newBuffer();
  const rearUpper = newBuffer();
  const rearLower = newBuffer();
  let sink: Buffer = frontUpper;
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    sink.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    sink.colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
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

  function buildLeg(
    hipX: number,
    hipY: number,
    hipZ: number,
    upperAngleDeg: number,
    lowerAngleDeg: number,
    hoofAngleDeg: number,
    upperBuffer: Buffer,
    lowerBuffer: Buffer,
  ): THREE.Vector3 {
    const legLength = length * 0.38;
    const legHalfWidth = width * UNICORN_LEG_HALF_WIDTH_FRAC;
    const legHalfDepth = width * UNICORN_LEG_HALF_DEPTH_FRAC;
    const flareX = hipX * 1.05;

    const hip = new THREE.Vector3(hipX, hipY, hipZ);
    const upper = jointOffset(upperAngleDeg, legLength * 0.42);
    const knee = new THREE.Vector3(flareX, hipY + upper.dy, hipZ + upper.dz);
    const lower = jointOffset(lowerAngleDeg, legLength * 0.42);
    const hoofTop = new THREE.Vector3(flareX, knee.y + lower.dy, knee.z + lower.dz);
    const hoof = jointOffset(hoofAngleDeg, legLength * 0.16);
    const hoofTip = new THREE.Vector3(flareX, hoofTop.y + hoof.dy, hoofTop.z + hoof.dz);

    // Thigh: rotates about the hip.
    sink = upperBuffer;
    pushBoxSegment(hip, knee, legHalfWidth, legHalfDepth, true, false, UNICORN_LEG_COLOR);

    // Knee barrel, covering the wedge that opens between the thigh's flat
    // end face and the cannon bone's flat top face once the knee bends.
    //
    // A cylinder about the hinge axis, not a sphere. Both are invariant
    // under the knee's rotation, but a sphere large enough to swallow the
    // moving face's corners carries that radius through the middle of the
    // joint too, where nothing needs covering — which reads as a knee pad
    // rather than a knee. Sized off the cannon bone's half-depth, the
    // barrel comes out slimmer fore-aft than the thigh itself, so it
    // vanishes into the leg's existing silhouette.
    //
    // It goes in the *upper* buffer deliberately. Its axis is the knee's
    // rotation axis, so the knee's own bend cannot move it — but it must
    // still follow the thigh when the hip swings, which is what living in
    // the thigh's part gives us.
    const kneeBarrel = jointBarrelForBoxSection({
      movingHalfDepth: legHalfDepth * 0.85,
      widestHalfWidth: legHalfWidth,
    });
    pushJointBarrel(sink, {
      center: knee,
      axis: new THREE.Vector3(1, 0, 0),
      radius: kneeBarrel.radius,
      halfLength: kneeBarrel.halfLength,
      color: UNICORN_LEG_COLOR,
    });

    // Cannon bone and hoof: rotate about the knee, on top of whatever the
    // thigh above them is doing. Capping the top of the lower segment keeps
    // the joint from showing a hollow end once it bends away from the thigh.
    sink = lowerBuffer;
    pushBoxSegment(knee, hoofTop, legHalfWidth * 0.85, legHalfDepth * 0.85, true, false, UNICORN_LEG_COLOR);
    // Small squared-off hoof block, tinted dark gray to read as a hoof
    // distinct from the rest of the leg, instead of the dragon's fanned
    // claws.
    pushBoxSegment(hoofTop, hoofTip, legHalfWidth * 0.7, legHalfDepth * 0.7, false, true, UNICORN_HOOF_COLOR);

    return knee;
  }

  // Front hips pulled back by one full leg depth. At length*0.02 the shoulder
  // sat forward of the chest's own front surface, so the top of each front leg
  // stood outside the body and only the thin joint barrel bridged the gap —
  // the legs read as hanging off the chest by a thread. Backing off by the
  // leg's own front-to-back depth (2 x half-depth) seats the hip socket inside
  // the chest bulge, the same reasoning that fixed the rear legs below.
  const frontLegDepth = width * UNICORN_LEG_HALF_DEPTH_FRAC * 2;
  const frontY = length * 0.02 - frontLegDepth; // seated inside the chest
  // Rear hip Y was -length*0.42 — *behind* the body's own rear-most spine
  // point (the tail root sits at -halfLen*0.8 = -length*0.4, see
  // buildHorseBodyProfileGeometry), so the back legs floated in empty
  // space past the rump instead of actually attaching to the haunch —
  // read as "detached" legs. Moved forward into the hindquarter bulge
  // (spine's hindquarter ring sits at -halfLen*0.62 = -length*0.31,
  // radius width*0.32 — the widest part of the rear body) so the hip
  // socket sits inside/at the body surface.
  const backY = -length * 0.3; // inside the hindquarter bulge
  const stanceX = width * 0.19; // pulled in from 0.26 so legs stick out less laterally
  // Legs now emerge a bit lower on the belly (more negative Z, "down")
  // rather than right at the body's central spine axis (z=0) — per
  // direct feedback the legs looked like they came out too high up the
  // barrel rather than from the underside of the body.
  const hipZ = -width * 0.16;

  // Front legs: jut forward (+35 deg), lower leg sweeps back just past
  // vertical (-15 deg), hoof bends back further (-35 deg).
  const frontKnee = buildLeg(-stanceX, frontY, hipZ, 35, -15, -35, frontUpper, frontLower);
  buildLeg(stanceX, frontY, hipZ, 35, -15, -35, frontUpper, frontLower);
  // Rear legs: thigh angles back further (-58 deg, was -45 — "top of the
  // leg should point farther backward"), and the hock/knee bend is wider
  // now so the lower leg swings only slightly forward of vertical
  // (-10 deg, was +30 — "bottom half of the legs point slightly
  // backward" instead of forward), hoof bends back (-35 deg) same as
  // the front.
  const rearKnee = buildLeg(-stanceX, backY, hipZ, -58, -10, -35, rearUpper, rearLower);
  buildLeg(stanceX, backY, hipZ, -58, -10, -35, rearUpper, rearLower);

  const toGeometry = (buffer: Buffer): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer.positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(buffer.colors), 3));
    geometry.computeVertexNormals();
    return geometry;
  };

  // Left and right legs of a pair share a part. The swing axis is model-X and
  // the two differ only in X, so one pivot *line* serves both — which is why
  // four parts buy a fully jointed leg rather than eight.
  const swingAxis: Triple = [1, 0, 0];

  return [
    {
      role: 'legUpperFront',
      group: 'legs',
      geometry: toGeometry(frontUpper),
      pivot: [0, frontY, hipZ],
      axis: swingAxis,
      drive: { source: 'legSwing' },
    },
    {
      role: 'legLowerFront',
      group: 'legs',
      geometry: toGeometry(frontLower),
      pivot: [0, frontKnee.y, frontKnee.z],
      axis: swingAxis,
      parent: 0,
      drive: UNICORN_KNEE_DRIVE,
    },
    {
      role: 'legUpperRear',
      group: 'legs',
      geometry: toGeometry(rearUpper),
      pivot: [0, backY, hipZ],
      axis: swingAxis,
      drive: { source: 'legSwing' },
    },
    {
      role: 'legLowerRear',
      group: 'legs',
      geometry: toGeometry(rearLower),
      pivot: [0, rearKnee.y, rearKnee.z],
      axis: swingAxis,
      parent: 2,
      drive: UNICORN_KNEE_DRIVE,
    },
  ];
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

  // A round tube segment, replacing the 4-sided box section this tail used to
  // share with the legs.
  //
  // Two separate things made the old version read as blocky, and raising the
  // body's segment count in PR #267 fixed neither:
  //
  //  1. FOUR SIDES. A square cross-section has 90-degree corners, so it stays
  //     visibly angular from every angle no matter how the normals are built.
  //  2. THE RING WAS NOT PERPENDICULAR TO THE TAIL. Corners were offset along
  //     world X and Y while the tail itself sweeps through -Y and Z, so the
  //     "thickness" along Y ran roughly *lengthwise* down the tail rather than
  //     radially around it. The section was closer to a padded ribbon than a
  //     tube.
  //
  // Rings are now built in the plane perpendicular to each segment's own
  // direction, using a parallel-transported frame so consecutive rings stay
  // rotationally aligned and the tube doesn't twist as the tail droops. The
  // cross-section keeps the previous slight flattening (the minor radius is
  // 0.8 of the major) so the silhouette still reads as horse hair rather than
  // a hosepipe.
  const TAIL_SIDES = 10;
  let transportedNormal = new THREE.Vector3(1, 0, 0);
  const ringAt = (center: THREE.Vector3, direction: THREE.Vector3, halfMajor: number, halfMinor: number) => {
    const tangent = direction.clone();
    if (tangent.lengthSq() < 1e-10) tangent.set(0, -1, 0);
    tangent.normalize();
    // Re-orthogonalise the carried normal against the new tangent rather than
    // picking a fresh basis per ring, which would let the frame flip.
    transportedNormal.sub(tangent.clone().multiplyScalar(transportedNormal.dot(tangent)));
    if (transportedNormal.lengthSq() < 1e-8) {
      transportedNormal.set(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x));
      if (transportedNormal.lengthSq() < 1e-8) transportedNormal.set(0, 0, 1);
    }
    transportedNormal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, transportedNormal).normalize();
    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < TAIL_SIDES; s++) {
      const theta = (s / TAIL_SIDES) * Math.PI * 2;
      ring.push(
        center
          .clone()
          .add(transportedNormal.clone().multiplyScalar(Math.cos(theta) * halfMajor))
          .add(binormal.clone().multiplyScalar(Math.sin(theta) * halfMinor)),
      );
    }
    return ring;
  };

  /**
   * Emits the tube walls from a list of rings that are SHARED between adjacent
   * segments, plus the two end caps.
   *
   * The previous version built each segment independently, calling ringAt
   * twice per segment — once for its own start and once for its own end. Every
   * interior joint therefore got two different rings at the same center: one
   * oriented to the incoming segment's direction, one to the outgoing
   * segment's. Because the tail bends at every joint those two rings did not
   * coincide, so the surface tore open and the tail read as a row of separate
   * sausages with visible breaks between them. ringAt also mutates the
   * transported frame, so calling it twice per point advanced the frame twice
   * as fast as intended.
   *
   * Now there is exactly one ring per point, built on the bisector of the
   * incoming and outgoing directions (a mitre joint) so it meets both segments
   * squarely. Adjacent segments reference the same vertices, which makes the
   * surface genuinely continuous — no gap can reappear, because there is no
   * longer a second ring to disagree with.
   */
  function pushTubeFromRings(rings: THREE.Vector3[][], color: THREE.Color) {
    for (let i = 0; i < rings.length - 1; i++) {
      const ringA = rings[i];
      const ringB = rings[i + 1];
      for (let s = 0; s < TAIL_SIDES; s++) {
        const t = (s + 1) % TAIL_SIDES;
        pushTri(ringA[s], ringB[s], ringB[t], color);
        pushTri(ringA[s], ringB[t], ringA[t], color);
      }
    }
    const first = rings[0];
    for (let s = 1; s < TAIL_SIDES - 1; s++) pushTri(first[0], first[s + 1], first[s], color);
    const last = rings[rings.length - 1];
    for (let s = 1; s < TAIL_SIDES - 1; s++) pushTri(last[0], last[s], last[s + 1], color);
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
  // Taper continuously across each segment (start radius -> end radius) rather
  // than holding one radius per segment. The old per-segment constant width
  // left a visible step at every joint, which read as extra blockiness on top
  // of the square cross-section.
  const halfWidthAt = (i: number) =>
    THREE.MathUtils.lerp(rootHalfWidth, tipHalfWidth, i / (points.length - 1));

  // One ring per point. At an interior joint the ring uses the average of the
  // incoming and outgoing directions so it mitres between the two segments
  // instead of matching only one of them; the ends just use their single
  // adjacent direction.
  const tailRings = points.map((point, i) => {
    const incoming = i > 0 ? new THREE.Vector3().subVectors(point, points[i - 1]) : null;
    const outgoing =
      i < points.length - 1 ? new THREE.Vector3().subVectors(points[i + 1], point) : null;
    const direction = new THREE.Vector3();
    if (incoming) direction.add(incoming.normalize());
    if (outgoing) direction.add(outgoing.normalize());
    const halfMajor = halfWidthAt(i);
    return ringAt(point, direction, halfMajor, halfMajor * 0.8);
  });
  pushTubeFromRings(tailRings, WHITE_VERTEX_COLOR);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  // Averaged rather than per-face normals, so the 10-sided tube shades as a
  // round surface instead of ten flat strips. The end caps meet the tube wall
  // at 90 degrees, well past the crease angle, so they stay crisp.
  smoothNormalsByPosition(geometry);

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
