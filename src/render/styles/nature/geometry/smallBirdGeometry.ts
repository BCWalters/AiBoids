import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  buildEyeDotsGeometry,
  buildDiscCapGeometry,
  extrudeRingGeometry,
  singleLegPart,
  mirrorGeometryAcrossX,
  subdivideTriangleSoup,
  swayingTailRig,
} from '../../../geometry/sharedGeometry';
import {
  applyTailGradient,
  getBirdBodyRearTipY,
  type TailGradient,
  buildTuckedBirdLegs,
} from './birdSharedGeometry';

/**
 * Per-species palette for baked vertex color gradients on small-bird
 * geometry. Pass to createRealisticBirdGeometries so each species gets its
 * own geometry instance with colors baked in.
 *
 * Body uses a **bilinear 4-corner gradient** blending both axes:
 *  - Y axis: headBack/headBelly (near the face) → tailBack/tailBelly (near the tail)
 *  - Z axis: belly (ventral, -Z) → back (dorsal, +Z)
 *  This lets each species have independent head-vs-tail AND back-vs-belly variation.
 *
 * - wing / wingTip: root-to-tip X-axis gradient on the wing panel.
 * - tail / tailTip: root-to-tip Y-axis gradient on the tail fan (-Y = tip).
 *
 * Set the corresponding `*Gradient` flag to false to skip that gradient.
 */
export interface SmallBirdPalette {
  headBack:  THREE.Color;  // dorsal (back) surface near the head/face
  headBelly: THREE.Color;  // ventral (belly) surface near the head/face
  tailBack:  THREE.Color;  // dorsal surface near the tail end
  tailBelly: THREE.Color;  // ventral surface near the tail end
  wing: THREE.Color;
  wingTip: THREE.Color;
  tail: THREE.Color;
  tailTip: THREE.Color;
  dorsalGradient: boolean;
  wingGradient: boolean;
  tailGradient: boolean;
  tailGradientRootColor?: THREE.Color;
  tailGradientInterpolation?: 'rgb' | 'hsl';
  tailGradientRootHold?: number;
}

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
export function createRealisticBirdGeometries(
  length: number,
  width: number,
  legsColor: THREE.Color = SMALL_BIRD_DEFAULT_LEGS_COLOR,
  palette?: SmallBirdPalette,
): CreatureGeometries {
  const body = buildTaperedBodyGeometry(length, width, palette);
  const beak = buildSmallBirdBeakGeometry(length, width);

  const wingSpan = length * 1.3;
  const wingChord = length * 0.6;
  const wingLeft = buildSmallBirdWingGeometry(wingSpan, wingChord, 1, palette);
  const wingRight = buildSmallBirdWingGeometry(wingSpan, wingChord, -1, palette);

  const tail = buildSmallBirdTailGeometry(
    length,
    width,
    palette?.tailGradient
      ? {
          root: palette.tailGradientRootColor ?? palette.tail,
          tip: palette.tailTip,
          interpolation: palette.tailGradientInterpolation,
          rootHold: palette.tailGradientRootHold,
        }
      : undefined,
  );
  const legs = buildSmallBirdLegsGeometry(length, width, legsColor, body);
  const tailRig = swayingTailRig({ pivot: [0, getBirdBodyRearTipY(length), 0], axis: [1, 0, 0] });

  return { body, wingLeft, wingRight, tail, tailRig, beak, legs: singleLegPart(legs) };
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
const HEAD_LENGTHEN_SCALE = 1.18; // longer skull, so the head reads by shape not by a waist
const HEAD_START_FRAC = 0.42; // nape — head-lengthening pivot, stays fixed
const HEAD_END_FRAC = HEAD_START_FRAC + (0.8 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face point
const BODY_NARROW_SCALE = 0.75; // 25% narrower overall
const BEAK_LENGTH_SCALE = 0.75; // 25% shorter

/**
 * Radius of the lathe's final ring, where the beak plugs in, as a fraction of
 * the scaled body width. Shared by the profile and the beak so the joint stays
 * closed if either is re-tuned.
 *
 * Deliberately blunt. Running the head all the way down to a near-point made
 * the skull a long cone with a needle on the end; a songbird's face keeps its
 * depth right up to the cere and the beak emerges from it as a distinct wedge.
 */
const FACE_RADIUS_FRAC = 0.13;

/**
 * Lateral squeeze and vertical stretch applied to the whole lathed body.
 *
 * A lathe is circular in cross-section, so without this the bird presents the
 * identical outline from the side and from above — which is what made it read
 * as a float or an egg rather than a bird. Real songbirds are deep-chested and
 * narrow: the belly hangs well below the spine while the body stays slim
 * between the wings.
 *
 * Applied to the body as a whole rather than ramped along it, because unlike
 * the parrot's head narrowing there is no boundary here for a ramp to betray —
 * every cross-section wants the same treatment, so a constant cannot introduce
 * a step.
 */
const BODY_SQUEEZE_X = 0.88;
const BODY_DEEPEN_Z = 1.12;

/**
 * Extra downward stretch applied only below the spine, so the belly hangs
 * rather than the whole body inflating symmetrically.
 *
 * Ramped in along the body's length and faded out over the head, which is not
 * deep-bellied; an unramped version put a keel under the chin.
 */
const BODY_BELLY_DROOP = 1.16;

/**
 * Turns the circular cross-section a lathe produces into a bird-shaped one:
 * narrower across than it is deep, with the belly hanging below the spine.
 *
 * The lathe axis runs along Y, so every ring is a circle in XZ. Squeezing X and
 * stretching Z alone would still leave the body symmetric top-to-bottom, giving
 * it a keel as prominent as its back; real songbirds carry the depth almost
 * entirely underneath. The droop is therefore applied only to vertices below
 * the spine, and faded out across the head, which is not deep-bellied — without
 * that fade the skull grew a wattle under the chin.
 *
 * Normals are recomputed because a non-uniform scale does not preserve them:
 * scaling a surface by (a, b, c) transforms its normals by (1/a, 1/b, 1/c), so
 * reusing the lathe's originals would light the body as though it were still
 * round.
 */
/** How far an eye dot is pulled into the skull, as a fraction of its radius. */
const EYE_SET_IN_FRAC = 0.45;

/**
 * The body surface's half-width at a given station, read off the built
 * geometry.
 *
 * Picks the vertex on the +X side whose (y, z) is nearest the query point. The
 * lathe is resampled through a spline, so there is no closed form for its
 * radius at an arbitrary Y, and the cross-section shaping means the answer also
 * depends on Z — measuring the result is both simpler and self-correcting.
 */
function sampleSurfaceHalfWidthAt(geometry: THREE.BufferGeometry, y: number, z: number): number {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    if (x <= 0) continue;
    const dy = position.getY(i) - y;
    const dz = position.getZ(i) - z;
    const distance = dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = x;
    }
  }
  return best;
}

function shapeBirdCrossSection(
  geometry: THREE.BufferGeometry,
  droopFadeStartY: number,
  droopFadeEndY: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const z = position.getZ(i) * BODY_DEEPEN_Z;
    // 1 over the torso, easing to 0 through the head.
    const bellyFade = 1 - THREE.MathUtils.smoothstep(y, droopFadeStartY, droopFadeEndY);
    const droop = z < 0 ? THREE.MathUtils.lerp(1, BODY_BELLY_DROOP, bellyFade) : 1;
    position.setX(i, position.getX(i) * BODY_SQUEEZE_X);
    position.setZ(i, z * droop);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function buildTaperedBodyGeometry(length: number, width: number, palette?: SmallBirdPalette): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const scaledWidth = width * BODY_NARROW_SCALE;
  const bodyRearY = getBirdBodyRearTipY(length);
  // Head-region radii/positions below are all reduced/stretched relative
  // to the un-narrowed/un-lengthened pass via HEAD_NARROW_SCALE and
  // HEAD_LENGTHEN_SCALE (see their doc comment above) rather than
  // hand-tuned fresh numbers, so the two requested adjustments stay
  // easy to re-tune independently later.
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  // The nape is only slightly narrower than the chest. An earlier profile
  // pinched it to 43 % of the chest radius to make the head stand out, but on a
  // lathe that reads as an hourglass waist with a ball balanced on it — real
  // songbirds have no visible neck at all in flight, the skull runs straight
  // into the shoulders. The head is instead made to read through its own shape:
  // a long crown plateau over a wedge-shaped face (see HEAD_LENGTHEN_SCALE).
  const controlPoints = [
    new THREE.Vector2(scaledWidth * 0.03, bodyRearY), // tail tip
    new THREE.Vector2(scaledWidth * 0.17, -halfLen * 0.7),
    new THREE.Vector2(scaledWidth * 0.29, -halfLen * 0.28), // belly
    new THREE.Vector2(scaledWidth * 0.3, -halfLen * 0.02), // chest, the widest point
    new THREE.Vector2(scaledWidth * 0.27, halfLen * 0.22), // shoulder
    new THREE.Vector2(scaledWidth * 0.225, halfLen * HEAD_START_FRAC), // nape — a gentle dip, not a waist
    // Every station below must stay inside headFrac(0.8) — that is where
    // HEAD_END_FRAC lands, and a control point past it sends the profile
    // forward and then back, folding the lathe into a cup around the beak.
    new THREE.Vector2(scaledWidth * 0.3 * HEAD_NARROW_SCALE, halfLen * headFrac(0.52)), // rear skull
    new THREE.Vector2(scaledWidth * 0.315 * HEAD_NARROW_SCALE, halfLen * headFrac(0.59)), // cheek, widest point of the head
    new THREE.Vector2(scaledWidth * 0.3 * HEAD_NARROW_SCALE, halfLen * headFrac(0.66)), // crown plateau, barely tapering
    new THREE.Vector2(scaledWidth * 0.245 * HEAD_NARROW_SCALE, halfLen * headFrac(0.72)), // forehead
    new THREE.Vector2(scaledWidth * 0.185 * HEAD_NARROW_SCALE, halfLen * headFrac(0.765)), // face, wedging toward the beak
    new THREE.Vector2(scaledWidth * FACE_RADIUS_FRAC * HEAD_NARROW_SCALE, halfLen * HEAD_END_FRAC), // beak seat
  ];
  // Spline-resample the authored silhouette so the flat-shaded lathe reads
  // as a smooth surface (many gently-varying facets) instead of a few long
  // banded ones; raise radial segments to 32 for the same reason.
  const profile = new THREE.SplineCurve(controlPoints).getPoints(64);
  const body = new THREE.LatheGeometry(profile, 32);
  shapeBirdCrossSection(body, halfLen * HEAD_START_FRAC, halfLen * headFrac(0.72));

  if (palette?.dorsalGradient) {
    // Bilinear body gradient:
    //   Y axis: maxY = head, minY = tail  →  tY: 0=head, 1=tail
    //   Z axis: normal.z — dorsal (+1 = back), ventral (-1 = belly)  →  tZ: 0=belly, 1=back
    // Blend: lerp( lerp(headBelly, headBack, tZ), lerp(tailBelly, tailBack, tZ), tY )
    //
    // We derive tZ from the vertex normal's Z component rather than from
    // position.z / global-zSpan. The body is a LatheGeometry that tapers to
    // near-zero radius at the nose and tail tips; at those tips every vertex
    // has position.z ≈ 0 (the midpoint), so the position-based blend always
    // returns tZ ≈ 0.5 there — producing the wrong midpoint average colour
    // instead of the intended tailBack or tailBelly values. The vertex normal
    // points radially outward from the lathe axis and is independent of the
    // local radius, so normal.z correctly gives +1 on the back surface and
    // -1 on the belly even where the body is nearly pointed.
    body.computeVertexNormals();
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;
    const maxY = body.boundingBox!.max.y;
    const ySpan = Math.max(1e-5, maxY - minY);
    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = body.getAttribute('normal') as THREE.BufferAttribute;
    const gradColors = new Float32Array(posAttr.count * 3);
    for (let vi = 0; vi < posAttr.count; vi++) {
      // tY = 0 → head (high +Y), tY = 1 → tail (low -Y)
      const tY = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp((maxY - posAttr.getY(vi)) / ySpan, 0, 1),
        0.05, 0.95,
      );
      // tZ = 0 → belly (-Z), tZ = 1 → back (+Z)
      // Map normal.z from [-1..+1] to [0..1] then smoothstep.
      const tZ = THREE.MathUtils.smoothstep((normalAttr.getZ(vi) + 1) / 2, 0.15, 0.85);
      // Bilinear blend across the four corners
      const r = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(palette.headBelly.r, palette.headBack.r, tZ),
        THREE.MathUtils.lerp(palette.tailBelly.r, palette.tailBack.r, tZ),
        tY,
      );
      const g = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(palette.headBelly.g, palette.headBack.g, tZ),
        THREE.MathUtils.lerp(palette.tailBelly.g, palette.tailBack.g, tZ),
        tY,
      );
      const b = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(palette.headBelly.b, palette.headBack.b, tZ),
        THREE.MathUtils.lerp(palette.tailBelly.b, palette.tailBack.b, tZ),
        tY,
      );
      gradColors[vi * 3]     = r;
      gradColors[vi * 3 + 1] = g;
      gradColors[vi * 3 + 2] = b;
    }
    body.setAttribute('color', new THREE.BufferAttribute(gradColors, 3));
  }

  const eyeY = halfLen * headFrac(0.68);
  const eyeZ = scaledWidth * 0.05 * HEAD_NARROW_SCALE;
  const eyeRadius = scaledWidth * 0.04 * HEAD_NARROW_SCALE;
  // Measured off the finished skull rather than set as a fixed fraction of the
  // body width. The head's width is now the product of the lathe profile, the
  // head narrowing and the lateral squeeze, so any hard-coded X drifts off the
  // surface the moment one of those is re-tuned — which is exactly what
  // widening the skull above did to the previous constant, sinking the eyes
  // inside the head. Pulled in by a fraction of the dot's own radius so it
  // sits in the socket instead of balanced on the surface.
  const eyeX = sampleSurfaceHalfWidthAt(body, eyeY, eyeZ) - eyeRadius * EYE_SET_IN_FRAC;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  // Seal the open tail-end lathe ring with a double-sided disc cap so it no
  // longer reads as a transparent hole when viewed from behind.
  const tailTip = controlPoints[0];
  const tailCap = buildDiscCapGeometry(tailTip.y, tailTip.x, 32);

  // When a dorsal gradient is baked, the body vertices at the tail tip blend
  // between tailBelly (ventral) and tailBack (dorsal). The cap sits at tY≈1
  // and tZ≈0.5 (center of the disc), so the closest match is the midpoint
  // between the two tail-end palette colors — avoiding the white/grey cap
  // that was visible against colored plumage (e.g. grey cap on a red cardinal).
  const tailCapColor = palette?.dorsalGradient
    ? new THREE.Color(
        (palette.tailBelly.r + palette.tailBack.r) * 0.5,
        (palette.tailBelly.g + palette.tailBack.g) * 0.5,
        (palette.tailBelly.b + palette.tailBack.b) * 0.5,
      )
    : WHITE_VERTEX_COLOR;

  return mergeGeometriesWithColor([
    { geometry: body, color: WHITE_VERTEX_COLOR },
    { geometry: tailCap, color: tailCapColor },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

// Near-black eye baked onto every small-bird species' head — see
// buildTaperedBodyGeometry's doc comment for why this stays visually
// correct under any per-species per-instance body tint.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);

/**
 * Total angular spread of the tail fan, outermost rectrix to outermost.
 *
 * Songbird tails are narrow — nothing like a hawk's fan — but they are not the
 * single stiff kite this used to be. The spread only has to be wide enough for
 * the individual feathers to separate visibly.
 */
const TAIL_SPREAD_DEG = 22;

/**
 * How far forward of the body's rear tip the tail roots start, as a fraction of
 * body length.
 *
 * The old tail met the body at exactly one vertex, at exactly the point the
 * lathe closed to nothing, so it read as a separate object stuck on behind the
 * bird. Starting the roots inside the body guarantees the joint is buried
 * whatever the flap and sway do to it.
 */
const TAIL_ROOT_OVERLAP_FRAC = 0.055;

/**
 * A fan of individual tail feathers rooted across the full width of the rump.
 *
 * Replaces a single flat four-cornered kite. That shape had three separate
 * problems that all read as "the tail is disconnected": it met the body at one
 * point, it was one solid sheet so nothing about it said "feathers", and its
 * widest span sat halfway down its length, which is a leaf outline rather than
 * a tail.
 *
 * Each rectrix is widest at the rump and tapers monotonically to a point, and
 * the roots are spread across the rump rather than pinned to the centreline, so
 * the fan emerges from the body's whole width. A block of coverts caps the
 * joint, which is what covers it on a real bird.
 */
function buildSmallBirdTailGeometry(
  length: number,
  width: number,
  gradient?: TailGradient,
): THREE.BufferGeometry {
  const scaledWidth = width * BODY_NARROW_SCALE;
  // Thin: this is a stack of quills, so the thickness exists only to stop the
  // fan disappearing when it is seen exactly edge-on.
  const thickness = width * 0.02;
  const rootY = getBirdBodyRearTipY(length) + length * TAIL_ROOT_OVERLAP_FRAC;

  const featherCount = 9;
  const maxLen = length * 0.62;
  const minLenFrac = 0.62; // outermost rectrices, relative to the central pair
  const rootHalfSpan = scaledWidth * 0.09;

  const parts: THREE.BufferGeometry[] = [];

  // Covert block over the joint. Flattened hard in Z so it reads as the base of
  // the tail rather than a lump on the rump.
  const coverts = new THREE.SphereGeometry(scaledWidth * 0.16, 14, 10);
  coverts.scale(1, 1.35, 0.38);
  coverts.translate(0, rootY + length * 0.03, 0);
  parts.push(coverts);

  for (let i = 0; i < featherCount; i++) {
    const t = (i / (featherCount - 1)) * 2 - 1; // -1 .. 0 .. +1
    const angle = THREE.MathUtils.degToRad(t * TAIL_SPREAD_DEG);
    const lenFrac = minLenFrac + (1 - minLenFrac) * Math.pow(Math.cos((t * Math.PI) / 2), 1.3);
    const featherLen = maxLen * lenFrac;

    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle);
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const droop = -length * 0.05 * lenFrac;
    // Neighbouring vanes overlap at the root, so without a Z step they would
    // fuse into one slab. Stepping alternate feathers down keeps the overlap
    // reading as layers; see the parrot's wing fan for the same treatment.
    const shingleZ = (i % 2 === 0 ? 0 : -1) * thickness * 0.85;
    const rootHalfWidth = scaledWidth * 0.075 * lenFrac;
    // Held broad most of the way out and only closing near the end, so the
    // vanes overlap into a fan with feather divisions showing through it. An
    // earlier taper narrowed steadily from the root and the tail came out as a
    // spray of spikes with gaps between them.
    const taper: [number, number][] = [
      [0.35, 0.9],
      [0.66, 0.74],
      [0.86, 0.55],
      [0.97, 0.3],
    ];

    const at = (frac: number, halfWidthFrac: number, sideSign: 1 | -1): THREE.Vector3 =>
      new THREE.Vector3(
        t * rootHalfSpan + dirX * featherLen * frac + perpX * rootHalfWidth * halfWidthFrac * sideSign,
        rootY + dirY * featherLen * frac + perpY * rootHalfWidth * halfWidthFrac * sideSign,
        droop * frac + shingleZ,
      );

    const ring: THREE.Vector3[] = [
      at(0, 1, -1),
      ...taper.map(([frac, halfWidthFrac]) => at(frac, halfWidthFrac, -1)),
      new THREE.Vector3(
        t * rootHalfSpan + dirX * featherLen,
        rootY + dirY * featherLen,
        droop + shingleZ,
      ),
      ...taper.map(([frac, halfWidthFrac]) => at(frac, halfWidthFrac, 1)).reverse(),
      at(0, 1, 1),
    ];
    parts.push(extrudeRingGeometry(ring, thickness));
  }

  const geometry = mergePositionOnlyGeometries(parts);
  parts.forEach((part) => part.dispose());
  if (gradient) applyTailGradient(geometry, gradient);
  geometry.computeVertexNormals();
  return geometry;
}

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
  const faceRadius = width * BODY_NARROW_SCALE * FACE_RADIUS_FRAC * HEAD_NARROW_SCALE;
  const beakLen = length * 0.2 * BEAK_LENGTH_SCALE;
  const beakHeight = beakLen * 0.792;
  const geometry = new THREE.ConeGeometry(faceRadius * 1.12, beakHeight, 8);
  // Deeper than wide, and squeezed laterally by the same factor as the body so
  // the cone's base matches the ring it plugs into — the head is no longer
  // round in section, and a round beak on it stood proud at the corners.
  geometry.scale(BODY_SQUEEZE_X, 1, 1.12);
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
function buildSmallBirdLegsGeometry(
  length: number,
  width: number,
  legsColor: THREE.Color,
  body: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const scaledWidth = width * BODY_NARROW_SCALE;
  const legs = buildTuckedBirdLegs({
    body,
    length,
    width: scaledWidth,
    footY: -length * 0.22,
    legX: scaledWidth * 0.085,
    legRadius: scaledWidth * 0.026,
    toeLength: length * 0.055,
    toeRadius: scaledWidth * 0.022,
    toeSpread: scaledWidth * 0.03,
    footDrop: 0.05,
  });
  // Vertex colours carry the species leg colour; the renderer sets the
  // instance colour to white so this passes through unchanged.
  return mergeGeometriesWithColor([{ geometry: legs, color: legsColor }]);
}


/**
 * Number of flight feathers fanned along the wing's trailing edge.
 *
 * The old wing had four short spikes clustered at the tip and nothing else, so
 * the entire trailing edge was a single straight cut and the wing read as a
 * flat leaf. On a real songbird the flight feathers ARE most of the wing —
 * the solid coverts cover only the inner part — and they run the whole trailing
 * edge as a shingled fan.
 */
const WING_FEATHER_COUNT = 14;

/**
 * How far the feather roots overlap along the trailing edge, as a fraction of
 * its length. Greater than the spacing between roots, so neighbouring vanes
 * overlap and the fan reads as continuous rather than as separated fingers.
 */
const WING_FEATHER_BASE_HALF_GAP = 0.085;

/**
 * Depth below the panel's mid-plane at which the feather fan is seated, as a
 * fraction of chord, and the extra step between neighbours.
 *
 * Both are one-directional: every feather sits at or below the panel's
 * underside so none can surface through the top of the wing, whatever the
 * undulation shader does to it. See PARROT_FEATHER_SEAT_FRAC in parrotGeometry
 * for the same arrangement and why the alternation is not symmetric.
 */
const WING_FEATHER_SEAT_FRAC = 0.014;
const WING_FEATHER_SHINGLE_FRAC = 0.013;

/**
 * How many times each wing-panel triangle is divided along each edge.
 *
 * The panel is bent by the wing-undulation vertex shader, which can only move
 * vertices that exist; between them the surface is interpolated straight. A
 * panel of a few large triangles therefore cannot hold the travelling wave, and
 * the finely-tessellated feathers seated just beneath it surface straight
 * through — the flicker that was reported on the parrot. See
 * PARROT_WING_PANEL_DIVISIONS for the full measurement.
 */
const WING_PANEL_DIVISIONS = 12;

function buildSmallBirdWingGeometry(
  span: number,
  chord: number,
  side: 1 | -1,
  palette?: SmallBirdPalette,
): THREE.BufferGeometry {
  // The right wing is the reflection of the left, never a second build with
  // the sign pushed through every coordinate. See mirrorGeometryAcrossX.
  if (side === -1) {
    return mirrorGeometryAcrossX(buildSmallBirdWingGeometry(span, chord, 1, palette));
  }
  const s: 1 = 1;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  // Enough to catch the light and to stop the wing vanishing when seen exactly
  // edge-on, which a zero-thickness sheet does completely.
  const halfThickness = chord * 0.008;

  // Coverts panel: the solid inner part of the wing. Deliberately shorter than
  // the full span — the outer third of a songbird's wing is flight feather, not
  // membrane. The outline is sampled densely around a smooth curve rather than
  // authored as a handful of corners, because straight segments between distant
  // corners are what made the old wing read as a hard-edged polygon.
  const panelSpan = span * 0.52;
  const root: number[] = [0, 0, 0];
  const boundary: number[][] = [
    [0.14 * panelSpan * s, chord * 0.36],
    [0.42 * panelSpan * s, chord * 0.4],
    [0.68 * panelSpan * s, chord * 0.37],
    [0.87 * panelSpan * s, chord * 0.28],
    [1.0 * panelSpan * s, chord * 0.12],
    [0.98 * panelSpan * s, -chord * 0.06],
    [0.82 * panelSpan * s, -chord * 0.2],
    [0.55 * panelSpan * s, -chord * 0.28],
    [0.26 * panelSpan * s, -chord * 0.3],
  ].map(([x, y]) => [x, y, 0]);

  for (let i = 0; i < boundary.length; i++) {
    const next = boundary[(i + 1) % boundary.length];
    // The fan origin sits outside the boundary loop, so on the segment that
    // wraps from the last point back to the first it falls on the far side of
    // the edge and reverses that triangle's winding. Ordering each triangle by
    // its own signed area keeps the sheet consistently wound; `* s` because
    // mirroring the wing negates x and flips every cross product with it.
    const signedArea =
      (boundary[i][0] - root[0]) * (next[1] - root[1]) -
      (boundary[i][1] - root[1]) * (next[0] - root[0]);
    const forward = signedArea * s < 0;
    const a = forward ? boundary[i] : next;
    const b = forward ? next : boundary[i];
    const top = (p: number[]) => [p[0], p[1], halfThickness];
    const bottom = (p: number[]) => [p[0], p[1], -halfThickness];
    pushTri(top(root), top(a), top(b));
    pushTri(bottom(root), bottom(b), bottom(a));
  }

  // Flight feathers, fanned along the whole trailing edge from the inner
  // secondaries out to the primaries at the tip.
  const trailInner = boundary[8];
  const trailOuter = boundary[4];
  const lerp3 = (a: number[], b: number[], t: number): number[] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const featherGeometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < WING_FEATHER_COUNT; i++) {
    const t = i / (WING_FEATHER_COUNT - 1);
    const featherT = THREE.MathUtils.smoothstep(t, 0, 1);
    const baseA = lerp3(trailInner, trailOuter, Math.max(0, featherT - WING_FEATHER_BASE_HALF_GAP));
    const baseB = lerp3(trailInner, trailOuter, Math.min(1, featherT + WING_FEATHER_BASE_HALF_GAP));
    const midBase = lerp3(baseA, baseB, 0.5);
    // Primaries are much longer than the inner secondaries, and they sweep
    // progressively outward toward the tip rather than all trailing straight
    // back — that sweep is most of what gives a wing its shape in flight.
    const fingerLen = span * (0.17 + 0.25 * featherT);
    const lateral = 0.06 + 0.5 * Math.pow(featherT, 1.2);
    const dir = new THREE.Vector2(s * lateral, -(1.05 + 0.2 * t)).normalize();
    // `* s` because the vane's two base corners come from the trailing edge,
    // which mirrors with the wing, while (-dir.y, dir.x) does not: its X is
    // -dir.y, and dir.y is negative on both wings. Without this the ring runs
    // out to one side and back to a base corner on that same side, crossing
    // itself and notching a wedge out of every feather on the right wing only.
    const perp = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(s);
    const rootHalfWidth =
      Math.max(1e-4, Math.hypot(baseB[0] - baseA[0], baseB[1] - baseA[1]) * 0.5) * 1.14;
    const seatZ = -chord * WING_FEATHER_SEAT_FRAC;
    const shingleZ = (i % 2 === 0 ? 0 : -1) * chord * WING_FEATHER_SHINGLE_FRAC;
    const droop = -chord * (0.01 + 0.05 * t);

    const at = (dist: number, halfWidthFrac: number, sideSign: 1 | -1, z: number) =>
      new THREE.Vector3(
        midBase[0] + dir.x * fingerLen * dist + perp.x * rootHalfWidth * halfWidthFrac * sideSign,
        midBase[1] + dir.y * fingerLen * dist + perp.y * rootHalfWidth * halfWidthFrac * sideSign,
        seatZ + shingleZ + z,
      );
    // Roots stay on the common seat plane so the fan leaves the trailing edge
    // as one line; each vane then steps down to its own layer.
    const ring: THREE.Vector3[] = [
      new THREE.Vector3(baseA[0], baseA[1], seatZ),
      at(0.5, 0.86, -1, droop * 0.5),
      at(0.78, 0.66, -1, droop * 0.8),
      at(0.93, 0.42, -1, droop),
      at(1.0, 0.16, -1, droop),
      at(1.0, 0.16, 1, droop),
      at(0.93, 0.42, 1, droop),
      at(0.78, 0.66, 1, droop * 0.8),
      at(0.5, 0.86, 1, droop * 0.5),
      new THREE.Vector3(baseB[0], baseB[1], seatZ),
    ];
    featherGeometries.push(extrudeRingGeometry(ring, chord * 0.009));
  }

  const panel = new THREE.BufferGeometry();
  panel.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array(subdivideTriangleSoup(positions, WING_PANEL_DIVISIONS)),
      3,
    ),
  );
  const geometry = mergePositionOnlyGeometries([panel, ...featherGeometries]);
  panel.dispose();
  featherGeometries.forEach((f) => f.dispose());

  if (palette?.wingGradient) {
    // Root-to-tip ramp along X, measured off the finished geometry so the
    // feathers past the panel's own tip are included in the extent.
    geometry.computeBoundingBox();
    const maxAbsX = Math.max(
      Math.abs(geometry.boundingBox!.min.x),
      Math.abs(geometry.boundingBox!.max.x),
    );
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);
    for (let vi = 0; vi < posAttr.count; vi++) {
      const t = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp(Math.abs(posAttr.getX(vi)) / Math.max(1e-5, maxAbsX), 0, 1),
        0.05,
        0.95,
      );
      colors[vi * 3] = THREE.MathUtils.lerp(palette.wing.r, palette.wingTip.r, t);
      colors[vi * 3 + 1] = THREE.MathUtils.lerp(palette.wing.g, palette.wingTip.g, t);
      colors[vi * 3 + 2] = THREE.MathUtils.lerp(palette.wing.b, palette.wingTip.b, t);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  geometry.computeVertexNormals();
  return geometry;
}
