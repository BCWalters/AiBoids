import * as THREE from 'three';
import type { CreatureGeometries } from './creatureGeometry';
import {
  mergeGeometriesWithColor,
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  buildHookedBeakGeometry,
  buildEyeDotsGeometry,
} from './creatureGeometry';

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
function buildParrotBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  // Face radius kept smaller than the head-crown bulge (a real, if
  // gentle, step down) so the head reads as a rounded mass with a
  // distinctly narrower face the beak grows out of, rather than the
  // beak's base being the same girth as the whole skull.
  const faceRadius = width * 0.16;
  const faceY = halfLen * 0.9;
  const profile = [
    new THREE.Vector2(width * 0.05, -halfLen * 0.95), // tail-root taper
    new THREE.Vector2(width * 0.24, -halfLen * 0.65),
    new THREE.Vector2(width * 0.46, -halfLen * 0.2), // belly bulge, rounder than a hawk's
    new THREE.Vector2(width * 0.42, halfLen * 0.12), // chest
    // Head reworked to be noticeably taller (a longer Y-span from neck
    // pinch to face) relative to its radius than the previous profile —
    // that version spanned only ~0.38*halfLen in Y against a ~0.46*width
    // peak radius, an oblate-spheroid ratio that read as a flat, wide
    // "smooshed"/Lego-brick head rather than a rounded skull. Pushing the
    // neck pinch earlier and the face further out (plus trimming the
    // peak radius down a touch) roughly doubles that span:radius ratio.
    new THREE.Vector2(width * 0.19, halfLen * 0.38), // real pinched neck — noticeably narrower than both chest and head
    new THREE.Vector2(width * 0.32, halfLen * 0.5), // head base, bulging back out past the neck pinch
    new THREE.Vector2(width * 0.37, halfLen * 0.62), // crown — the widest point of the head
    new THREE.Vector2(width * 0.3, halfLen * 0.74), // forehead, narrowing toward the face
    new THREE.Vector2(width * 0.22, halfLen * 0.84), // brow, just above the eyes
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
  const eyeY = halfLen * 0.78;
  const eyeX = width * 0.26;
  const eyeZ = width * 0.06;
  const eyeRadius = width * 0.05;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: torso, color: WHITE_VERTEX_COLOR },
    { geometry: beak, color: BEAK_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

/**
 * A solid fanned tail base (same shape/attachment as the shared hawk/
 * songbird tail — a quadrilateral boundary meeting at a rear center
 * point, rooted flush against the body's own tail-root) with a couple
 * of long center streamer feathers layered on top, growing out from
 * that same fan-back point rather than floating as separate disconnected
 * sticks — macaws have a fanned tail base with a few dramatically
 * elongated central feathers, not just bare quills. Both the fan and the
 * streamers are run through extrudeRingGeometry to give them real
 * Z-thickness: the previous version was a zero-thickness flat plane
 * lying in the model's X/Y plane, which vanished completely when viewed
 * edge-on from the side (a side camera looks straight down the X axis,
 * seeing ~0 apparent height for anything with no Z-extent).
 */
function buildParrotTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const thickness = width * 0.05;

  // Root must sit at (or slightly ahead of, for guaranteed overlap) the
  // body lathe's own tail-root profile point (-halfLen*0.95 = -length*0.475
  // — see buildParrotBodyGeometry's profile) rather than well in front of
  // it: a previous root of -length*0.42 left a visible gap between where
  // the body's own taper ended and where the tail fan began, reading as
  // "the tail is separated from the body".
  const root = new THREE.Vector3(0, -length * 0.46, 0);
  const fanLeftTip = new THREE.Vector3(-width * 0.85, -length * 0.68, 0);
  const fanRightTip = new THREE.Vector3(width * 0.85, -length * 0.68, 0);
  const fanBack = new THREE.Vector3(0, -length * 0.78, 0);
  const fan = extrudeRingGeometry([root, fanLeftTip, fanBack, fanRightTip], thickness);

  // Long streamers grow directly out of the fan's own back point, close
  // together near the centerline (rather than spread wide like the fan's
  // own tips), so they visually continue the fan rather than sprouting
  // from empty space beside it.
  const streamerCount = 2;
  const streamerGeometries: THREE.BufferGeometry[] = [fan];
  for (let i = 0; i < streamerCount; i++) {
    const t = i / (streamerCount - 1);
    const xOffset = (t - 0.5) * width * 0.3;
    const streamerLen = length * 0.5;
    const halfWidth = width * 0.06;

    const streamerRoot = new THREE.Vector3(xOffset - halfWidth, fanBack.y * 0.85, 0);
    const streamerRoot2 = new THREE.Vector3(xOffset + halfWidth, fanBack.y * 0.85, 0);
    const tip = new THREE.Vector3(xOffset, fanBack.y - streamerLen, -length * 0.06);

    streamerGeometries.push(extrudeRingGeometry([streamerRoot, streamerRoot2, tip], thickness));
  }

  return mergePositionOnlyGeometries(streamerGeometries);
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
