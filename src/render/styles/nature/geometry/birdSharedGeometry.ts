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
 * Root→tip gradient colours for a tail fan. Kept as a tiny standalone
 * interface (rather than taking the small-bird SmallBirdPalette) so this
 * shared helper has no dependency back on any one species' palette type.
 */
export interface TailGradient {
  root: THREE.Color;
  tip: THREE.Color;
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
 *  - `gradient` bakes a root→tip vertex-colour gradient; omit for a flat
 *    tail that takes its colour from the per-instance body tint instead.
 */
export function buildTailGeometry(
  length: number,
  width: number,
  opts?: { halfWidth?: number; narrowScale?: number; gradient?: TailGradient },
): THREE.BufferGeometry {
  const scaledWidth = width * (opts?.narrowScale ?? 1);
  const tw = opts?.halfWidth ?? scaledWidth * 0.36; // narrow songbird tail; hawk overrides to width*0.9
  const root       = new THREE.Vector3(0, 0, 0);
  const leftTip    = new THREE.Vector3(-tw, -length * 0.55, 0);
  const rightTip   = new THREE.Vector3(tw, -length * 0.55, 0);
  const backCenter = new THREE.Vector3(0, -length * 0.85, 0);
  const thickness  = width * 0.05;

  const geo = extrudeRingGeometry([root, leftTip, backCenter, rightTip], thickness);

  if (opts?.gradient) {
    const { root: rootColor, tip: tipColor } = opts.gradient;
    // Y-axis root→tip gradient: root is at Y=0, tip at the lowest Y value.
    geo.computeBoundingBox();
    const minY = geo.boundingBox!.min.y;
    const ySpan = Math.max(1e-5, Math.abs(minY));
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let vi = 0; vi < pos.count; vi++) {
      const t = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp((-pos.getY(vi)) / ySpan, 0, 1),
        0.05,
        0.95,
      );
      colors[vi * 3]     = THREE.MathUtils.lerp(rootColor.r, tipColor.r, t);
      colors[vi * 3 + 1] = THREE.MathUtils.lerp(rootColor.g, tipColor.g, t);
      colors[vi * 3 + 2] = THREE.MathUtils.lerp(rootColor.b, tipColor.b, t);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  return geo;
}
