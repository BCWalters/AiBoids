import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import { extrudeRingGeometry, mergePositionOnlyGeometries } from '../../../geometry/creatureGeometry';

// Fish tank style: a duplicate of nature's birdGeometry.ts, kept as its
// own independent copy (rather than shared/parametrized) so a future
// pass reskinning these into small fish silhouettes can freely rewrite
// this file without touching (or conflicting with) nature's birds.
/**
 * Builds a simple low-poly bird silhouette: an elongated diamond body
 * (nose pointing along local +Y, matching the orientation convention used
 * elsewhere in Renderer3D) plus a pair of flat, swept-back triangular
 * wings that extend sideways from the body's origin. Wings are separate
 * geometries (rather than baked into the body) so each can be given its
 * own per-instance flap rotation in the render loop.
 */
export function createBirdGeometries(length: number, width: number): CreatureGeometries {
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
 * "Nature" style bird geometries: a tapered, rotationally-lathed body
 * (fatter at the chest, tapering to a tail and a small head/beak bump) plus
 * wings with fanned, separated wingtip "finger" feathers — evoking a
 * soaring hawk silhouette rather than the simple flat-diamond arcade bird.
 * Not photo-realistic, but reads much better as "a bird" from a distance.
 */
export function createRealisticBirdGeometries(length: number, width: number): CreatureGeometries {
  const body = buildTaperedBodyGeometry(length, width);

  const wingSpan = length * 1.3;
  const wingChord = length * 0.6;
  const wingLeft = buildFingeredWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildFingeredWingGeometry(wingSpan, wingChord, -1);

  const tail = buildTailGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}


/**
 * Radially-symmetric (lathed) body profile: nose points along local +Y to
 * match FORWARD_AXIS. Tail end stays slim (a lathe can't produce a flat
 * fanned tail — that's added separately via buildTailGeometry).
 *
 * The neck now genuinely pinches in (much narrower than the chest) before
 * the head bulge, and the head bulge itself is wider than the neck by a
 * clear margin — without that pinch, the lathe reads as one continuous
 * tapering blob (an "egg with a pointed tip") rather than a body + a
 * separate head, which was the small-bird complaint ("looks like a yellow
 * blob, no head"). A small beak cone is appended past the face point (see
 * buildBeakGeometry) so there's an actual protruding beak shape instead of
 * the lathe profile just pinching to a bare point.
 */
function buildTaperedBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.04, -halfLen * 1.0), // tail tip
    new THREE.Vector2(width * 0.22, -halfLen * 0.7),
    new THREE.Vector2(width * 0.42, -halfLen * 0.25), // belly bulge
    new THREE.Vector2(width * 0.4, halfLen * 0.15), // chest
    new THREE.Vector2(width * 0.15, halfLen * 0.42), // neck pinch — clearly narrower than chest/head
    new THREE.Vector2(width * 0.3, halfLen * 0.58), // head base bulge — clearly wider than the neck pinch
    new THREE.Vector2(width * 0.32, halfLen * 0.66), // crown, the widest point of the head
    new THREE.Vector2(width * 0.2, halfLen * 0.74), // forehead, narrowing toward the face
    new THREE.Vector2(width * 0.09, halfLen * 0.8), // face point, where the beak attaches
  ];
  const body = new THREE.LatheGeometry(profile, 14);
  const beak = buildBeakGeometry(length, halfLen * 0.8, width * 0.09);
  return mergePositionOnlyGeometries([body, beak]);
}

/**
 * A small solid cone forming the beak, attached at the body lathe's face
 * point and pointing further forward along +Y. Gives small birds (and the
 * hawk) an actual protruding beak shape instead of the lathe profile
 * simply pinching down to a bare point (which reads as "no head/beak at
 * all" from a distance, especially on uniformly-colored small birds).
 */
function buildBeakGeometry(length: number, faceY: number, faceRadius: number): THREE.BufferGeometry {
  const beakLen = length * 0.22;
  const geometry = new THREE.ConeGeometry(faceRadius * 0.85, beakLen, 8);
  geometry.scale(1, 1, 0.75); // slightly flattened, taller than wide
  // ConeGeometry's axis already runs along +Y (apex at +height/2, base at
  // -height/2), matching the body's own forward axis — no rotation
  // needed, just slide it forward so the base sits at the body's face
  // point and the apex protrudes further ahead of it.
  geometry.translate(0, faceY + beakLen * 0.5, 0);
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
 * A fanned tail trailing behind the body (toward local -Y), built from a
 * quadrilateral boundary (root -> leftTip -> backCenter -> rightTip)
 * extruded into a real 3D prism via extrudeRingGeometry — reads as a
 * spread tail fan from a distance, but (unlike a flat zero-thickness
 * plane) doesn't disappear when viewed edge-on from directly the side.
 * Static (does not flap).
 */
function buildTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const root = new THREE.Vector3(0, 0, 0);
  const leftTip = new THREE.Vector3(-width * 0.9, -length * 0.55, 0);
  const rightTip = new THREE.Vector3(width * 0.9, -length * 0.55, 0);
  const backCenter = new THREE.Vector3(0, -length * 0.85, 0);
  const thickness = width * 0.05;

  return extrudeRingGeometry([root, leftTip, backCenter, rightTip], thickness);
}

