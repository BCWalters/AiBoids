import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from './dragonGeometry';

/**
 * Regression test for the dragon eye placement fix (issue #201 follow-up).
 *
 * The body geometry returned by createDragonGeometries merges the lathe body,
 * caps, frill, iris, pupil, and other face details into one BufferGeometry
 * with a per-vertex 'color' attribute. Vertices belonging to the iris are
 * colored 0xff9010 (orangish-yellow) and pupils are colored 0x040204
 * (near-black).
 *
 * Before the fix, each iris/pupil disc was placed at a constant X offset
 * (width * 0.23), but the skull's radius varies across the eye's Y footprint
 * and reaches up to width * 0.28 near the brow ridge — so the centre of the
 * disc (the widest part of the skull) was buried ~0.47 units inside the head,
 * making the pupil largely invisible.
 *
 * After the fix, each disc vertex's X is derived from the body-profile radius
 * at that vertex's own Y, so every iris and pupil vertex sits outside the
 * skull by exactly the standoff distance.  This test enforces that invariant
 * by:
 *   1. Splitting the merged geometry into "body" triangles (white, R ≈ 1) and
 *      "eye" vertices (iris orange, pupil near-black).
 *   2. Running a ray-parity containment check (Möller–Trumbore) from each eye
 *      vertex in the +X direction against the white-body triangle soup.
 *   3. Asserting that no iris or pupil vertex is inside the body.
 */

const LENGTH = 2.0;
const WIDTH  = 0.8;

// ── Ray-triangle intersection (Möller–Trumbore) ────────────────────────────

function rayHitsTriangle(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): boolean {
  const edge1 = new THREE.Vector3().subVectors(b, a);
  const edge2 = new THREE.Vector3().subVectors(c, a);
  const h = new THREE.Vector3().crossVectors(dir, edge2);
  const det = edge1.dot(h);
  if (Math.abs(det) < 1e-8) return false;
  const f = 1 / det;
  const s = new THREE.Vector3().subVectors(origin, a);
  const u = f * s.dot(h);
  if (u < 0 || u > 1) return false;
  const q = new THREE.Vector3().crossVectors(s, edge1);
  const v = f * dir.dot(q);
  if (v < 0 || u + v > 1) return false;
  const t = f * edge2.dot(q);
  return t > 1e-6; // intersection in the positive ray direction only
}

function countRayBodyHits(origin: THREE.Vector3, dir: THREE.Vector3, bodyTris: Float32Array): number {
  let hits = 0;
  for (let i = 0; i < bodyTris.length; i += 9) {
    const a = new THREE.Vector3(bodyTris[i],     bodyTris[i + 1], bodyTris[i + 2]);
    const b = new THREE.Vector3(bodyTris[i + 3], bodyTris[i + 4], bodyTris[i + 5]);
    const c = new THREE.Vector3(bodyTris[i + 6], bodyTris[i + 7], bodyTris[i + 8]);
    if (rayHitsTriangle(origin, dir, a, b, c)) hits++;
  }
  return hits;
}

/** Returns true if the point is inside the triangle-soup mesh (odd parity). */
function isInsideBody(point: THREE.Vector3, bodyTris: Float32Array): boolean {
  // Test in both +X and -X to guard against grazing/boundary cases.
  const posX = countRayBodyHits(point, new THREE.Vector3(1,  0, 0), bodyTris) % 2;
  const negX = countRayBodyHits(point, new THREE.Vector3(-1, 0, 0), bodyTris) % 2;
  // A point is inside only when BOTH ray directions agree.
  return posX === 1 && negX === 1;
}

// ── Helpers to extract body / eye vertices from the merged geometry ─────────

/** Approximately white: R > 0.9, G > 0.9, B > 0.9. */
function isWhite(r: number, g: number, b: number): boolean {
  return r > 0.9 && g > 0.9 && b > 0.9;
}

/**
 * Approximately the iris orange (0xff9010) in linear space:
 *   R ≈ 1.0, G ≈ 0.279, B ≈ 0.005.
 * THREE.Color converts sRGB hex to linear, so these are the stored values.
 */
function isIrisOrange(r: number, g: number, b: number): boolean {
  return r > 0.9 && g > 0.1 && g < 0.5 && b < 0.01;
}

/**
 * Approximately the pupil near-black (0x040204) in linear space:
 *   R ≈ 0.00121, G ≈ 0.000607, B ≈ 0.00121.
 * Kept well below the adjacent near-black shades (mouth lines 0x050205 at
 * R ≈ 0.00152, nostrils 0x0a0508 at R ≈ 0.00304) so only the actual pupil
 * vertices are tested for containment.
 */
function isPupilBlack(r: number, g: number, b: number): boolean {
  return r < 0.00135 && g < 0.001 && b < 0.00135;
}

describe('dragon eye conformance (#201 follow-up)', () => {
  it('no iris vertex lies inside the body', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;

    const posAttr   = body.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = body.getAttribute('color')    as THREE.BufferAttribute;

    // Collect white-body triangle positions and iris/pupil vertex positions.
    const bodyPositions: number[] = [];
    const irisVertices: THREE.Vector3[] = [];
    const pupilVertices: THREE.Vector3[] = [];

    // The merged geometry is non-indexed (mergeGeometriesWithColor calls
    // toNonIndexed), so vertices come in groups of 3 forming one triangle each.
    for (let tri = 0; tri < posAttr.count; tri += 3) {
      // Classify the triangle by its first vertex's color.
      const r0 = colorAttr.getX(tri), g0 = colorAttr.getY(tri), b0 = colorAttr.getZ(tri);

      if (isWhite(r0, g0, b0)) {
        for (let v = 0; v < 3; v++) {
          const i = tri + v;
          bodyPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
      } else if (isIrisOrange(r0, g0, b0)) {
        for (let v = 0; v < 3; v++) {
          const i = tri + v;
          irisVertices.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
        }
      } else if (isPupilBlack(r0, g0, b0)) {
        for (let v = 0; v < 3; v++) {
          const i = tri + v;
          pupilVertices.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
        }
      }
    }

    expect(bodyPositions.length).toBeGreaterThan(0);
    expect(irisVertices.length).toBeGreaterThan(0);
    expect(pupilVertices.length).toBeGreaterThan(0);

    const bodyTris = new Float32Array(bodyPositions);

    let irisInsideCount = 0;
    for (const v of irisVertices) {
      if (isInsideBody(v, bodyTris)) irisInsideCount++;
    }
    expect(irisInsideCount).toBe(0);
  });

  it('no pupil vertex lies inside the body', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;

    const posAttr   = body.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = body.getAttribute('color')    as THREE.BufferAttribute;

    const bodyPositions: number[] = [];
    const pupilVertices: THREE.Vector3[] = [];

    for (let tri = 0; tri < posAttr.count; tri += 3) {
      const r0 = colorAttr.getX(tri), g0 = colorAttr.getY(tri), b0 = colorAttr.getZ(tri);
      if (isWhite(r0, g0, b0)) {
        for (let v = 0; v < 3; v++) {
          const i = tri + v;
          bodyPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
      } else if (isPupilBlack(r0, g0, b0)) {
        for (let v = 0; v < 3; v++) {
          const i = tri + v;
          pupilVertices.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
        }
      }
    }

    const bodyTris = new Float32Array(bodyPositions);

    let pupilInsideCount = 0;
    for (const v of pupilVertices) {
      if (isInsideBody(v, bodyTris)) pupilInsideCount++;
    }
    expect(pupilInsideCount).toBe(0);
  });
});
