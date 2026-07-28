import * as THREE from 'three';
import { extrudeRingGeometry } from '../../../geometry/sharedGeometry';

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
 * Wing panel with a broad, rounded tip.
 *
 * Previously this built a narrow main triangle plus a fan of long "finger"
 * primaries radiating past it. Those fingers converged to needle points and
 * read as spindly rather than feathered — issue #256: "they shouldn't have
 * this part at all... it should end before it gets super narrow."
 *
 * The wing now ends in a finite, rounded tip chord instead of tapering to a
 * point. Overall span is deliberately unchanged (the outermost vertex still
 * sits at 1.0 x span, exactly where the longest finger used to reach), so the
 * flight silhouette and the flap lever arm are preserved — only the outer
 * profile changes from spikes to a solid rounded edge.
 *
 * The outline is a closed polygon in the XY plane triangulated as a fan from
 * the root, which is also the flap pivot, so the root must stay at the origin.
 *
 * @param broadTip - Hawk/eagle mode: a wider, blunter tip with more chord left
 *   at the outer edge, for a soaring raptor. Default false gives the unicorn's
 *   more swept pegasus wing. Span and chord are identical in both modes.
 */
export function buildFingeredWingGeometry(span: number, chord: number, side: 1 | -1, broadTip: boolean = false): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  // Outer profile control. The broad (hawk) wing keeps noticeably more chord
  // at the tip; the swept (unicorn) wing narrows more but still terminates on
  // a finite edge rather than a point.
  const tipChord = broadTip ? 0.30 : 0.20;
  const tipRounding = broadTip ? 0.055 : 0.035;

  // Closed outline, leading edge outward then trailing edge back to the root.
  // Y is chord-wise (+ leading, - trailing); X is spanwise, mirrored by `s`.
  const outline: number[][] = [
    [0, 0, 0],
    [span * 0.42 * s, chord * 0.42, 0],
    [span * 0.78 * s, chord * 0.26, 0],
    // Rounded tip: three closely spaced vertices instead of a single apex, so
    // the silhouette curves over rather than coming to a spike.
    [span * (0.96 - tipRounding) * s, chord * 0.12, 0],
    [span * 1.0 * s, chord * (0.12 - tipChord * 0.5), 0],
    [span * (0.96 - tipRounding) * s, chord * (0.12 - tipChord), 0],
    [span * 0.74 * s, -chord * 0.34, 0],
    [span * 0.40 * s, -chord * 0.44, 0],
  ];

  // Fan from the root vertex. Winding is mirrored with `s` so both wings face
  // the same way; the wing material is DoubleSide regardless.
  for (let i = 1; i < outline.length - 1; i++) {
    if (s > 0) pushTri(outline[0], outline[i], outline[i + 1]);
    else pushTri(outline[0], outline[i + 1], outline[i]);
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
    const { root: rootColor, tip: tipColor, interpolation = 'rgb', rootHold = 0 } = opts.gradient;
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

  return geo;
}
