import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import {
  mergeGeometriesWithColor,
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  buildHookedBeakGeometry,
  buildEyeDotsGeometry,
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
const BEAK_COLOR = new THREE.Color(0x2b2620);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
// Near-black eye dots — stay near-black under any per-instance body tint
// multiply (see the multiply-color reasoning in unicornGeometry.ts), so
// this single baked color works correctly across every macaw color
// pattern in PARROT_COLOR_PATTERNS.
const EYE_COLOR = new THREE.Color(0x0d0b08);

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
const HEAD_NARROW_SCALE = 0.75;
const HEAD_LENGTHEN_SCALE = 1.2;
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
  const torso = new THREE.LatheGeometry(profile, 16);

  // Macaws have a deeply hooked beak curling well past straight-down
  // (132deg from forward) — much more than the hawk's shallower raptor
  // hook (see hawkGeometry.ts) — shared sweep builder, different tuning.
  const beak = buildHookedBeakGeometry(faceY, faceRadius, length * 0.34, 132, 0.85);

  // A pair of small dark eye dots on either side of the head, just above
  // and slightly behind the face point — the single biggest missing
  // "facial feature" cue reported (a parrot with no visible eyes reads
  // as a smooth featureless head no matter how good the beak/head shape
  // is otherwise).
  const eyeY = halfLen * headFrac(0.78);
  const eyeX = width * 0.26 * HEAD_NARROW_SCALE;
  const eyeZ = width * 0.06 * HEAD_NARROW_SCALE;
  const eyeRadius = width * 0.05 * HEAD_NARROW_SCALE;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: torso, color: WHITE_VERTEX_COLOR },
    { geometry: beak, color: BEAK_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
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
  const thickness = width * 0.035;

  // Root sits at (or slightly ahead of, for guaranteed overlap) the
  // body lathe's own tail-root profile point (-halfLen*0.95 = -length*0.475
  // — see buildParrotBodyGeometry's profile): a shallower root left a
  // visible gap between where the body's own taper ended and where the
  // tail began, reading as "the tail is separated from the body".
  const rootY = -length * 0.46;

  const featherCount = 7;
  const maxSpreadDeg = 34; // total angular spread of the fan, center feather at 0deg
  const maxLen = length * 0.62; // center (longest) feather length
  const minLenFrac = 0.45; // outermost feathers' length relative to maxLen

  const featherGeometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < featherCount; i++) {
    // -1 (leftmost) .. 0 (center) .. +1 (rightmost)
    const t = (i / (featherCount - 1)) * 2 - 1;
    const angle = THREE.MathUtils.degToRad(t * maxSpreadDeg);
    const lenFrac = minLenFrac + (1 - minLenFrac) * Math.pow(Math.cos((t * Math.PI) / 2), 1.4);
    const featherLen = maxLen * lenFrac;

    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle); // fan opens backward (-Y)
    const droop = -length * 0.08 * lenFrac; // longer feathers droop a bit more

    // Vane outline: a slender quill at the root widening to its
    // fullest a bit past the middle, then tapering to a fine point —
    // built as a 4-point diamond (root, left-bulge, tip, right-bulge)
    // rather than a plain thin sliver, so each feather reads as a real
    // vane rather than a wire.
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const vaneHalfWidth = width * 0.055 * lenFrac;
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
    const tip = new THREE.Vector3(dirX * featherLen, rootY + dirY * featherLen, droop);

    featherGeometries.push(extrudeRingGeometry([root, leftBulge, tip, rightBulge], thickness));
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
  // Rounded, convex leading edge (bulges forward then curves back to a
  // blunt tip) rather than one sharp shoulder-to-tip line.
  const boundary: number[][] = [
    [0.3 * span * s, chord * 0.4, 0],
    [0.68 * span * s, chord * 0.34, 0],
    [0.92 * span * s, chord * 0.16, 0],
    [1.0 * span * s, -chord * 0.08, 0], // blunt rounded tip, not a sharp point
    [0.86 * span * s, -chord * 0.32, 0],
    [0.42 * span * s, -chord * 0.22, 0],
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
  const trailOuter = boundary[3]; // blunt tip
  const trailInner = boundary[5]; // trailing-inner point
  const lerp = (a: number[], b: number[], t: number) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const fingerCount = 4;
  const halfGap = 0.08;
  const dirX = trailOuter[0] - trailInner[0];
  const dirY = trailOuter[1] - trailInner[1];
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const ndx = dirX / dirLen;
  const ndy = dirY / dirLen;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const baseA = lerp(trailInner, trailOuter, Math.max(0, t - halfGap));
    const baseB = lerp(trailInner, trailOuter, Math.min(1, t + halfGap));
    const fingerLen = span * (0.08 + 0.06 * t); // short — outermost finger only ~14% of span
    const midBase = lerp(baseA, baseB, 0.5);
    const tip = [midBase[0] + ndx * fingerLen, midBase[1] + ndy * fingerLen, 0];
    pushTri(baseA, baseB, tip);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
