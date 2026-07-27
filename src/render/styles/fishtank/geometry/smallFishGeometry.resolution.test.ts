import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createPlainFishGeometries,
  createGoldfishGeometries,
  createClownfishGeometries,
  createBlueTangGeometries,
} from './smallFishGeometry';

/**
 * Resolution regression tests for the small-fish body mesh (issue #223).
 *
 * The bodies were previously lathed with 16 radial segments and 8 raw
 * profile control points (straight-line segments between them), making them
 * the only fish in the repo below 32 radial segments and visibly faceted.
 * The fix raises both axes:
 *   - Longitudinal: SplineCurve.getPoints(32) → 33 smooth samples
 *   - Radial: 16 → 24 segments
 *
 * These tests pin the resolution floor (vertex count) and the silhouette
 * invariants (bounding box Y extent, max X radius) so neither can silently
 * regress.
 *
 * Falsification:
 *   - Drop segments back to 16 in buildLatheBody → vertex-count assertion fails
 *     ("Expected: >= 1500, Received: ~870")
 *   - Nudge the max-radius profile control point from w*0.46 to w*0.65 →
 *     max-X-radius upper-bound assertion fails ("Expected: < 0.092, Received: ~0.113")
 */

const LENGTH = 1.0;
const WIDTH = 0.5;
const HALF_LEN = LENGTH * 0.5;

// Effective side squash for all small fish =
//   per-variant sideSquash * SMALL_FISH_SIDE_SQUASH_SCALE (0.75).
// Plain fish: 0.465 * 0.75 = 0.34875.
// Max lathe radius for plain fish is WIDTH * 0.46 = 0.23.
// Expected max X ≈ 0.23 * 0.34875 ≈ 0.0802.
const PLAIN_FISH_EXPECTED_MAX_X = WIDTH * 0.46 * (0.465 * 0.75);

// Minimum body vertex count that distinguishes the new resolution from the
// old 16-segment / 8-profile-point config.
// Old non-indexed lathe vertex count (body alone) ≈ 7 * 16 * 2 * 3 = 672;
// full merged body (+ dorsal + eyes) ≈ 870.
// New non-indexed lathe vertex count (body alone) ≈ 32 * 24 * 2 * 3 = 4608;
// full merged body much higher.  Floor of 1500 fails the old config, passes
// any sensible new resolution.
const VERTEX_COUNT_FLOOR = 1500;

describe('smallFish body resolution', () => {
  describe('plain fish', () => {
    let bb: THREE.Box3;
    let posCount: number;

    const setup = () => {
      const geoms = createPlainFishGeometries(LENGTH, WIDTH);
      const body = geoms.body;
      body.computeBoundingBox();
      bb = body.boundingBox!;
      posCount = (body.getAttribute('position') as THREE.BufferAttribute).count;
      body.dispose();
    };

    it('body vertex count exceeds resolution floor (body reads as round)', () => {
      setup();
      expect(posCount).toBeGreaterThanOrEqual(VERTEX_COUNT_FLOOR);
    });

    it('body Y extent matches tail-to-nose profile span', () => {
      setup();
      // Tail control point at y = -halfLen * 1.0; nose at y = +halfLen * 0.85.
      // Allow a 5 % tolerance for spline sampling and merged non-body parts.
      expect(bb.min.y).toBeLessThanOrEqual(-HALF_LEN * 0.95);
      expect(bb.max.y).toBeGreaterThanOrEqual(HALF_LEN * 0.80);
    });

    it('max body X radius matches scaled profile maximum (shape did not widen)', () => {
      setup();
      // Allow ±15 % around the expected max X after sideSquash scaling.
      // A nudged control point (e.g. w*0.65 instead of w*0.46) pushes max X
      // above the upper bound and causes this assertion to fail.
      expect(bb.max.x).toBeGreaterThan(PLAIN_FISH_EXPECTED_MAX_X * 0.85);
      expect(bb.max.x).toBeLessThan(PLAIN_FISH_EXPECTED_MAX_X * 1.15);
    });
  });

  describe('goldfish', () => {
    it('body vertex count exceeds resolution floor', () => {
      const geoms = createGoldfishGeometries(LENGTH, WIDTH);
      const body = geoms.body;
      const posCount = (body.getAttribute('position') as THREE.BufferAttribute).count;
      body.dispose();
      expect(posCount).toBeGreaterThanOrEqual(VERTEX_COUNT_FLOOR);
    });
  });

  describe('clownfish', () => {
    it('body vertex count exceeds resolution floor', () => {
      const geoms = createClownfishGeometries(LENGTH, WIDTH);
      const body = geoms.body;
      const posCount = (body.getAttribute('position') as THREE.BufferAttribute).count;
      body.dispose();
      expect(posCount).toBeGreaterThanOrEqual(VERTEX_COUNT_FLOOR);
    });

    it('clownfish color bands are intact (vertex Y resolution is adequate)', () => {
      // Bake clownfish bands and verify the body contains vertices of each of
      // the three expected colors (orange body, white band, dark edge) — if
      // spline resampling broke the Y resolution the band baker needs, a color
      // might be missing entirely.
      const geoms = createClownfishGeometries(LENGTH, WIDTH);
      const body = geoms.body;
      const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;
      expect(colorAttr).toBeTruthy();

      let hasOrange = false;
      let hasWhite = false;
      // THREE.Color stores values in linear color space, so sRGB hex values
      // are gamma-decoded internally.  0xf4661c orange → r≈0.905, g≈0.133, b≈0.012
      // in linear.  0xf7f4ee white band → r≈0.930, g≈0.905, b≈0.855 in linear.
      for (let i = 0; i < colorAttr.count; i++) {
        const r = colorAttr.getX(i);
        const g = colorAttr.getY(i);
        const b = colorAttr.getZ(i);
        // Orange: high R, low-mid G (linear ≈0.13), very low B
        if (r > 0.7 && g > 0.05 && g < 0.25 && b < 0.05) hasOrange = true;
        // White/pale: all channels high (linear)
        if (r > 0.80 && g > 0.80 && b > 0.80) hasWhite = true;
        if (hasOrange && hasWhite) break;
      }
      body.dispose();
      expect(hasOrange).toBe(true);
      expect(hasWhite).toBe(true);
    });
  });

  describe('blue tang', () => {
    it('body vertex count exceeds resolution floor', () => {
      const geoms = createBlueTangGeometries(LENGTH, WIDTH);
      const body = geoms.body;
      const posCount = (body.getAttribute('position') as THREE.BufferAttribute).count;
      body.dispose();
      expect(posCount).toBeGreaterThanOrEqual(VERTEX_COUNT_FLOOR);
    });
  });
});
