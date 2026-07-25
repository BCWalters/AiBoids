import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  buildEyeDotsGeometry,
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
} from '../../../geometry/sharedGeometry';

/**
 * Fish-tank "unicorn" predator geometry: reskinned into a classic
 * upright seahorse silhouette while keeping the unicorn's gold horn and
 * shared external color pipeline. The body is a vertically-stacked,
 * armored-looking swept form with a bent head and snout; wingLeft/
 * wingRight become the tiny pectoral fins that flap in the existing
 * render loop; tail is a true 3D curled tube instead of a fish caudal
 * fin.
 */
export function createSeaHorseGeometries(length: number, width: number): CreatureGeometries {
  const body = buildSeaHorseBodyGeometry(length, width);
  const wingLeft = buildPectoralFinGeometry(length, width, 1);
  const wingRight = buildPectoralFinGeometry(length, width, -1);
  const tail = buildCurledTailGeometry(length, width);
  return { body, wingLeft, wingRight, tail };
}

// Seahorse palette — single source of truth shared between the baked tail
// gradient (below) and the fishtank scene's Horse-predator color tint
// (FishtankSceneRenderer3D). Kept here so every seahorse-specific color lives
// in the seahorse's own module rather than being split across files.
//
// The body reads as a pink that leans toward lavender (but is not fully
// lavender); the tail fades from that same body tone at its base to a more
// saturated purple-lavender at the curled tip.
// Body and tail-base share this exact value so they render as the same tone
// (the body's instanceColor and the tail's baked base vertex color both resolve
// to it). Set halfway between the prior mauve-pink (0xdf9dd1) and the lighter
// lavender (0xe9b8e0) per feedback — a touch pinker than the lighter tone while
// staying lighter than the original.
export const SEAHORSE_BODY_COLOR = 0xe4abd9;
export const SEAHORSE_HUNT_COLOR = 0xf2d6ee;
export const SEAHORSE_TAIL_TIP_COLOR = 0xa87fe0;

const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
const HORN_COLOR = new THREE.Color(0xffd54a);
const EYE_COLOR = new THREE.Color(0x101014);
const TAIL_BASE_COLOR = new THREE.Color(SEAHORSE_BODY_COLOR);
const TAIL_TIP_COLOR = new THREE.Color(SEAHORSE_TAIL_TIP_COLOR);

// The tail's instanceColor is set (by the scene tint) to the body color and
// then multiplied by the baked per-vertex color, so the baked gradient is
// stored as a RATIO relative to the body rather than as absolute colors:
//   base ratio = body/body = white   -> base renders as the body color
//   tip  ratio = tip/body            -> tip renders as the lavender tip color
// Because instanceColor tracks the body through the hunt-highlight lerp, the
// tail base stays exactly equal to the body at every hunt intensity (fixing the
// prior white-instanceColor path where the body drifted toward the highlight
// during hunts but the tail base did not). Ratios are computed in the linear
// space THREE.Color stores, matching the shader's linear instanceColor*vertex
// multiply. THREE.Color components are already linear (ColorManagement on).
const TAIL_BASE_RATIO = new THREE.Color(1, 1, 1);
const TAIL_TIP_RATIO = new THREE.Color().setRGB(
  TAIL_TIP_COLOR.r / TAIL_BASE_COLOR.r,
  TAIL_TIP_COLOR.g / TAIL_BASE_COLOR.g,
  TAIL_TIP_COLOR.b / TAIL_BASE_COLOR.b,
);

// Rainbow fin/dorsal styling — mirrors the nature unicorn's pegasus-wing look
// (violet at the root, red at the tip) but kept entirely local to the seahorse.
// Matches the unicorn's HSL sweep (see unicornGeometry.addRainbowVertexColors).
const RAINBOW_ROOT_HUE = 0.78; // violet at the root
const RAINBOW_TIP_HUE = 0.0; // red at the tip
const RAINBOW_SATURATION = 0.85;
const RAINBOW_LIGHTNESS = 0.62;
// The dorsal fin is merged into the body mesh, so its baked vertex color is
// multiplied by the body's (pink) instanceColor. To let the rainbow read as
// pure color there — exactly like the pectoral fins, which sit on their own
// white-instanceColor mesh — the dorsal rainbow is baked as a RATIO relative to
// the body color (rainbow / body), so instanceColor * ratio == rainbow at idle.
// SEAHORSE_BODY_COLOR components are already linear (ColorManagement on),
// matching the shader's linear instanceColor*vertex multiply.
const SEAHORSE_BODY_LINEAR = new THREE.Color(SEAHORSE_BODY_COLOR);

interface SpinePoint {
  y: number;
  z: number;
  radius: number;
  xScale?: number;
  zScale?: number;
}

function buildSeaHorseBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: shell, crestY, crestZ, crestRadius, eyeX, eyeY, eyeZ, eyeRadius } = buildSeaHorseShellGeometry(length, width);
  const dorsalFin = buildDorsalFinGeometry(length, width);
  const ridge = buildBodyRidgeGeometry(length, width);
  const horn = buildSeaHorseHornGeometry(crestY, crestZ, crestRadius);
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  const merged = mergeGeometriesWithColor([
    { geometry: shell, color: WHITE_VERTEX_COLOR },
    { geometry: dorsalFin, color: WHITE_VERTEX_COLOR },
    { geometry: ridge, color: WHITE_VERTEX_COLOR },
    { geometry: horn, color: HORN_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
  shell.dispose();
  dorsalFin.dispose();
  ridge.dispose();
  horn.dispose();
  eyes.dispose();
  return merged;
}

function buildSeaHorseShellGeometry(
  length: number,
  width: number,
): {
  geometry: THREE.BufferGeometry;
  crestY: number;
  crestZ: number;
  crestRadius: number;
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  eyeRadius: number;
} {
  const halfLen = length * 0.5;
  const spine: SpinePoint[] = [
    // Radii here are widened another 25% (now ~0.078/0.219/0.344, cumulative
    // ~1.56x the original 0.05/0.14/0.22) so the body tapers more gradually
    // into the tail attachment, matching a correspondingly thinner tail base.
    { y: -halfLen * 0.22, z: -length * 0.38, radius: width * 0.078, xScale: 0.32, zScale: 0.58 },
    { y: -halfLen * 0.18, z: -length * 0.31, radius: width * 0.219, xScale: 0.42, zScale: 0.84 },
    { y: -halfLen * 0.125, z: -length * 0.24, radius: width * 0.344, xScale: 0.54, zScale: 1.02 },
    { y: -halfLen * 0.06, z: -length * 0.14, radius: width * 0.27, xScale: 0.58, zScale: 1.18 },
    { y: 0, z: -length * 0.02, radius: width * 0.295, xScale: 0.6, zScale: 1.28 },
    { y: halfLen * 0.05, z: length * 0.08, radius: width * 0.255, xScale: 0.56, zScale: 1.2 },
    { y: halfLen * 0.1, z: length * 0.16, radius: width * 0.19, xScale: 0.48, zScale: 1.02 },
    // Snout tip. Shortened 20% by moving this point 20% of the way back toward
    // the head section (spine[6]) along the snout axis: original tip was
    // (y 0.145, z 0.215); pulling back 20% of the (0.045, 0.055) spine[6]->tip
    // delta gives (y 0.136, z 0.204). Radius/scale unchanged so the snout keeps
    // its taper, just less far forward. The horn and eyes anchor off this point,
    // so they follow the shorter snout automatically.
    { y: halfLen * 0.136, z: length * 0.204, radius: width * 0.15, xScale: 0.42, zScale: 0.9 },
    { y: halfLen * 0.205, z: length * 0.195, radius: width * 0.125, xScale: 0.38, zScale: 0.82 },
    { y: halfLen * 0.28, z: length * 0.115, radius: width * 0.1, xScale: 0.32, zScale: 0.58 },
    { y: halfLen * 0.36, z: length * 0.025, radius: width * 0.072, xScale: 0.27, zScale: 0.42 },
  ];

  const geometry = buildSweptGeometry(spine, 12);
  const crest = spine[7];
  // Seat the eyes on the widest cheek of the head, embedded into the surface —
  // NOT out near the crown/snout. The previous anchor used spine[8] (the crown)
  // plus a forward +Z push of half the section depth, which shoved the eyes onto
  // the narrow snout ridge where they poked through/over it and read as floating
  // past the head. Instead, blend between spine[6] (the widest cheek/gill
  // section) and spine[7] (the snout base) and sit the eye centers just inside
  // that section's side surface (x = local half-width) with no forward push, so
  // each eye rests symmetrically on a cheek with only a slight, eye-like bulge.
  const cheekA = spine[6];
  const cheekB = spine[7];
  const eyeBlend = 0.35; // mostly on the wide cheek, nudged toward the snout base
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const eyeSecY = lerp(cheekA.y, cheekB.y, eyeBlend);
  const eyeSecZ = lerp(cheekA.z, cheekB.z, eyeBlend);
  const eyeSecRadius = lerp(cheekA.radius, cheekB.radius, eyeBlend);
  const eyeSecXScale = lerp(cheekA.xScale ?? 1, cheekB.xScale ?? 1, eyeBlend);
  // The head's side surface at this section sits at x = radius * xScale (the
  // squircle's widest point, at cross-section angle 0). Seat the eye center just
  // inside that so the small sphere pokes out only slightly.
  const eyeHalfWidth = eyeSecRadius * eyeSecXScale;
  return {
    geometry,
    crestY: crest.y,
    crestZ: crest.z,
    crestRadius: crest.radius,
    eyeX: eyeHalfWidth * 0.82,
    eyeY: eyeSecY,
    eyeZ: eyeSecZ,
    eyeRadius: width * 0.022,
  };
}

function buildSeaHorseHornGeometry(crestY: number, crestZ: number, crestRadius: number): THREE.BufferGeometry {
  // Smaller coronet than before (length 1.15x vs 1.7x, radius 0.28x vs 0.34x)
  // and pulled back/down so its base embeds into the crest instead of hovering
  // above it. The old +0.14*radius lift and +0.92*radius forward offset left a
  // visible gap between the horn base and the head; seating the base at
  // ~0.35*radius forward with a slight downward nudge closes it.
  // 25% taller than before (1.4375x vs 1.15x) while keeping the SAME base point:
  // the base sits at crestZ + crestRadius*0.3 (center = base + hornLength*0.5),
  // so growing hornLength extends the tip forward without moving the base.
  const hornLength = crestRadius * 1.4375;
  const hornRadius = crestRadius * 0.28;
  const horn = new THREE.ConeGeometry(hornRadius, hornLength, 8);
  horn.rotateX(Math.PI / 2);
  horn.translate(0, crestY - crestRadius * 0.05, crestZ + crestRadius * 0.3 + hornLength * 0.5);
  return horn;
}

function buildDorsalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  // A seahorse's dorsal fin runs down the mid-back. Built as a scalloped sail
  // in the Y-Z plane and given real thickness along X (via extrudeAlongX) so it
  // reads as a solid 3D fin from every angle instead of the previous
  // paper-thin sheet that vanished edge-on. The wavy outer edge (three crest
  // points) mimics the rippled membrane of a real dorsal fin.
  const outline = [
    new THREE.Vector3(0, length * 0.02, length * 0.05),
    new THREE.Vector3(0, -length * 0.02, -length * 0.02),
    new THREE.Vector3(0, -length * 0.055, -length * 0.16),
    // Outer (free) edge — pushed back/-Z and down/-Y, lightly scalloped.
    new THREE.Vector3(0, -length * 0.16, -length * 0.14),
    new THREE.Vector3(0, -length * 0.185, -length * 0.055),
    new THREE.Vector3(0, -length * 0.155, length * 0.02),
  ];
  // Thin membrane: just enough X-depth to stay 3D (not vanish edge-on) while
  // reading as a delicate, wispy sail rather than a solid keel.
  const fin = extrudeAlongXGeometry(outline, width * 0.014);
  // Rainbow the sail like the pectoral fins: violet where it roots against the
  // back (top-front of the outline), red at the free outer edge. The dorsal is
  // merged into the body mesh (pink instanceColor), so bake as a ratio relative
  // to the body so the multiply resolves to a pure rainbow (divideByBody=true).
  const finRoot = new THREE.Vector3(0, length * 0.02, length * 0.05);
  const finReach = length * 0.24;
  return addRainbowVertexColors(fin, finRoot, finReach, true);
}

function buildBodyRidgeGeometry(length: number, width: number): THREE.BufferGeometry {
  const spikes: THREE.BufferGeometry[] = [
    buildRidgePlate(new THREE.Vector3(0, length * 0.13, length * 0.2), width * 0.09, width * 0.035),
    buildRidgePlate(new THREE.Vector3(0, length * 0.06, length * 0.11), width * 0.08, width * 0.035),
    buildRidgePlate(new THREE.Vector3(0, 0, 0), width * 0.075, width * 0.032),
    buildRidgePlate(new THREE.Vector3(0, -length * 0.04, -length * 0.12), width * 0.06, width * 0.028),
  ];
  const merged = mergePositionOnlyGeometries(spikes);
  spikes.forEach((geometry) => geometry.dispose());
  return merged;
}

function buildRidgePlate(anchor: THREE.Vector3, height: number, thickness: number): THREE.BufferGeometry {
  const front = new THREE.Vector3(0, anchor.y + height * 0.35, anchor.z);
  const back = new THREE.Vector3(0, anchor.y - height * 0.35, anchor.z - height * 0.08);
  const tip = new THREE.Vector3(0, anchor.y + height * 0.04, anchor.z + height);
  // Thicken the spike along X (extrudeAlongX) rather than Z. These crest plates
  // live in the Y-Z plane (all x=0); the shared extrudeRingGeometry would spread
  // their depth along Z — the same plane the plate already spans — leaving them
  // paper-thin edge-on from the front/back (the "2D fin" that vanished). Giving
  // them width in X makes each spike a small solid ridge visible from any angle.
  // Keep the spikes 3D (visible from any angle) but thin/wispy — a slim ridge,
  // not a chunky slab.
  return extrudeAlongXGeometry([front, back, tip], thickness * 0.55);
}

function buildPectoralFinGeometry(length: number, width: number, side: 1 | -1): THREE.BufferGeometry {
  // The animated "wing" slot. The shared engine flaps these around the body's
  // long (vertical +Y) axis, pivoting at the body centerline (x=0, z=0), with a
  // gentle amplitude (see the seahorse motion config). Per feedback, the fin now
  // attaches at the OUTSIDE of the body — its root sits on the body's side
  // surface (x = surfaceX) rather than buried on the centerline — so it visibly
  // hinges off the flank like the small fish's pectorals. Because the flap
  // amplitude is small, an off-axis root only sweeps a short arc near the
  // surface instead of shearing through the torso. The kite ring lies flat in an
  // X/Y plane (constant z), so extrudeRingGeometry gives it depth along Z into a
  // very thin, wispy 3D paddle.
  const rootY = length * 0.03;
  const rootZ = length * 0.05;
  // Body side surface at the shoulder section (~spine[4/5]): x = radius * xScale.
  const surfaceX = width * 0.15;
  const span = width * 0.28; // blade reach outward from the flank
  const chord = length * 0.13;
  const root = new THREE.Vector3(side * surfaceX, rootY, rootZ);
  const leadingBulge = new THREE.Vector3(side * (surfaceX + span * 0.5), rootY + chord * 0.35, rootZ);
  const tip = new THREE.Vector3(side * (surfaceX + span), rootY - chord * 0.1, rootZ);
  const trailingBulge = new THREE.Vector3(side * (surfaceX + span * 0.45), rootY - chord * 0.5, rootZ);
  // As thin as possible while still catching light and not disappearing edge-on.
  const thickness = width * 0.008;
  const geometry = extrudeRingGeometry([root, leadingBulge, tip, trailingBulge], thickness);
  // Rainbow the fin from its root (violet, where it meets the flank) to the
  // blade tip (red), matching the unicorn's wings. These fins render on their
  // own white-instanceColor mesh, so the baked color shows as pure rainbow.
  return addRainbowVertexColors(geometry, root, span, false);
}

/**
 * Like extrudeRingGeometry, but gives the ring thickness along the X axis
 * instead of Z. Used for the seahorse dorsal fin, whose outline lives in the
 * Y-Z plane and therefore needs its solid depth spread sideways (±X) to read
 * as a 3D fin rather than a flat sheet. Seahorse-local so it doesn't disturb
 * the shared Z-extrude used by every other creature part.
 */
function extrudeAlongXGeometry(ring: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = ring.length;
  const half = thickness / 2;
  const front = ring.map((p) => new THREE.Vector3(p.x + half, p.y, p.z));
  const back = ring.map((p) => new THREE.Vector3(p.x - half, p.y, p.z));

  const centroid = new THREE.Vector3();
  ring.forEach((p) => centroid.add(p));
  centroid.divideScalar(n);

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(e1, e2);
    const triCentroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(triCentroid, centroid);
    if (normal.dot(outward) < 0) pushTri(p0, p2, p1);
    else pushTri(p0, p1, p2);
  };

  for (let i = 1; i < n - 1; i++) {
    pushOutward(front[0], front[i], front[i + 1]);
    pushOutward(back[0], back[i], back[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushOutward(front[i], back[i], back[j]);
    pushOutward(front[i], back[j], front[j]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildCurledTailGeometry(length: number, width: number): THREE.BufferGeometry {
  // Anchor the tail so it starts overlapping inside the body's thicker taper
  // (around spine[1]/spine[2] in buildSeaHorseShellGeometry) rather than at the
  // body's pointed tip (spine[0]). Since the body and tail are separate meshes
  // (not vertex-welded), anchoring right at the tapered-to-a-point tip leaves a
  // visible "point meets disc" seam; starting the tail a bit further up, with a
  // radius that comfortably covers the body's cross-section there, hides the
  // seam by burying it inside the overlapping solid volume instead.
  const halfLen = length * 0.5;
  // Moved forward slightly (was -halfLen * 0.16) per feedback.
  const anchorY = -halfLen * 0.1;
  const anchorZ = -length * 0.28;
  // 30% thinner than before (0.1125 -> ~0.0788), paired with the body's
  // existing wider taper near the attachment point, so the tail base looks
  // more proportional.
  const bodyEndRadius = width * 0.0788;
  const tailTipRadius = width * 0.014;
  const maxRadius = length * 0.205;
  const minRadius = length * 0.038;
  // Tilt the tail's initial direction back (toward -Y, the rear of the body)
  // by 30 degrees from straight down, instead of exactly straight down --
  // exiting perfectly vertically left a visible hump where the tail crossed
  // back through the body's rear taper on its way to curling forward.
  const tiltRadians = THREE.MathUtils.degToRad(30);
  // Starting at theta = -PI - tiltRadians with theta increasing (turns > 0)
  // makes the initial tangent point down-and-back (tilted 30 degrees behind
  // straight down) from the anchor, then curls the tail counterclockwise:
  // down/back -> down -> forward (+Y, toward the head) -> up -> back under
  // itself, tapering as it goes.
  const startTheta = -Math.PI - tiltRadians;
  const centerY = anchorY - maxRadius * Math.cos(startTheta);
  const centerZ = anchorZ - maxRadius * Math.sin(startTheta);
  const turns = 5.2;
  const samples = 28;

  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  const tailColors: THREE.Color[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const theta = startTheta + turns * t;
    // Ease the coil radius shrink with t^2 (zero derivative at t=0) so the very
    // first segment is a pure rotation around the coil center -- otherwise the
    // radius shrinking right from t=0 adds an extra "inward" (forward) velocity
    // component on top of the rotational one, making the tail's first segment
    // point down-and-forward instead of straight down, and creating a visible
    // hump where it meets the body. Combined with more samples (28 vs. 14) so
    // that first segment is short enough to closely track the true tangent.
    const radiusT = t * t;
    const radius = THREE.MathUtils.lerp(maxRadius, minRadius, radiusT);
    path.push(new THREE.Vector3(0, centerY + Math.cos(theta) * radius, centerZ + Math.sin(theta) * radius));
    // Ease the taper with a squared falloff so the thick root persists briefly
    // before narrowing, rather than shrinking linearly right away.
    const taper = 1 - (1 - t) * (1 - t);
    radii.push(THREE.MathUtils.lerp(bodyEndRadius, tailTipRadius, taper));
    // Bake the coil gradient as a ratio relative to the body color (see
    // TAIL_BASE_RATIO / TAIL_TIP_RATIO above): base = white so the tail root
    // renders as exactly the body color, easing toward tip/body so the
    // saturated purple-lavender concentrates at the curled tip. The scene tint
    // sets the tail instanceColor to the body color, so instanceColor * this
    // baked ratio yields the intended absolute gradient while keeping the base
    // locked to the body at every hunt intensity.
    tailColors.push(TAIL_BASE_RATIO.clone().lerp(TAIL_TIP_RATIO, t * t));
  }

  return buildTubeGeometry(path, radii, 8, tailColors);
}

function buildSweptGeometry(spine: SpinePoint[], segments: number): THREE.BufferGeometry {
  const rings = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const { x, z } = crossSectionOffset(point.radius, angle, point.xScale ?? 1, point.zScale ?? 1);
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const pushOutwardTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, center: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const normal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    if (normal.dot(outward) < 0) pushTri(a, c, b);
    else pushTri(a, b, c);
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const center = new THREE.Vector3(0, (spine[i].y + spine[i + 1].y) * 0.5, (spine[i].z + spine[i + 1].z) * 0.5);
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      pushOutwardTri(rings[i][j], rings[i][k], rings[i + 1][j], center);
      pushOutwardTri(rings[i][k], rings[i + 1][k], rings[i + 1][j], center);
    }
  }

  const startCenter = new THREE.Vector3(0, spine[0].y, spine[0].z);
  const startInside = new THREE.Vector3(0, spine[1].y, spine[1].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(startCenter, rings[0][k], rings[0][j], startInside);
  }

  const endIndex = spine.length - 1;
  const endCenter = new THREE.Vector3(0, spine[endIndex].y, spine[endIndex].z);
  const endInside = new THREE.Vector3(0, spine[endIndex - 1].y, spine[endIndex - 1].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(endCenter, rings[endIndex][j], rings[endIndex][k], endInside);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function crossSectionOffset(radius: number, angle: number, xScale: number, zScale: number): { x: number; z: number } {
  const squareness = 3.6;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = radius * xScale * Math.sign(c) * Math.pow(Math.abs(c), 2 / squareness);
  const z = radius * zScale * Math.sign(s) * Math.pow(Math.abs(s), 2 / squareness);
  return { x, z };
}

function buildTubeGeometry(
  path: THREE.Vector3[],
  radii: number[],
  sides: number,
  ringColors?: THREE.Color[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  // Each emitted vertex carries the color of the path sample (ring) it belongs
  // to, so a per-sample gradient along `ringColors` bakes straight into the
  // tail's vertex colors. `ci`/`cj` are the ring indices of the two ends of a
  // side quad; caps reuse their single ring's color.
  const pushTri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ca?: number,
    cb?: number,
    cc?: number,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (ringColors) {
      const put = (idx?: number) => {
        const color = ringColors[idx ?? 0];
        colors.push(color.r, color.g, color.b);
      };
      put(ca);
      put(cb);
      put(cc);
    }
  };

  let normal = new THREE.Vector3(0, 0, 1);
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i < path.length; i++) {
    const tangent = new THREE.Vector3();
    if (i < path.length - 1) tangent.subVectors(path[i + 1], path[i]);
    else tangent.subVectors(path[i], path[i - 1]);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
    tangent.normalize();

    normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent)));
    if (normal.lengthSq() < 1e-8) {
      normal.set(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x));
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < sides; s++) {
      const theta = (s / sides) * Math.PI * 2;
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(theta) * radii[i])
        .add(binormal.clone().multiplyScalar(Math.sin(theta) * radii[i] * 0.88));
      ring.push(path[i].clone().add(offset));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const next = (s + 1) % sides;
      pushTri(rings[i][s], rings[i + 1][s], rings[i + 1][next], i, i + 1, i + 1);
      pushTri(rings[i][s], rings[i + 1][next], rings[i][next], i, i + 1, i);
    }
  }

  const startCenter = path[0];
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(startCenter, rings[0][next], rings[0][s], 0, 0, 0);
  }

  const endCenter = path[path.length - 1];
  const endRing = rings[rings.length - 1];
  const lastIndex = rings.length - 1;
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(endCenter, endRing[s], endRing[next], lastIndex, lastIndex, lastIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (ringColors) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Bakes the unicorn-style rainbow hue gradient (violet at `root`, red at the
 * far tip) into a per-vertex 'color' attribute, based on each vertex's straight-
 * line distance from `root`. Seahorse-local so the shared pipeline is untouched.
 *
 * When `divideByBody` is true, the baked color is stored as a ratio relative to
 * SEAHORSE_BODY_COLOR — used for the dorsal fin, whose color attribute is later
 * multiplied by the body's pink instanceColor; dividing first cancels that tint
 * so the rainbow renders pure. Pectoral fins live on their own white-
 * instanceColor mesh and pass false (absolute rainbow).
 */
function addRainbowVertexColors(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  maxDistance: number,
  divideByBody: boolean,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(vertex.distanceTo(root) / maxDistance, 0, 1);
    const hue = THREE.MathUtils.lerp(RAINBOW_ROOT_HUE, RAINBOW_TIP_HUE, t);
    color.setHSL(hue, RAINBOW_SATURATION, RAINBOW_LIGHTNESS);
    let r = color.r;
    let g = color.g;
    let b = color.b;
    if (divideByBody) {
      r /= SEAHORSE_BODY_LINEAR.r;
      g /= SEAHORSE_BODY_LINEAR.g;
      b /= SEAHORSE_BODY_LINEAR.b;
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
