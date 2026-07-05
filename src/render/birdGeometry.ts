import * as THREE from 'three';

export interface BirdGeometries {
  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /** Dragon-only: a pair of clawed legs tucked under the belly, rendered
   * with the same static per-instance transform as the body (no flap). */
  legs?: THREE.BufferGeometry;
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
 * "fingers" — dragons should read as leathery, not feathered), a long
 * spiny/whip-like reptile tail (no forked "swallow tail" fan, which read
 * too bird-like), and a pair of clawed legs tucked under the belly.
 * Deliberately much bigger than the hawk predator geometry it replaces.
 */
export function createDragonGeometries(length: number, width: number): BirdGeometries {
  const body = buildDragonBodyGeometry(length, width);

  const wingSpan = length * 1.5;
  const wingChord = length * 0.85;
  const wingLeft = buildMembraneWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildMembraneWingGeometry(wingSpan, wingChord, -1);

  const tail = buildDragonTailGeometry(length, width);
  const legs = buildDragonLegsGeometry(length, width);

  return { body, wingLeft, wingRight, tail, legs };
}

/**
 * Radially-symmetric body profile with a longer, thicker neck than the
 * hawk body — reads as a serpentine dragon torso rather than a plump
 * bird chest. Proportions are deliberately bulkier (wider haunch/chest
 * radii) than the hawk's. The head narrows into a distinctly elongated,
 * crocodile-like snout (rather than a round bird-head bulge), and a pair
 * of backswept horns is merged on afterward (see buildDragonHeadHorns)
 * since a lathe alone can't produce asymmetric brow horns.
 */
function buildDragonBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.04, -halfLen * 1.0), // tail root
    new THREE.Vector2(width * 0.24, -halfLen * 0.68),
    new THREE.Vector2(width * 0.52, -halfLen * 0.32), // haunch bulge (bulkier than hawk)
    new THREE.Vector2(width * 0.46, halfLen * 0.02), // chest
    new THREE.Vector2(width * 0.26, halfLen * 0.28), // neck taper start
    new THREE.Vector2(width * 0.16, halfLen * 0.46), // slim serpentine neck (less bird-like than before)
    new THREE.Vector2(width * 0.2, halfLen * 0.56), // jaw hinge / back-of-skull bulge
    new THREE.Vector2(width * 0.25, halfLen * 0.65), // brow ridge (horns attach here)
    new THREE.Vector2(width * 0.12, halfLen * 0.78), // snout base — narrows sharply, no round head bulge
    new THREE.Vector2(width * 0.06, halfLen * 0.92), // snout mid
    new THREE.Vector2(width * 0.01, halfLen * 1.08), // elongated snout tip, past the body's nominal length
  ];
  const latheGeometry = new THREE.LatheGeometry(profile, 12);
  const hornsGeometry = buildDragonHeadHornsGeometry(length, width, halfLen * 0.66);
  const merged = mergePositionOnlyGeometries([latheGeometry, hornsGeometry]);
  latheGeometry.dispose();
  hornsGeometry.dispose();
  return merged;
}

/**
 * A minimal geometry merge that only cares about vertex positions
 * (adequate here since these are flat-colored MeshStandardMaterials with
 * no texture maps) — avoids THREE's stricter mergeGeometries(), which
 * requires every input geometry to share identical attribute sets
 * (position/normal/uv) and indexed-vs-non-indexed status, neither of
 * which line up between a LatheGeometry and a hand-authored triangle
 * soup. Recomputes normals fresh on the combined result.
 */
function mergePositionOnlyGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = nonIndexed.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.computeVertexNormals();
  return merged;
}

/**
 * A pair of small backswept brow horns, one on each side of the head —
 * the single detail that most reads as "dragon" rather than "bird",
 * since the lathed body profile alone is radially symmetric and can't
 * produce asymmetric features like this. Swept toward local -Y (back,
 * toward the tail) and +Z (dorsal, matching the tail spines' "+Z = back"
 * convention) so they lay back along the skull rather than poking
 * straight up like antennae.
 */
function buildDragonHeadHornsGeometry(length: number, width: number, headY: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const hornLen = length * 0.24;
  const hornBaseWidth = width * 0.09;

  function buildHorn(sideX: number) {
    const base = [sideX, headY, width * 0.08];
    const baseFwd = [sideX * 0.7, headY + length * 0.05, width * 0.02];
    const baseBack = [sideX * 1.1, headY - length * 0.05, width * 0.1];
    const tip = [sideX * 1.6, headY - hornLen * 0.7, width * 0.1 + hornLen * 0.85];
    pushTri(base, baseBack, tip);
    pushTri(baseFwd, base, tip);
    pushTri(baseBack, baseFwd, tip);
    // thin base cap so the horn doesn't look like a knife-edge from the side
    pushTri(baseFwd, baseBack, base);
  }

  buildHorn(width * 0.22 + hornBaseWidth);
  buildHorn(-(width * 0.22 + hornBaseWidth));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A single filled leathery wing panel (unlike the hawk's separated
 * feather fingers), rooted near the front third of the body like a real
 * bat/dragon forearm rather than mid-body, with a broader chord (less
 * "spindly dragonfly wing", more "broad membrane"). The leading edge runs
 * straight from the shoulder to a sharp wrist joint — rather than
 * bulging outward in a smooth curve like a bird's leading edge — and a
 * small hooked "thumb claw" juts forward from the wrist, the single most
 * recognizable bat/dragon-wing cue. From the wrist, four finger bones
 * fan out to claw tips with concave scallops between them so the
 * trailing silhouette reads as taut membrane stretched between finger
 * bones.
 */
function buildMembraneWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  const root: [number, number] = [0, chord * 0.2];
  // Wrist joint: a sharp corner rather than a rounded shoulder bulge, so
  // the leading edge reads as two straight bone segments (root->wrist,
  // wrist->thumb) instead of a smooth bird-wing curve.
  const wrist: [number, number] = [span * 0.3 * s, chord * 0.48];
  // Thumb claw: hooks forward and slightly further out from the wrist —
  // the classic dragon/bat "hand hook" silhouette.
  const thumbClaw: [number, number] = [span * 0.22 * s, chord * 0.74];
  // Finger/claw tip anchor points fanning out from the wrist, each
  // progressively further out and lower (swept back).
  const claws: [number, number][] = [
    [span * 0.46 * s, chord * 0.36],
    [span * 0.66 * s, chord * 0.06],
    [span * 0.8 * s, -chord * 0.3],
    [span * 0.66 * s, -chord * 0.6],
  ];
  // Concave scallop points between claws — pulled in toward the body,
  // giving the trailing edge its taut, clawed-membrane droop.
  const scallops: [number, number][] = [
    [span * 0.54 * s, chord * 0.0],
    [span * 0.72 * s, -chord * 0.24],
    [span * 0.72 * s, -chord * 0.5],
  ];
  const wristAnchor: [number, number] = [span * 0.28 * s, -chord * 0.2];

  const to3 = (p: [number, number]): number[] => [p[0], p[1], 0];

  // Forearm leading panel: straight root->wrist edge, then the thumb
  // claw's forward hook, then down into the wrist anchor.
  pushTri(to3(root), to3(wrist), to3(thumbClaw));
  pushTri(to3(root), to3(thumbClaw), to3(wristAnchor));
  pushTri(to3(thumbClaw), to3(wrist), to3(claws[0]));
  pushTri(to3(thumbClaw), to3(claws[0]), to3(wristAnchor));

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
 * A long, tapering whip tail — NOT the hawk-style forked/fanned "swallow
 * tail" (which reads too bird-like on a creature this size) — instead a
 * single continuous ribbon narrowing smoothly to a sharp spike tip, with
 * a row of small triangular dorsal spines running down its length for a
 * stegosaurus-esque reptile silhouette. Thicker at the root than a bird
 * tail so it doesn't read as a thin insect abdomen.
 */
function buildDragonTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  // Ribbon segments: each entry is [halfWidth, yOffset] walking from the
  // body root out to the tip, narrowing the whole way.
  const segments: [number, number][] = [
    [width * 0.34, 0],
    [width * 0.24, -length * 0.55],
    [width * 0.15, -length * 1.05],
    [width * 0.08, -length * 1.45],
    [width * 0.0, -length * 1.75], // spike tip, zero-width
  ];

  for (let i = 0; i < segments.length - 1; i++) {
    const [hw0, y0] = segments[i];
    const [hw1, y1] = segments[i + 1];
    const left0 = [-hw0, y0, 0];
    const right0 = [hw0, y0, 0];
    const left1 = [-hw1, y1, 0];
    const right1 = [hw1, y1, 0];
    pushTri(left0, left1, right1);
    pushTri(left0, right1, right0);
  }

  // Small dorsal spines standing proud of the ribbon plane (local +Z),
  // shrinking toward the tip — the tail's answer to the body's
  // horn/frill spike, reinforcing a reptilian rather than avian read.
  const spineCount = 4;
  for (let i = 0; i < spineCount; i++) {
    const t = i / spineCount;
    const y = -length * (0.25 + t * 1.15);
    const spineHeight = length * (0.22 - t * 0.14);
    const spineWidth = width * (0.1 - t * 0.05);
    const base = [0, y, 0];
    const baseBack = [0, y - length * 0.08, 0];
    const tip = [0, y - length * 0.03, spineHeight];
    pushTri(base, baseBack, tip);
    // Give the spine a sliver of thickness (two side faces) so it isn't
    // a perfectly edge-on invisible triangle from some viewing angles.
    const tipLeft = [-spineWidth * 0.3, y - length * 0.03, spineHeight * 0.85];
    const tipRight = [spineWidth * 0.3, y - length * 0.03, spineHeight * 0.85];
    pushTri(base, tipLeft, tip);
    pushTri(base, tip, tipRight);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A pair of stubby, clawed legs tucked under the belly — one pair near
 * the chest, one pair near the haunch — the single biggest visual cue
 * that separates "dragon" from "large bird/bat", which have no visible
 * legs in flight. Purely static (shares the body's transform, no flap).
 * Built along local -Z ("belly-down", perpendicular to the wing/tail
 * plane at Z=0) so the legs read as hanging beneath the body rather than
 * overlapping the wings.
 */
function buildDragonLegsGeometry(length: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  function buildLeg(hipX: number, hipY: number) {
    const thighLen = length * 0.22;
    const shinLen = length * 0.2;
    const hip = [hipX, hipY, 0];
    // Bend the knee backward (thigh sweeps toward the tail) then swing the
    // shin forward again toward/past the hip — a proper knee-bend "Z"
    // silhouette in the Y/Z (front-back / up-down) plane, instead of the
    // old hip->knee->foot chain which barely diverged and read as one
    // straight rigid rod hanging under the belly, even mid-flight.
    const knee = [hipX * 1.15, hipY - length * 0.09, -thighLen];
    const foot = [hipX * 1.05, knee[1] + length * 0.12, -(thighLen + shinLen)];
    const legWidth = width * 0.1;

    // Thigh + shin as two thin tapering quads (a simple bent leg silhouette).
    const hipL = [hip[0] - legWidth, hip[1], hip[2]];
    const hipR = [hip[0] + legWidth, hip[1], hip[2]];
    const kneeL = [knee[0] - legWidth * 0.7, knee[1], knee[2]];
    const kneeR = [knee[0] + legWidth * 0.7, knee[1], knee[2]];
    const footL = [foot[0] - legWidth * 0.5, foot[1], foot[2]];
    const footR = [foot[0] + legWidth * 0.5, foot[1], foot[2]];
    pushTri(hipL, kneeL, kneeR);
    pushTri(hipL, kneeR, hipR);
    pushTri(kneeL, footL, footR);
    pushTri(kneeL, footR, kneeR);

    // A small fan of three claw talons splayed from the foot.
    const clawLen = length * 0.14;
    const clawSpread = [
      [-1, 0.3],
      [0, 1],
      [1, 0.3],
    ];
    for (const [spreadX, spreadForward] of clawSpread) {
      const clawTip = [
        foot[0] + spreadX * width * 0.16,
        foot[1] + spreadForward * clawLen * 0.4,
        foot[2] - clawLen,
      ];
      const clawBaseL = [foot[0] - legWidth * 0.4, foot[1], foot[2]];
      const clawBaseR = [foot[0] + legWidth * 0.4, foot[1], foot[2]];
      pushTri(clawBaseL, clawTip, clawBaseR);
    }
  }

  const frontY = length * 0.05; // near the chest
  const backY = -length * 0.32; // near the haunch
  const stanceX = width * 0.3;

  buildLeg(-stanceX, frontY);
  buildLeg(stanceX, frontY);
  buildLeg(-stanceX, backY);
  buildLeg(stanceX, backY);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
