import * as THREE from 'three';

export interface BirdGeometries {
  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
}

/**
 * Builds a simple low-poly bird silhouette: an elongated diamond body
 * (nose pointing along local +Y, matching the orientation convention used
 * elsewhere in Renderer3D) plus a pair of flat, swept-back triangular
 * wings that extend sideways from the body's origin. Wings are separate
 * geometries (rather than baked into the body) so each can be given its
 * own per-instance flap rotation in the render loop.
 */
export function createBirdGeometries(length: number, width: number): BirdGeometries {
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
export function createRealisticBirdGeometries(length: number, width: number): BirdGeometries {
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
 */
function buildTaperedBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.04, -halfLen * 1.0), // tail tip
    new THREE.Vector2(width * 0.22, -halfLen * 0.7),
    new THREE.Vector2(width * 0.42, -halfLen * 0.25), // belly bulge
    new THREE.Vector2(width * 0.4, halfLen * 0.15), // chest
    new THREE.Vector2(width * 0.2, halfLen * 0.55), // neck taper
    new THREE.Vector2(width * 0.24, halfLen * 0.68), // head bulge
    new THREE.Vector2(width * 0.03, halfLen * 0.82), // beak tip
  ];
  return new THREE.LatheGeometry(profile, 10);
}

/**
 * A wing with a solid inner panel plus a fan of thin, separated triangular
 * "finger" feathers at the tip (rooted along the outer trailing edge, each
 * angled slightly differently) — the visual cue that reads as "wingtip
 * primary feathers" on a soaring bird of prey.
 */
function buildFingeredWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
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

  const fingerCount = 5;
  const innerAnchor = [mainSpan * 0.5 * s, -chord * 0.1, 0];
  const outerAnchor = tip;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const rootPt = lerp3(innerAnchor, outerAnchor, t);
    const rootPt2 = lerp3(innerAnchor, outerAnchor, Math.min(1, t + 0.22));
    const fingerLen = span * (0.3 + 0.12 * t);
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
 * A flat, fanned tail trailing behind the body (toward local -Y), built
 * from two mirrored triangles meeting at a rear center point — reads as a
 * spread tail fan from a distance. Static (does not flap).
 */
function buildTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const root = [0, 0, 0];
  const leftTip = [-width * 0.9, -length * 0.55, 0];
  const rightTip = [width * 0.9, -length * 0.55, 0];
  const backCenter = [0, -length * 0.85, 0];

  const positions = new Float32Array([...root, ...leftTip, ...backCenter, ...root, ...backCenter, ...rightTip]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * "Dragon" predator geometry: a bulkier, longer-necked lathed body, broad
 * scalloped bat/dragon-membrane wings (a single filled panel with a
 * clawed, concave trailing edge rather than the hawk's separated feather
 * "fingers" — dragons should read as leathery, not feathered), and a
 * long whip-like tail ending in a diamond spade. Deliberately much bigger
 * than the hawk predator geometry it replaces.
 */
export function createDragonGeometries(length: number, width: number): BirdGeometries {
  const body = buildDragonBodyGeometry(length, width);

  const wingSpan = length * 1.5;
  const wingChord = length * 0.85;
  const wingLeft = buildMembraneWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildMembraneWingGeometry(wingSpan, wingChord, -1);

  const tail = buildDragonTailGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}

/**
 * Radially-symmetric body profile with a longer, thicker neck and a
 * pronounced head/jaw bulge compared to the hawk body — reads as a
 * serpentine dragon torso rather than a plump bird chest.
 */
function buildDragonBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.03, -halfLen * 1.0), // tail root
    new THREE.Vector2(width * 0.16, -halfLen * 0.68),
    new THREE.Vector2(width * 0.36, -halfLen * 0.3), // haunch bulge
    new THREE.Vector2(width * 0.32, halfLen * 0.05), // chest
    new THREE.Vector2(width * 0.16, halfLen * 0.42), // long neck taper
    new THREE.Vector2(width * 0.13, halfLen * 0.62), // neck
    new THREE.Vector2(width * 0.24, halfLen * 0.76), // jaw/head bulge
    new THREE.Vector2(width * 0.02, halfLen * 0.95), // snout tip
  ];
  return new THREE.LatheGeometry(profile, 10);
}

/**
 * A single filled leathery wing panel (unlike the hawk's separated
 * feather fingers) spanning from a forearm leading edge out to a splayed
 * set of claw-tipped points, with concave scallops between each claw so
 * the trailing silhouette reads as taut membrane stretched between finger
 * bones — the classic bat/dragon wing look.
 */
function buildMembraneWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  const root: [number, number] = [0, chord * 0.15];
  const shoulder: [number, number] = [span * 0.18 * s, chord * 0.5];
  // Claw tip anchor points along the leading arc, each progressively
  // further out and lower (swept back), like bat finger bones fanning
  // out from the wrist.
  const claws: [number, number][] = [
    [span * 0.46 * s, chord * 0.38],
    [span * 0.72 * s, chord * 0.12],
    [span * 0.92 * s, -chord * 0.28],
    [span * 0.78 * s, -chord * 0.62],
  ];
  // Concave scallop points between claws — pulled in toward the body,
  // giving the trailing edge its taut, clawed-membrane droop.
  const scallops: [number, number][] = [
    [span * 0.58 * s, chord * 0.02],
    [span * 0.82 * s, -chord * 0.22],
    [span * 0.86 * s, -chord * 0.5],
  ];
  const wristAnchor: [number, number] = [span * 0.22 * s, -chord * 0.25];

  const to3 = (p: [number, number]): number[] => [p[0], p[1], 0];

  // Forearm leading panel.
  pushTri(to3(root), to3(shoulder), to3(claws[0]));
  pushTri(to3(root), to3(claws[0]), to3(wristAnchor));

  // Fan the membrane out through each claw/scallop pair.
  pushTri(to3(wristAnchor), to3(claws[0]), to3(scallops[0]));
  pushTri(to3(scallops[0]), to3(claws[0]), to3(claws[1]));
  pushTri(to3(wristAnchor), to3(scallops[0]), to3(scallops[1]));
  pushTri(to3(scallops[0]), to3(claws[1]), to3(scallops[1]));
  pushTri(to3(scallops[1]), to3(claws[1]), to3(claws[2]));
  pushTri(to3(wristAnchor), to3(scallops[1]), to3(scallops[2]));
  pushTri(to3(scallops[1]), to3(claws[2]), to3(scallops[2]));
  pushTri(to3(scallops[2]), to3(claws[2]), to3(claws[3]));
  pushTri(to3(wristAnchor), to3(scallops[2]), to3(claws[3]));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A long, tapering whip tail (much longer than the hawk's fanned tail)
 * ending in a flat diamond-shaped spade, trailing behind the body toward
 * local -Y.
 */
function buildDragonTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const root = [0, 0, 0];
  const midLeft = [-width * 0.22, -length * 0.55, 0];
  const midRight = [width * 0.22, -length * 0.55, 0];
  const midPoint = [0, -length * 0.55, 0];
  const spadeLeft = [-width * 0.55, -length * 1.15, 0];
  const spadeRight = [width * 0.55, -length * 1.15, 0];
  const spadeTip = [0, -length * 1.5, 0];

  const positions = new Float32Array([
    ...root,
    ...midLeft,
    ...midPoint,
    ...root,
    ...midPoint,
    ...midRight,
    ...midLeft,
    ...spadeLeft,
    ...midPoint,
    ...midPoint,
    ...spadeLeft,
    ...spadeTip,
    ...midPoint,
    ...spadeTip,
    ...spadeRight,
    ...midRight,
    ...midPoint,
    ...spadeRight,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
