import * as THREE from 'three';
import type { CreatureGeometries } from './creatureGeometry';
import { mergeGeometriesWithColor } from './creatureGeometry';
import { buildFingeredWingGeometry } from './birdGeometry';

/**
 * Parrot-specific geometry — split out from the shared "realistic bird"
 * builder (birdGeometry.ts, still used by hawks/sparrows/goldfinch/
 * cardinal/bluejay) so a macaw-style silhouette (large curved hooked
 * beak, compact rounded body, long trailing tail streamers) can be
 * iterated on independently without touching the small-songbird shape.
 * Reuses buildFingeredWingGeometry from birdGeometry.ts since fanned
 * primary feathers read fine on a parrot wing too — only the body/beak/
 * tail need a genuinely different shape.
 */

// Beaks read as dark gray/black on virtually every parrot species — baked
// as a per-vertex tint (multiplied against whatever bright per-instance
// body color a given macaw color-pattern uses, see Renderer3D's
// getParrotColors) rather than left the same white-vertex default as the
// rest of the body.
const BEAK_COLOR = new THREE.Color(0x2b2620);
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);

export function createParrotGeometries(length: number, width: number): CreatureGeometries {
  const body = buildParrotBodyGeometry(length, width);

  // Parrots have proportionally broader wings than a soaring hawk (built
  // for short powerful flaps through canopy, not long glides) — chord
  // widened modestly relative to the shared hawk builder, but not so much
  // that a single wing panel dwarfs the body.
  const wingSpan = length * 1.1;
  const wingChord = length * 0.62;
  const wingLeft = buildFingeredWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildFingeredWingGeometry(wingSpan, wingChord, -1);

  const tail = buildParrotTailGeometry(length, width);

  return { body, wingLeft, wingRight, tail };
}

/**
 * Compact, rounded lathed torso (parrots read as chunkier/rounder than a
 * lean hawk) topped with a large head, plus a separately-built curved
 * hooked beak merged on — a lathe alone can't produce the beak's
 * asymmetric downward hook, so it's authored as a small bent box-section
 * shape (same technique as the unicorn's legs/tail — see
 * buildParrotBeakGeometry) and merged with the torso.
 */
function buildParrotBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const profile = [
    new THREE.Vector2(width * 0.05, -halfLen * 0.95), // tail-root taper
    new THREE.Vector2(width * 0.28, -halfLen * 0.6),
    new THREE.Vector2(width * 0.46, -halfLen * 0.15), // belly bulge, rounder than a hawk's
    new THREE.Vector2(width * 0.44, halfLen * 0.2), // chest
    new THREE.Vector2(width * 0.34, halfLen * 0.45), // short thick neck
    new THREE.Vector2(width * 0.4, halfLen * 0.62), // rounded head
    new THREE.Vector2(width * 0.16, halfLen * 0.72), // face, just behind the beak
  ];
  const torso = new THREE.LatheGeometry(profile, 12);

  const beak = buildParrotBeakGeometry(length, width, halfLen * 0.72);

  return mergeGeometriesWithColor([
    { geometry: torso, color: WHITE_VERTEX_COLOR },
    { geometry: beak, color: BEAK_COLOR },
  ]);
}

/**
 * A short, deep, sharply hooked beak built from three tapering box-
 * section segments (same pushBoxSegment pattern used for the unicorn's
 * legs/tail — a proven, robust way to get a real 3D volume that reads
 * correctly from every camera angle, unlike a lathe or a flat ribbon):
 * the first segment angles gently forward-and-down from the face, the
 * second curves down more steeply, and the third hooks sharply back
 * under itself to a blunt point — the single biggest visual cue that
 * distinguishes a macaw/parrot silhouette from a hawk's straight,
 * shallow beak.
 */
function buildParrotBeakGeometry(length: number, width: number, faceY: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  function pushBoxSegment(a: THREE.Vector3, b: THREE.Vector3, halfX: number, halfY: number, capStart: boolean, capEnd: boolean) {
    const corner = (p: THREE.Vector3, sx: number, sy: number) => new THREE.Vector3(p.x + sx * halfX, p.y, p.z + sy * halfY);
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const ca = signs.map(([sx, sy]) => corner(a, sx, sy));
    const cb = signs.map(([sx, sy]) => corner(b, sx, sy));
    const axisCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const normal = new THREE.Vector3().crossVectors(e1, e2);
      const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
      const outward = new THREE.Vector3().subVectors(centroid, axisCenter);
      if (normal.dot(outward) < 0) pushTri(p0, p2, p1);
      else pushTri(p0, p1, p2);
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pushOutward(ca[i], cb[i], cb[j]);
      pushOutward(ca[i], cb[j], ca[j]);
    }
    if (capStart) {
      pushOutward(ca[0], ca[1], ca[2]);
      pushOutward(ca[0], ca[2], ca[3]);
    }
    if (capEnd) {
      pushOutward(cb[0], cb[1], cb[2]);
      pushOutward(cb[0], cb[2], cb[3]);
    }
  }

  // Angle measured from straight forward (+Y), rotating toward -Z (down);
  // past 90deg the direction starts pointing back toward the face again
  // — that's the "hook".
  function segOffset(angleDeg: number, segLength: number): THREE.Vector3 {
    const rad = (angleDeg * Math.PI) / 180;
    return new THREE.Vector3(0, Math.cos(rad) * segLength, -Math.sin(rad) * segLength);
  }

  const beakLen = length * 0.16;
  const face = new THREE.Vector3(0, faceY, 0);

  const seg1Len = beakLen * 0.4;
  const seg2Len = beakLen * 0.35;
  const seg3Len = beakLen * 0.25;

  const p1 = face.clone().add(segOffset(20, seg1Len));
  const p2 = p1.clone().add(segOffset(60, seg2Len));
  const p3 = p2.clone().add(segOffset(115, seg3Len));

  const baseHalf = width * 0.085;
  pushBoxSegment(face, p1, baseHalf, baseHalf * 0.8, true, false);
  pushBoxSegment(p1, p2, baseHalf * 0.7, baseHalf * 0.6, false, false);
  pushBoxSegment(p2, p3, baseHalf * 0.4, baseHalf * 0.35, false, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Long trailing tail: a handful of narrow elongated streamer feathers of
 * slightly varying length (macaws famously have very long tail feathers,
 * unlike the short fanned tail on the shared hawk/songbird builder).
 * Each streamer is a double-sided flat ribbon (two mirrored-winding
 * triangles) so it doesn't vanish from the back-facing side.
 */
function buildParrotTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const streamerCount = 3;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);

  for (let i = 0; i < streamerCount; i++) {
    const t = i / (streamerCount - 1);
    const xOffset = (t - 0.5) * width * 0.55;
    // Central streamer trails longest, outer ones progressively shorter —
    // long, but not as long as the whole body (a full-body-length streamer
    // read as an oversized blob rather than a slender trailing feather).
    const centerBias = 1 - Math.abs(t - 0.5) * 2;
    const streamerLen = length * (0.42 + 0.22 * centerBias);
    const halfWidth = width * 0.035;

    const root = [xOffset - halfWidth, -length * 0.42, 0];
    const root2 = [xOffset + halfWidth, -length * 0.42, 0];
    const tip = [xOffset, -length * 0.42 - streamerLen, -length * 0.1];

    pushTri(root, root2, tip);
    pushTri(root2, root, tip);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
