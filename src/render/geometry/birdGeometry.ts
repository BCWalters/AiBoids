import * as THREE from 'three';
import type { CreatureGeometries } from './creatureGeometry';
import {
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  buildEyeDotsGeometry,
} from './creatureGeometry';

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
 *
 * This shape is shared across four differently-colored small-songbird
 * species (sparrow/goldfinch/cardinal/bluejay — see BOID_SPECIES_CONFIGS
 * in Renderer3D.ts), so the beak is returned as its own separate `beak`
 * geometry/instance part rather than baked into the body's vertex colors
 * (contrast with parrotGeometry.ts/hawkGeometry.ts, whose beaks CAN be
 * vertex-baked since each of those geometries belongs to only one
 * species/color scheme). Keeping the beak a separate InstancedMesh part
 * lets each species get its own distinct, appropriate beak instance color
 * (see Renderer3D's BOID_SPECIES_CONFIGS `beakColor` field) without the
 * shared body geometry having to pick just one baked-in hue.
 */
export function createRealisticBirdGeometries(length: number, width: number, legsColor: THREE.Color = SMALL_BIRD_DEFAULT_LEGS_COLOR): CreatureGeometries {
  const body = buildTaperedBodyGeometry(length, width);
  const beak = buildSmallBirdBeakGeometry(length, width);

  const wingSpan = length * 1.3;
  const wingChord = length * 0.6;
  const wingLeft = buildFingeredWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildFingeredWingGeometry(wingSpan, wingChord, -1);

  const tail = buildTailGeometry(length, width);
  const legs = buildSmallBirdLegsGeometry(length, width, legsColor);

  return { body, wingLeft, wingRight, tail, beak, legs };
}


/**
 * Radially-symmetric (lathed) body profile: nose points along local +Y to
 * match FORWARD_AXIS. Tail end stays slim (a lathe can't produce a flat
 * fanned tail — that's added separately via buildTailGeometry).
 *
 * Slimmed down from an earlier pass whose chest/belly/head radii (up to
 * 0.42*width at the belly, 0.3-0.32*width through the head) read as "both
 * the body and the head are way too fat" — real small perching birds have
 * a proportionally slimmer, more streamlined torso than that. Radii below
 * are trimmed roughly 25-30% through the torso and head while keeping the
 * neck pinch (still clearly narrower than both chest and head) that fixed
 * the earlier "no head at all, just a blob" bug, and the full lathed body
 * then gets one more 25% width reduction via BODY_NARROW_SCALE so every
 * small songbird reads more slender overall without changing its
 * wingspan/length silhouette. A pair of near-black eye dots (see
 * buildEyeDotsGeometry) are baked onto the head via
 * mergeGeometriesWithColor — safe under any per-species body tint
 * multiply (near-black stays near-black regardless of what it's
 * multiplied against), giving every small-bird species actual facial
 * detail instead of a featureless head.
 *
 * The head region (from the neck pinch at halfLen*0.42 through the face
 * point) was narrowed a further 25% and lengthened 10% from the pass
 * above — every head radius past the neck pinch is scaled by
 * HEAD_NARROW_SCALE, and the head's own Y-span (neck pinch to face) is
 * stretched by HEAD_LENGTHEN_SCALE while keeping the neck pinch itself
 * fixed in place, so only the head elongates, not the neck/torso below
 * it. buildSmallBirdBeakGeometry's faceY/faceRadius mirror these same two
 * constants so the beak still attaches exactly at the (now narrower,
 * further-out) face point with no gap.
 */
const HEAD_NARROW_SCALE = 0.75; // 25% narrower
const HEAD_LENGTHEN_SCALE = 1.1; // 10% longer
const HEAD_START_FRAC = 0.42; // neck pinch — head-lengthening pivot, stays fixed
const HEAD_END_FRAC = HEAD_START_FRAC + (0.8 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face point
const BODY_NARROW_SCALE = 0.75; // 25% narrower overall
const BEAK_LENGTH_SCALE = 0.75; // 25% shorter

function buildTaperedBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const scaledWidth = width * BODY_NARROW_SCALE;
  // Head-region radii/positions below are all reduced/stretched relative
  // to the un-narrowed/un-lengthened pass via HEAD_NARROW_SCALE and
  // HEAD_LENGTHEN_SCALE (see their doc comment above) rather than
  // hand-tuned fresh numbers, so the two requested adjustments stay
  // easy to re-tune independently later.
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  const profile = [
    new THREE.Vector2(scaledWidth * 0.03, -halfLen * 1.0), // tail tip
    new THREE.Vector2(scaledWidth * 0.16, -halfLen * 0.7),
    new THREE.Vector2(scaledWidth * 0.3, -halfLen * 0.25), // belly bulge — slimmer than before
    new THREE.Vector2(scaledWidth * 0.28, halfLen * 0.15), // chest
    new THREE.Vector2(scaledWidth * 0.12, halfLen * HEAD_START_FRAC), // neck pinch — clearly narrower than chest/head
    new THREE.Vector2(scaledWidth * 0.21 * HEAD_NARROW_SCALE, halfLen * headFrac(0.58)), // head base bulge — clearly wider than the neck pinch
    new THREE.Vector2(scaledWidth * 0.22 * HEAD_NARROW_SCALE, halfLen * headFrac(0.66)), // crown, the widest point of the head
    new THREE.Vector2(scaledWidth * 0.15 * HEAD_NARROW_SCALE, halfLen * headFrac(0.74)), // forehead, narrowing toward the face
    new THREE.Vector2(scaledWidth * 0.075 * HEAD_NARROW_SCALE, halfLen * HEAD_END_FRAC), // face point, where the beak attaches
  ];
  const body = new THREE.LatheGeometry(profile, 14);

  const eyeY = halfLen * headFrac(0.68);
  const eyeX = scaledWidth * 0.16 * HEAD_NARROW_SCALE;
  const eyeZ = scaledWidth * 0.05 * HEAD_NARROW_SCALE;
  const eyeRadius = scaledWidth * 0.04 * HEAD_NARROW_SCALE;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: body, color: WHITE_VERTEX_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

// Near-black eye baked onto every small-bird species' head — see
// buildTaperedBodyGeometry's doc comment for why this stays visually
// correct under any per-species per-instance body tint.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);

/**
 * A small solid cone forming the beak — its own separate CreatureGeometries
 * `beak` part (not merged into the body) so each small-bird species can be
 * given its own distinct beak instance color (see Renderer3D's
 * BOID_SPECIES_CONFIGS). Attached at the same face point the body lathe
 * profile ends at (see buildTaperedBodyGeometry).
 */
function buildSmallBirdBeakGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const faceY = halfLen * HEAD_END_FRAC;
  const faceRadius = width * BODY_NARROW_SCALE * 0.075 * HEAD_NARROW_SCALE;
  const beakLen = length * 0.2 * BEAK_LENGTH_SCALE;
  const beakHeight = beakLen * 0.792;
  const geometry = new THREE.ConeGeometry(faceRadius * 1.3068, beakHeight, 8);
  geometry.scale(1, 1, 0.75); // slightly flattened, taller than wide
  // ConeGeometry's axis already runs along +Y (apex at +height/2, base at
  // -height/2), matching the body's own forward axis — no rotation
  // needed, just slide it forward so the base sits at the body's face
  // point and the apex protrudes further ahead of it.
  geometry.translate(0, faceY + beakHeight * 0.5, 0);
  return geometry;
}


/** Default brownish-gray leg color for small perching birds. */
export const SMALL_BIRD_DEFAULT_LEGS_COLOR = new THREE.Color(0x7a6450);

/**
 * Two thin legs each with three forward-pointing toes and one hind toe,
 * scaled to fit a small perching songbird. The legs are positioned back
 * toward the tail (where a real bird's ankle sits) and hang downward from
 * the belly. Vertex colors are white so the per-instance leg color set by
 * the renderer (BoidSpeciesConfig.legsColor) multiplies through unchanged.
 */
function buildSmallBirdLegsGeometry(length: number, width: number, legsColor: THREE.Color): THREE.BufferGeometry {
  const scaledWidth = width * BODY_NARROW_SCALE;
  const legRadius = scaledWidth * 0.048;
  // Short tucked legs — feet sit just below the belly surface.
  const legLength = length * 0.042;
  const toeLength = length * 0.055;
  const footY = -length * 0.22;
  // Hip flush against the belly: at footY the body radius ≈ 0.241*sw;
  // with x = 0.025*sw the surface Z ≈ 0.240*sw.
  const hipZ = -scaledWidth * 0.240;
  const footZ = hipZ - legLength * 0.9;

  const buildLeg = (side: 1 | -1): THREE.BufferGeometry => {
    const x = side * scaledWidth * 0.001;
    const leg = new THREE.CylinderGeometry(legRadius * 0.85, legRadius, legLength, 6);
    leg.rotateX(Math.PI / 2);
    leg.translate(x, footY, hipZ - legLength * 0.5);

    const makeToe = (xOffset: number, yBias: number): THREE.BufferGeometry => {
      const toe = new THREE.ConeGeometry(legRadius * 0.38, toeLength, 5);
      toe.translate(x + xOffset, footY + yBias + toeLength * 0.45, footZ);
      return toe;
    };
    // Three forward toes spread slightly around the tip.
    const toes = [
      makeToe(side * legRadius * 0.5, toeLength * 0.04),
      makeToe(0, toeLength * 0.1),
      makeToe(-side * legRadius * 0.5, toeLength * 0.04),
    ];
    // One hind toe pointing backward (rotated 180° along X).
    const hindToe = new THREE.ConeGeometry(legRadius * 0.28, toeLength * 0.6, 5);
    hindToe.rotateX(Math.PI);
    hindToe.translate(x, footY - toeLength * 0.26, footZ + toeLength * 0.02);
    return mergePositionOnlyGeometries([leg, ...toes, hindToe]);
  };

  const both = mergePositionOnlyGeometries([buildLeg(1), buildLeg(-1)]);
  // Bake the species leg color as vertex color; renderer sets instance color
  // to (1,1,1) so the baked color passes through unchanged.
  return mergeGeometriesWithColor([{ geometry: both, color: legsColor }]);
}


/**
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
export function buildTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const root = new THREE.Vector3(0, 0, 0);
  const leftTip = new THREE.Vector3(-width * 0.9, -length * 0.55, 0);
  const rightTip = new THREE.Vector3(width * 0.9, -length * 0.55, 0);
  const backCenter = new THREE.Vector3(0, -length * 0.85, 0);
  const thickness = width * 0.05;

  return extrudeRingGeometry([root, leftTip, backCenter, rightTip], thickness);
}
