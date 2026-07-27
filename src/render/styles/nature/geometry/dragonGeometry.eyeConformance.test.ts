import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries, EYE_STANDOFF_SCALE } from './dragonGeometry';

/**
 * Regression test for the dragon eye placement fix (issue #201 follow-up).
 *
 * The body geometry returned by createDragonGeometries merges the lathe body,
 * caps, frill, iris, pupil, and other face details into one BufferGeometry
 * with a per-vertex 'color' attribute. Vertices belonging to the iris are
 * colored 0xff9010 (orangish-yellow) and pupils are colored 0x040204
 * (near-black).
 *
 * ## Why analytical gap checks don't work here
 *
 * buildDragonBodyGeometry calls applyNeckBend on the merged geometry AFTER the
 * iris/pupil discs are built and merged in. applyNeckBend preserves the X
 * coordinate of every vertex but changes Y and Z. Because the profile-sampling
 * function dragonBodyRadiusAtY expects pre-bend Y coordinates, using a
 * post-bend vertex's (y, z) with the analytical formula sqrt(r(y)^2 - z^2)
 * gives wrong results.
 *
 * ## Ray-cast gap (correct in the bent coordinate system)
 *
 * applyNeckBend preserves X, which means both the eye disc vertices and their
 * nearest skull surface points move identically under the bend (same dY, dZ).
 * The gap in the +/-X direction is therefore exactly eyeStandoff before and
 * after bending. Casting a ray in the inward +/-X direction from each eye
 * vertex to the nearest white-body triangle gives the true gap without needing
 * to undo the bend.
 *
 * ## What is tested (two-sided gap band)
 *
 * For each iris/pupil vertex:
 *   gap > 0              (vertex is outside the skull, not sunk in)
 *   gap < standoff * 3   (vertex is not hovering far off the skull)
 *
 * Both bounds are required. A one-sided (gap > 0) test cannot distinguish a
 * correctly placed eye from one floating two units off the skull -- inflating
 * eyeStandoff 25x still passed the one-sided test.
 *
 * ## Sabotage verification (performed by the author before PR submission)
 *
 * The two-sided test correctly detects both failure modes:
 *
 * 1. Removing the sqrt conform -- setting X = r + standoff instead of
 *    sqrt(r^2 - z^2) + standoff so the disc intersects the skull at the brow
 *    ridge -- caused the max-gap assertion to fail for vertices at the top of
 *    the eye (gap ~5x standoff at the brow ridge, matching the reviewer's
 *    measurement in the PR comment).
 *
 * 2. Inflating eyeStandoff 25x (width * 0.30) -- eyes roughly two units clear
 *    of the skull -- caused the max-gap assertion to fail immediately for
 *    almost every vertex in both discs.
 *
 * 3. Zeroing out the standoff -- gap ~= 0 for all vertices -- caused the
 *    min-gap assertion to fail, as some vertices fell on or inside the body
 *    due to floating-point error.
 *
 * The old one-sided test passed all three sabotaged configurations.
 */

const LENGTH = 2.0;
const WIDTH  = 0.8;
const STANDOFF = WIDTH * EYE_STANDOFF_SCALE;

// Every gap assertion below is expressed as a multiple of STANDOFF, which is
// itself derived from EYE_STANDOFF_SCALE - so they all stay green no matter how
// the constant is retuned, including to a value that buries the eye flush in the
// skull or pushes it back out on a stalk. Anchor the constant to an absolute
// range so the relative bounds mean something. #201 asked for "flat with just a
// small bulge", so the eye must clear the skull but by only a few percent of the
// body width.
describe('dragon eye standoff constant', () => {
  it('keeps the eye proud of the skull but only slightly', () => {
    expect(EYE_STANDOFF_SCALE).toBeGreaterThan(0.004);
    expect(EYE_STANDOFF_SCALE).toBeLessThan(0.05);
  });
});

// ── Ray-triangle intersection (Moller-Trumbore), returns t ──────────────────

/**
 * Returns the ray parameter t of the intersection with the triangle
 * (a, b, c) from `origin` in direction `dir`, or null if there is no
 * intersection (degenerate triangles, parallel, missed, or behind origin).
 * t > 1e-6 so the origin itself is not counted.
 */
function rayTriangleT(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): number | null {
  const edge1 = new THREE.Vector3().subVectors(b, a);
  const edge2 = new THREE.Vector3().subVectors(c, a);
  const h = new THREE.Vector3().crossVectors(dir, edge2);
  const det = edge1.dot(h);
  if (Math.abs(det) < 1e-8) return null;
  const f = 1 / det;
  const s = new THREE.Vector3().subVectors(origin, a);
  const u = f * s.dot(h);
  if (u < 0 || u > 1) return null;
  const q = new THREE.Vector3().crossVectors(s, edge1);
  const v = f * dir.dot(q);
  if (v < 0 || u + v > 1) return null;
  const t = f * edge2.dot(q);
  return t > 1e-6 ? t : null;
}

/**
 * Returns the minimum ray distance from `origin` in direction `dir` to any
 * triangle in `bodyTris` (packed as 9 floats per triangle). Returns Infinity
 * if no intersection is found.
 *
 * applyNeckBend preserves X coordinates and rotates only Y and Z. Therefore
 * for an eye vertex at X = side * (surfaceX + standoff), casting a ray in the
 * inward +/-X direction hits the skull surface at distance exactly = standoff,
 * so this directly measures the true eye-to-skull gap in the bent geometry.
 */
function nearestBodyHit(origin: THREE.Vector3, dir: THREE.Vector3, bodyTris: Float32Array): number {
  let minT = Infinity;
  for (let i = 0; i < bodyTris.length; i += 9) {
    const a = new THREE.Vector3(bodyTris[i],     bodyTris[i + 1], bodyTris[i + 2]);
    const b = new THREE.Vector3(bodyTris[i + 3], bodyTris[i + 4], bodyTris[i + 5]);
    const c = new THREE.Vector3(bodyTris[i + 6], bodyTris[i + 7], bodyTris[i + 8]);
    const t = rayTriangleT(origin, dir, a, b, c);
    if (t !== null && t < minT) minT = t;
  }
  return minT;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Approximately white: R > 0.9, G > 0.9, B > 0.9. */
function isWhite(r: number, g: number, b: number): boolean {
  return r > 0.9 && g > 0.9 && b > 0.9;
}

/**
 * Approximately the iris orange (0xff9010) in linear space:
 *   R ~= 1.0, G ~= 0.279, B ~= 0.005.
 * THREE.Color converts sRGB hex to linear, so these are the stored values.
 */
function isIrisOrange(r: number, g: number, b: number): boolean {
  return r > 0.9 && g > 0.1 && g < 0.5 && b < 0.01;
}

/**
 * Approximately the pupil near-black (0x040204) in linear space:
 *   R ~= 0.00121, G ~= 0.000607, B ~= 0.00121.
 * Kept well below the adjacent near-black shades (mouth lines 0x050205 at
 * R ~= 0.00152, nostrils 0x0a0508 at R ~= 0.00304) so only the actual pupil
 * vertices are tested for conformance.
 */
function isPupilBlack(r: number, g: number, b: number): boolean {
  return r < 0.00135 && g < 0.001 && b < 0.00135;
}

// ── Helpers to collect body/eye data from the merged geometry ────────────────

interface EyeData {
  bodyTris: Float32Array;
  irisVertices: THREE.Vector3[];
  pupilVertices: THREE.Vector3[];
}

function collectEyeData(body: THREE.BufferGeometry): EyeData {
  const posAttr   = body.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = body.getAttribute('color')    as THREE.BufferAttribute;

  const bodyPositions: number[] = [];
  const irisVertices: THREE.Vector3[] = [];
  const pupilVertices: THREE.Vector3[] = [];

  for (let tri = 0; tri < posAttr.count; tri += 3) {
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

  return { bodyTris: new Float32Array(bodyPositions), irisVertices, pupilVertices };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dragon eye conformance (#201 follow-up)', () => {
  it('every iris vertex gap is in band (> 0, < standoff * 3)', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const { bodyTris, irisVertices } = collectEyeData(geoms.body);

    expect(bodyTris.length).toBeGreaterThan(0);
    expect(irisVertices.length).toBeGreaterThan(0);

    for (const v of irisVertices) {
      // Cast inward along +/-X (the direction preserved by applyNeckBend)
      // toward the skull. Gap should be ~= eyeStandoff for all disc vertices.
      const inwardDir = new THREE.Vector3(v.x > 0 ? -1 : 1, 0, 0);
      const gap = nearestBodyHit(v, inwardDir, bodyTris);
      // Lower bound must be proportional to STANDOFF, not just > 0: an absolute
      // bound passes even when the eye is sunk to 5% of its standoff, which reads
      // as flush with the skull and defeats the point of the test.
      expect(gap).toBeGreaterThan(STANDOFF * 0.33);
      expect(gap).toBeLessThan(STANDOFF * 3);
    }
  });

  it('every pupil vertex gap is in band (> 0, < standoff * 3)', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const { bodyTris, pupilVertices } = collectEyeData(geoms.body);

    expect(bodyTris.length).toBeGreaterThan(0);
    expect(pupilVertices.length).toBeGreaterThan(0);

    for (const v of pupilVertices) {
      const inwardDir = new THREE.Vector3(v.x > 0 ? -1 : 1, 0, 0);
      const gap = nearestBodyHit(v, inwardDir, bodyTris);
      // Lower bound must be proportional to STANDOFF, not just > 0: an absolute
      // bound passes even when the eye is sunk to 5% of its standoff, which reads
      // as flush with the skull and defeats the point of the test.
      expect(gap).toBeGreaterThan(STANDOFF * 0.33);
      expect(gap).toBeLessThan(STANDOFF * 3);
    }
  });
});
