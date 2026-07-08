import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import {
  buildEyeDotsGeometry,
  extrudeRingGeometry,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
} from '../../../geometry/creatureGeometry';

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
  const wingLeft = addUniformVertexColor(buildPectoralFinGeometry(length, width, 1), WHITE_VERTEX_COLOR);
  const wingRight = addUniformVertexColor(buildPectoralFinGeometry(length, width, -1), WHITE_VERTEX_COLOR);
  const tail = buildCurledTailGeometry(length, width);
  return { body, wingLeft, wingRight, tail };
}

const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
const HORN_COLOR = new THREE.Color(0xffd54a);
const EYE_COLOR = new THREE.Color(0x101014);

interface SpinePoint {
  y: number;
  z: number;
  radius: number;
  xScale?: number;
  zScale?: number;
}

function buildSeaHorseBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: shell, crestY, crestZ, crestRadius, eyeY, eyeZ, eyeRadius } = buildSeaHorseShellGeometry(length, width);
  const dorsalFin = buildDorsalFinGeometry(length, width);
  const ridge = buildBodyRidgeGeometry(length, width);
  const horn = buildSeaHorseHornGeometry(crestY, crestZ, crestRadius);
  const eyes = buildEyeDotsGeometry(width * 0.11, eyeY, eyeZ, eyeRadius);

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
    { y: halfLen * 0.145, z: length * 0.215, radius: width * 0.15, xScale: 0.42, zScale: 0.9 },
    { y: halfLen * 0.205, z: length * 0.195, radius: width * 0.125, xScale: 0.38, zScale: 0.82 },
    { y: halfLen * 0.28, z: length * 0.115, radius: width * 0.1, xScale: 0.32, zScale: 0.58 },
    { y: halfLen * 0.36, z: length * 0.025, radius: width * 0.072, xScale: 0.27, zScale: 0.42 },
  ];

  const geometry = buildSweptGeometry(spine, 12);
  const crest = spine[7];
  const cheek = spine[8];
  return {
    geometry,
    crestY: crest.y,
    crestZ: crest.z,
    crestRadius: crest.radius,
    eyeY: cheek.y,
    eyeZ: cheek.z + cheek.radius * (cheek.zScale ?? 1) * 0.15,
    eyeRadius: width * 0.035,
  };
}

function buildSeaHorseHornGeometry(crestY: number, crestZ: number, crestRadius: number): THREE.BufferGeometry {
  const hornLength = crestRadius * 1.7;
  const hornRadius = crestRadius * 0.34;
  const horn = new THREE.ConeGeometry(hornRadius, hornLength, 8);
  horn.rotateX(Math.PI / 2);
  horn.translate(0, crestY + crestRadius * 0.14, crestZ + crestRadius * 0.92 + hornLength * 0.5);
  return horn;
}

function buildDorsalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  const rootTop = new THREE.Vector3(0, -length * 0.015, length * 0.045);
  const rootBottom = new THREE.Vector3(0, -length * 0.055, -length * 0.16);
  const tip = new THREE.Vector3(0, -length * 0.18, -length * 0.015);
  return extrudeRingGeometry([rootTop, rootBottom, tip], width * 0.06);
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
  return extrudeRingGeometry([front, back, tip], thickness);
}

function buildPectoralFinGeometry(length: number, width: number, side: 1 | -1): THREE.BufferGeometry {
  const span = length * 0.16;
  // Root anchored to match spine[6] in buildSeaHorseShellGeometry (y=halfLen*0.1,
  // z=length*0.16) -- the shoulder/gill area where a seahorse's pectoral fins
  // actually sit. The previous z (length*0.11) sat well below the body's actual
  // curve at that y, so the fin floated in open space ahead of/below the body
  // instead of looking attached to it.
  const rootY = length * 0.05;
  const rootZ = length * 0.16;
  const ring = [
    new THREE.Vector3(0, rootY, rootZ),
    new THREE.Vector3(side * span * 0.45, rootY + length * 0.038, rootZ + width * 0.022),
    new THREE.Vector3(side * span, rootY + length * 0.005, rootZ + width * 0.018),
    new THREE.Vector3(side * span * 0.54, rootY - length * 0.07, rootZ - width * 0.025),
  ];
  return extrudeRingGeometry(ring, width * 0.04);
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
  }

  return buildTubeGeometry(path, radii, 8);
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

function buildTubeGeometry(path: THREE.Vector3[], radii: number[], sides: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
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
      pushTri(rings[i][s], rings[i + 1][s], rings[i + 1][next]);
      pushTri(rings[i][s], rings[i + 1][next], rings[i][next]);
    }
  }

  const startCenter = path[0];
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(startCenter, rings[0][next], rings[0][s]);
  }

  const endCenter = path[path.length - 1];
  const endRing = rings[rings.length - 1];
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(endCenter, endRing[s], endRing[next]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addUniformVertexColor(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
