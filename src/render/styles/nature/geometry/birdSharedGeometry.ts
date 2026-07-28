import * as THREE from 'three';
import {
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mirrorGeometryAcrossX,
  subdivideTriangleSoup,
} from '../../../geometry/sharedGeometry';

/**
 * Bird-part geometry shared across the nature-scene bird species —
 * hawk, parrot, unicorn (pegasus wings), and the small songbirds. These
 * are palette-agnostic silhouette builders (a fingered raptor/pegasus
 * wing, a hooked bird-of-prey/parrot beak, and a fanned tail fan) that
 * more than one nature creature reuses, so they live here rather than in
 * any single creature's file. Truly cross-scene primitives (merge/extrude/
 * eye dots) live one level up in geometry/sharedGeometry.ts instead.
 */

/**
 * Root→tip gradient colors for a tail fan. Kept as a tiny standalone
 * interface (rather than taking the small-bird SmallBirdPalette) so this
 * shared helper has no dependency back on any one species' palette type.
 */
export interface TailGradient {
  root: THREE.Color;
  tip: THREE.Color;
  interpolation?: 'rgb' | 'hsl';
  rootHold?: number;
}

/** Rear-most Y of the shared lathed bird body profile (tail attachment point). */
export function getBirdBodyRearTipY(length: number): number {
  return -length * 0.5;
}

/**
 * Tail-fan profile Y coordinates derived from the body rear tip.
 *
 * Rear extent intentionally preserves the long-distance silhouette the existing
 * birds already had; only the root moves back to the real body rear.
 */
export function getBirdTailFanProfileY(length: number): {
  rootY: number;
  sideTipY: number;
  backCenterY: number;
} {
  const rootY = getBirdBodyRearTipY(length);
  const backCenterY = -length * 0.85;
  const sideTipT = 0.55 / 0.85;
  const sideTipY = THREE.MathUtils.lerp(rootY, backCenterY, sideTipT);
  return { rootY, sideTipY, backCenterY };
}

/**
 * Wing planform and feather layout, shared by the hawk and the unicorn's
 * pegasus wings.
 *
 * Both creatures previously reused `buildFingeredWingGeometry`, a flat,
 * zero-thickness triangle fan radiating from the root. That had four separate
 * problems, all visible in a still render:
 *
 *   - it vanished completely when seen edge-on, having no thickness at all;
 *   - its "fingers" were notches in a solid outline, so at any distance the
 *     wing read as a plain black slab rather than as separated primaries;
 *   - the outline was a straight-edged polygon, where a soaring raptor's wing
 *     has a leading edge that bulges forward and a trailing edge that curves;
 *   - being a fan from the root, single triangles spanned the whole wing, so
 *     the undulation vertex shader could only render its travelling wave as one
 *     straight chord. This is the same defect that made the parrot's feathers
 *     surface through its wing panel.
 *
 * The replacement is a curved panel carrying two separate feather groups, which
 * is how a raptor wing is actually arranged: secondaries forming a continuous
 * shingled edge along the inner trailing edge, and a small number of long,
 * deeply separated primaries at the tip. The gaps between those primaries are
 * the single most recognisable thing about a soaring hawk.
 *
 * The shape is entirely proportional to `span` and `chord`, so a caller that
 * wants a bigger wing only changes those two numbers — which is exactly what
 * the unicorn does (issue #301). Nothing here is hawk-specific beyond the
 * planform tables, and those describe a generic feathered flight wing.
 */
const PRIMARY_COUNT = 6;
const SECONDARY_COUNT = 10;
/** Fraction of the span at which the hand (primaries) takes over from the arm. */
const WRIST_FRAC = 0.58;
/** How far the primaries splay apart, in radians, from innermost to outermost. */
const PRIMARY_SPLAY_RAD = 0.62;
/** Spanwise fraction at which the solid panel ends and only feathers continue. */
const PANEL_END_FRAC = 0.76;
const FEATHER_SEAT_FRAC = 0.012;
const FEATHER_SHINGLE_FRAC = 0.014;
/**
 * Panel subdivision, for the same reason as the parrot's. A flat panel needs
 * interior vertices before a vertex shader can bend it into anything but a
 * plane; without them the panel swings out from under its own feathers as the
 * wing flaps.
 */
const WING_PANEL_DIVISIONS = 14;

export interface FeatheredWingParams {
  /** Root-to-tip extent, along +X for the left wing. */
  span: number;
  /** Leading-to-trailing depth at the wing root; every feature scales off it. */
  chord: number;
  side: 1 | -1;
}

export function buildFeatheredWingGeometry({ span, chord, side }: FeatheredWingParams): THREE.BufferGeometry {
  // The right wing is the reflection of the left, never a second build with the
  // sign pushed through every coordinate. See mirrorGeometryAcrossX.
  if (side === -1) return mirrorGeometryAcrossX(buildFeatheredWingGeometry({ span, chord, side: 1 }));

  const halfThickness = chord * 0.009;
  const panel: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => panel.push(...a, ...b, ...c);

  // Leading and trailing edges, given as explicit stations along the span and
  // interpolated between. Written as tables rather than as trigonometric
  // expressions because the outline has to be read and adjusted by eye, and a
  // closed-form version of it proved impossible to reason about: an earlier
  // attempt produced a wing whose outer half pointed forwards.
  //
  // Both edges are in chord units. The leading edge bulges forward over the
  // arm and sweeps back past the wrist; the trailing edge is deepest inboard,
  // which is what gives a soaring raptor its broad, plank-like inner wing.
  // The panel only carries the front two-thirds of the chord; the secondaries
  // supply the rest. Giving the panel the full depth made the inner wing read
  // as a solid slab with a row of small scallops stuck on the back of it.
  const leadingStations = [0.44, 0.5, 0.51, 0.49, 0.45, 0.36, 0.12];
  const trailingStations = [-0.3, -0.36, -0.37, -0.34, -0.27, -0.18, -0.05];
  const sampleEdge = (table: number[], t: number) => {
    const u = THREE.MathUtils.clamp(t / PANEL_END_FRAC, 0, 1) * (table.length - 1);
    const i = Math.min(Math.floor(u), table.length - 2);
    return chord * THREE.MathUtils.lerp(table[i], table[i + 1], u - i);
  };
  const leadingAt = (t: number) => sampleEdge(leadingStations, t);
  const trailingAt = (t: number) => sampleEdge(trailingStations, t);

  const panelSteps = 18;
  for (let i = 0; i < panelSteps; i++) {
    const t0 = (i / panelSteps) * PANEL_END_FRAC;
    const t1 = ((i + 1) / panelSteps) * PANEL_END_FRAC;
    const x0 = span * t0;
    const x1 = span * t1;
    const l0 = leadingAt(t0);
    const l1 = leadingAt(t1);
    const tr0 = trailingAt(t0);
    const tr1 = trailingAt(t1);
    for (const z of [halfThickness, -halfThickness]) {
      pushTri([x0, l0, z], [x1, l1, z], [x1, tr1, z]);
      pushTri([x0, l0, z], [x1, tr1, z], [x0, tr0, z]);
    }
    // Closed rim, so the wing still shows a solid edge when seen edge-on.
    pushTri([x0, l0, halfThickness], [x0, l0, -halfThickness], [x1, l1, -halfThickness]);
    pushTri([x0, l0, halfThickness], [x1, l1, -halfThickness], [x1, l1, halfThickness]);
    pushTri([x0, tr0, -halfThickness], [x0, tr0, halfThickness], [x1, tr1, halfThickness]);
    pushTri([x0, tr0, -halfThickness], [x1, tr1, halfThickness], [x1, tr1, -halfThickness]);
  }

  /**
   * Camber and dihedral, applied to the finished wing rather than baked into
   * each piece, so the panel and every feather stay on one continuous surface.
   *
   * Without this the wing is a dead-flat plate: it shades as a single uniform
   * tone from every angle, which is what made the previous version read as a
   * cut-out rather than a wing.
   *
   * `u` runs 0 at the leading edge to 1 at the panel's trailing edge and on
   * past 1 over the feathers, so the bulge rises over the panel and settles
   * back down along the flight feathers.
   */
  const curveWing = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const t = THREE.MathUtils.clamp(x / span, 0, 1);
      const lead = leadingAt(t);
      const depth = Math.max(lead - trailingAt(t), 1e-4);
      const u = THREE.MathUtils.clamp((lead - position.getY(i)) / depth, 0, 2.6);
      // Rises over the panel and droops away along the flight feathers, which
      // is the real profile. Peaking the bulge at the panel's trailing edge
      // instead reflexed it, and the secondaries read as upturned flaps.
      const camber =
        u <= 1
          ? chord * 0.075 * Math.sin(Math.PI * u)
          : -chord * 0.055 * ((u - 1) / 1.6);
      const dihedral = span * 0.045 * t * t;
      position.setZ(i, position.getZ(i) + camber + dihedral);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  };

  const parts: THREE.BufferGeometry[] = [];
  const panelGeometry = new THREE.BufferGeometry();
  panelGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(subdivideTriangleSoup(panel, WING_PANEL_DIVISIONS)), 3),
  );
  panelGeometry.computeVertexNormals();
  parts.push(panelGeometry);

  const seatZ = -chord * FEATHER_SEAT_FRAC;

  // Secondaries: a continuous shingled row along the inner trailing edge.
  for (let i = 0; i < SECONDARY_COUNT; i++) {
    const t = (i + 0.5) / SECONDARY_COUNT;
    const at = t * WRIST_FRAC;
    const x = span * at;
    const rootY = trailingAt(at);
    const width = (span * WRIST_FRAC) / SECONDARY_COUNT;
    const len = chord * (0.46 + 0.14 * Math.sin(Math.PI * t));
    const z = seatZ + (i % 2 === 0 ? 0 : -1) * chord * FEATHER_SHINGLE_FRAC;
    // Secondaries trail straight back, leaning slightly outward down the span.
    const theta = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(6, 22, t));
    parts.push(
      buildFlightFeatherGeometry({
        root: [x, rootY, z],
        dir: new THREE.Vector2(Math.sin(theta), -Math.cos(theta)),
        length: len,
        halfWidth: width * 1.15,
        tipFrac: 0.88,
      }),
    );
  }

  // Primaries: long, separated, and splayed progressively further back and
  // outward toward the tip. The gaps between them are the point.
  for (let i = 0; i < PRIMARY_COUNT; i++) {
    const t = i / (PRIMARY_COUNT - 1);
    // Rooted along the outer panel, from just inboard of the wrist to its end.
    const at = WRIST_FRAC * 0.88 + (PANEL_END_FRAC - WRIST_FRAC * 0.88) * t;
    const x = span * at;
    // Seated on the panel's trailing half so the quills are covered by it.
    const rootY = THREE.MathUtils.lerp(trailingAt(at) * 1.35, leadingAt(at) * 0.3, t * 0.55);
    // Angle measured from straight back toward straight outboard. The innermost
    // primary trails mostly backward and each one after it swings further out,
    // which is what opens the gaps between the fingers.
    const theta = THREE.MathUtils.degToRad(28) + PRIMARY_SPLAY_RAD * t;
    const dir = new THREE.Vector2(Math.sin(theta), -Math.cos(theta));
    const len = chord * (1.24 - 0.28 * t);
    const z = seatZ + (i % 2 === 0 ? 0 : -1) * chord * FEATHER_SHINGLE_FRAC;
    parts.push(
      buildFlightFeatherGeometry({ root: [x, rootY, z], dir, length: len, halfWidth: chord * 0.16, tipFrac: 0.6 }),
    );
  }

  return curveWing(mergePositionOnlyGeometries(parts));
}

/**
 * One flight feather: a flat tapered vane with a blunt, squared-off tip.
 *
 * Real flight feathers do not come to a needle point, and modelling them that
 * way makes a wing read as a row of spikes — a mistake already corrected once
 * on the small bird's tail. `tipFrac` is the tip's width as a fraction of the
 * base, so the primaries can finish narrower than the secondaries without
 * either of them becoming a spike.
 */
export interface FlightFeatherParams {
  root: [number, number, number];
  /** Unit direction the vane runs in, in the XY plane, for a LEFT wing. */
  dir: THREE.Vector2;
  length: number;
  halfWidth: number;
  /** Tip width as a fraction of the base width. */
  tipFrac: number;
}

export function buildFlightFeatherGeometry({
  root,
  dir,
  length,
  halfWidth,
  tipFrac,
}: FlightFeatherParams): THREE.BufferGeometry {
  // `perp` must not be derived in a way that ignores handedness — on the parrot
  // and small bird, a perpendicular whose x did not track the wing's side made
  // the outline cross itself and notched a wedge out of every feather. Here the
  // whole wing is mirrored as a finished mesh, so `dir` is always left-wing.
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const steps = 5;
  const positions: number[] = [];
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Widest a third of the way out, tapering to `tipFrac` at the tip.
    const w = halfWidth * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(t * 1.5, 1))) * THREE.MathUtils.lerp(1, tipFrac, t * t);
    const cx = root[0] + dir.x * length * t;
    const cy = root[1] + dir.y * length * t;
    ring.push([cx + perp.x * w, cy + perp.y * w, root[2]]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = halfWidth * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(t * 1.5, 1))) * THREE.MathUtils.lerp(1, tipFrac, t * t);
    const cx = root[0] + dir.x * length * t;
    const cy = root[1] + dir.y * length * t;
    ring.push([cx - perp.x * w, cy - perp.y * w, root[2]]);
  }
  for (let i = 1; i < ring.length - 1; i++) {
    positions.push(...ring[0], ...ring[i], ...ring[i + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * A deeply hooked beak swept along a bent spine of shrinking circular
 * rings (rather than a small number of flat box segments, which read as
 * banded/faceted against a dark solid tint). Currently used by the hawk
 * (raptor beak); the parrot builds its own macaw beak inline. Kept here
 * as a reusable "hooked bird-of-prey/parrot beak" builder tuned via
 * length/curvature/flattening parameters — `maxAngleDeg` is how far the
 * tip curls downward from straight-forward (+Y).
 */
export function buildHookedBeakGeometry(
  faceY: number,
  faceRadius: number,
  beakLen: number,
  maxAngleDeg: number,
  flattenRatio: number = 0.85,
  capRoot: boolean = true,
): THREE.BufferGeometry {
  const spineSamples = 9;
  const angleSegments = 8;

  const spine: { y: number; z: number; radius: number }[] = [];
  let cursorY = faceY;
  let cursorZ = 0;
  const stepLen = beakLen / spineSamples;
  for (let i = 0; i <= spineSamples; i++) {
    const t = i / spineSamples;
    spine.push({ y: cursorY, z: cursorZ, radius: faceRadius * (1 - 0.85 * Math.pow(t, 1.8)) });
    if (i === spineSamples) break;
    const angleDeg = maxAngleDeg * Math.pow((i + 0.5) / spineSamples, 1.6);
    const rad = (angleDeg * Math.PI) / 180;
    cursorY += Math.cos(rad) * stepLen;
    cursorZ -= Math.sin(rad) * stepLen;
  }

  const rings: THREE.Vector3[][] = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < angleSegments; j++) {
      const angle = (j / angleSegments) * Math.PI * 2;
      const x = Math.cos(angle) * point.radius;
      const z = Math.sin(angle) * point.radius * flattenRatio;
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutwardTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, center: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const faceNormal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    if (faceNormal.dot(outward) < 0) pushTri(a, c, b);
    else pushTri(a, b, c);
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const ringA = rings[i];
    const ringB = rings[i + 1];
    const center = new THREE.Vector3(0, (spine[i].y + spine[i + 1].y) / 2, (spine[i].z + spine[i + 1].z) / 2);
    for (let j = 0; j < angleSegments; j++) {
      const k = (j + 1) % angleSegments;
      pushOutwardTri(ringA[j], ringA[k], ringB[j], center);
      pushOutwardTri(ringA[k], ringB[k], ringB[j], center);
    }
  }

  // Blunt cap at the hooked tip so it doesn't end in a bare hole.
  const tipIndex = spine.length - 1;
  const tipRing = rings[tipIndex];
  const tipCenter = new THREE.Vector3(0, spine[tipIndex].y, spine[tipIndex].z);
  const tipCapBehind = new THREE.Vector3(0, spine[tipIndex - 1].y, spine[tipIndex - 1].z);
  for (let j = 0; j < angleSegments; j++) {
    const k = (j + 1) % angleSegments;
    pushOutwardTri(tipCenter, tipRing[j], tipRing[k], tipCapBehind);
  }

  if (capRoot) {
    // Optional root cap: useful for standalone beaks, but can create a
    // visible circular seam on species that already blend/fill the beak
    // root with surrounding face geometry.
    const rootRing = rings[0];
    const rootCenter = new THREE.Vector3(0, spine[0].y, spine[0].z);
    const rootCapAhead = new THREE.Vector3(0, spine[1].y, spine[1].z);
    for (let j = 0; j < angleSegments; j++) {
      const k = (j + 1) % angleSegments;
      pushOutwardTri(rootCenter, rootRing[k], rootRing[j], rootCapAhead);
    }
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
 *
 * Options:
 *  - `halfWidth` overrides the default narrow songbird tail half-width
 *    (width * narrowScale * 0.36) — pass `width * 0.9` from hawkGeometry.ts
 *    to keep the predator's wide spread-eagle tail shape unchanged.
 *  - `narrowScale` matches the caller's own body-narrowing factor so the
 *    default tail half-width lines up with the body it trails (small birds
 *    pass their BODY_NARROW_SCALE); defaults to 1 when a `halfWidth` is
 *    supplied directly and the scale is irrelevant.
 *  - `gradient` bakes a root→tip vertex-color gradient; omit for a flat
 *    tail that takes its color from the per-instance body tint instead.
 */
export function buildTailGeometry(
  length: number,
  width: number,
  opts?: { halfWidth?: number; narrowScale?: number; gradient?: TailGradient; bodyLength?: number },
): THREE.BufferGeometry {
  const scaledWidth = width * (opts?.narrowScale ?? 1);
  const tw = opts?.halfWidth ?? scaledWidth * 0.36; // narrow songbird tail; hawk overrides to width*0.9
  const rootY = getBirdBodyRearTipY(opts?.bodyLength ?? length);
  const backCenterY = -length * 0.85;
  const sideTipT = 0.55 / 0.85;
  const sideTipY = THREE.MathUtils.lerp(rootY, backCenterY, sideTipT);
  const root       = new THREE.Vector3(0, rootY, 0);
  const leftTip    = new THREE.Vector3(-tw, sideTipY, 0);
  const rightTip   = new THREE.Vector3(tw, sideTipY, 0);
  const backCenter = new THREE.Vector3(0, backCenterY, 0);
  const thickness  = width * 0.05;

  const geo = extrudeRingGeometry([root, leftTip, backCenter, rightTip], thickness);

  if (opts?.gradient) {
    applyTailGradient(geo, opts.gradient);
  }

  return geo;
}

/**
 * Bakes a root-to-tip vertex-colour ramp down a tail, keyed on Y.
 *
 * Split out of buildTailGeometry so the fanned small-bird tail, which is built
 * from many separate feather solids rather than one kite, can share exactly the
 * same ramp — the per-species palettes and their tests are written against this
 * behaviour.
 */
export function applyTailGradient(geo: THREE.BufferGeometry, gradient: TailGradient): void {
  {
    const { root: rootColor, tip: tipColor, interpolation = 'rgb', rootHold = 0 } = gradient;
    // Y-axis root->tip gradient: max Y at the fan root, min Y at the rear tip.
    geo.computeBoundingBox();
    const gradientRootY = geo.boundingBox!.max.y;
    const gradientTipY = geo.boundingBox!.min.y;
    const ySpan = Math.max(1e-5, gradientRootY - gradientTipY);
    const hold = THREE.MathUtils.clamp(rootHold, 0, 0.95);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const rootHSL = { h: 0, s: 0, l: 0 };
    const tipHSL = { h: 0, s: 0, l: 0 };
    if (interpolation === 'hsl') {
      rootColor.getHSL(rootHSL);
      tipColor.getHSL(tipHSL);
    }
    for (let vi = 0; vi < pos.count; vi++) {
      const linearT = THREE.MathUtils.clamp((gradientRootY - pos.getY(vi)) / ySpan, 0, 1);
      const heldT = THREE.MathUtils.clamp((linearT - hold) / (1 - hold), 0, 1);
      const t = THREE.MathUtils.smoothstep(heldT, 0, 1);
      if (interpolation === 'hsl') {
        const color = new THREE.Color().setHSL(
          THREE.MathUtils.lerp(rootHSL.h, tipHSL.h, t),
          THREE.MathUtils.lerp(rootHSL.s, tipHSL.s, t),
          THREE.MathUtils.lerp(rootHSL.l, tipHSL.l, t),
        );
        colors[vi * 3] = color.r;
        colors[vi * 3 + 1] = color.g;
        colors[vi * 3 + 2] = color.b;
      } else {
        colors[vi * 3]     = THREE.MathUtils.lerp(rootColor.r, tipColor.r, t);
        colors[vi * 3 + 1] = THREE.MathUtils.lerp(rootColor.g, tipColor.g, t);
        colors[vi * 3 + 2] = THREE.MathUtils.lerp(rootColor.b, tipColor.b, t);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

/**
 * Two tucked legs, seated against the bird's actual belly.
 *
 * Every bird in this scene had hand-written its own copy of this, and every
 * copy carried the same two defects:
 *
 *   - The hip was a hard-coded constant with a comment recording the body
 *     radius it had been read off — `-scaledWidth * 0.240`, `-width * 0.242`,
 *     `-width * 0.08`. Those comments went stale the moment anyone reshaped a
 *     body, and nothing in the geometry or the tests noticed. Reworking the
 *     small bird left its legs buried inside its belly; deepening the hawk's
 *     keel swallowed its legs whole.
 *   - The two legs were placed at `±width * 0.001`, which is not a separation
 *     at all. Both were drawn on the centreline, one inside the other, so the
 *     bird flew with what looked like a single leg.
 *
 * So the hip is measured off the finished body here, and the caller has to say
 * how far apart the legs go. The measurement makes the legs track whatever the
 * profile does next, instead of having to be re-derived by hand every time.
 *
 * Returns an uncoloured geometry; callers apply their own plumage colour.
 */
export function buildTuckedBirdLegs({
  body,
  length,
  width,
  footY,
  legX,
  legRadius,
  toeLength,
  toeRadius,
  toeSpread,
  footDrop,
}: {
  /** The finished torso, so the hip can be measured rather than guessed. */
  body: THREE.BufferGeometry;
  length: number;
  width: number;
  /** Station along the spine. A bird's ankle sits well back toward the tail. */
  footY: number;
  /** Half the distance between the two legs. */
  legX: number;
  legRadius: number;
  toeLength: number;
  toeRadius: number;
  /** Lateral spread of the outer two forward toes. */
  toeSpread: number;
  /**
   * How far the foot hangs below the belly directly above it, in body lengths.
   *
   * Measured against the local belly rather than the lowest point of the whole
   * body. A bird's keel is deepest at the chest, well forward of its ankle, so
   * forcing the foot to clear the keel hangs it a long way below the belly it
   * actually attaches to — on the parrot that was 17 % of body width, and the
   * legs read as two pegs sticking out of its front rather than as feet tucked
   * up in flight.
   */
  footDrop: number;
}): THREE.BufferGeometry {
  const position = body.getAttribute('position') as THREE.BufferAttribute;
  const yBand = length * 0.05;
  const xBand = Math.max(width * 0.05, legX * 0.6);

  /** Depth of the belly surface directly above a given leg. */
  const bellyAt = (x: number) => {
    let z = 0;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getY(i) - footY) > yBand) continue;
      if (Math.abs(position.getX(i) - x) > xBand) continue;
      z = Math.min(z, position.getZ(i));
    }
    return z;
  };

  const footZ = Math.min(bellyAt(legX), bellyAt(-legX)) - length * footDrop;

  const buildLeg = (side: 1 | -1): THREE.BufferGeometry => {
    const x = side * legX;
    // The shank starts inside the belly rather than flush against it. The legs
    // are their own instanced part and swing on the tuck rig, so a joint that
    // only just touches opens into a gap as soon as it rotates.
    const hipZ = bellyAt(x) + width * 0.06;
    const shank = hipZ - footZ;
    const leg = new THREE.CylinderGeometry(legRadius * 0.85, legRadius, shank, 8);
    leg.rotateX(Math.PI / 2);
    leg.translate(x, footY, hipZ - shank * 0.5);

    const makeToe = (xOffset: number, yBias: number): THREE.BufferGeometry => {
      const toe = new THREE.ConeGeometry(toeRadius, toeLength, 5);
      toe.translate(x + xOffset, footY + yBias + toeLength * 0.45, footZ);
      return toe;
    };
    const toes = [
      makeToe(side * toeSpread, toeLength * 0.04),
      makeToe(0, toeLength * 0.1),
      makeToe(-side * toeSpread, toeLength * 0.04),
    ];
    // The hallux, pointing back the other way.
    const hallux = new THREE.ConeGeometry(toeRadius * 0.8, toeLength * 0.62, 5);
    hallux.rotateX(Math.PI);
    hallux.translate(x, footY - toeLength * 0.27, footZ + toeLength * 0.02);
    return mergePositionOnlyGeometries([leg, ...toes, hallux]);
  };

  return mergePositionOnlyGeometries([buildLeg(1), buildLeg(-1)]);
}
