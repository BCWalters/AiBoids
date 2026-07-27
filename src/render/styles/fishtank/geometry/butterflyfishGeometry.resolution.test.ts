import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createButterflyfishGeometries } from './butterflyfishGeometry';

/**
 * Resolution regression tests for the butterflyfish body mesh (issue #223).
 *
 * The body was previously lathed with 16 radial segments and 9 raw profile
 * control points, matching the faceted small-fish problem.  The fix applies
 * the same treatment: SplineCurve.getPoints(32) for longitudinal smoothness
 * and 24 radial segments.
 *
 * Falsification:
 *   - Drop segments back to 16 in buildButterflyfishBodyGeometry →
 *     vertex-count assertion fails ("Expected: >= 1500, Received: ~900")
 *   - Nudge the max-radius control point (width * 0.52) to width * 0.75 →
 *     max-X-radius upper-bound assertion fails
 */

const LENGTH = 1.0;
const WIDTH = 0.5;
const HALF_LEN = LENGTH * 0.5;

// Butterflyfish max lathe radius (control point: width * 0.52)
// after BODY_SIDE_SQUASH = 0.18.
// Expected max X ≈ 0.52 * 0.5 * 0.18 = 0.0468.
const BUTTERFLY_EXPECTED_MAX_X = WIDTH * 0.52 * 0.18;

const VERTEX_COUNT_FLOOR = 1500;

describe('butterflyfish body resolution', () => {
  let bb: THREE.Box3;
  let posCount: number;

  const setup = () => {
    const geoms = createButterflyfishGeometries(LENGTH, WIDTH);
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

  it('body Y extent matches tail-to-mouth profile span', () => {
    setup();
    // Peduncle tip at y = -halfLen * 1.0; mouth at y = +halfLen * 0.92.
    // Allow 5 % tolerance for spline sampling and merged non-body parts.
    expect(bb.min.y).toBeLessThanOrEqual(-HALF_LEN * 0.95);
    expect(bb.max.y).toBeGreaterThanOrEqual(HALF_LEN * 0.85);
  });

  it('max body X radius matches scaled profile maximum (shape did not widen)', () => {
    setup();
    // Allow ±20 % around expected (BODY_SIDE_SQUASH = 0.18 is very small, so
    // the absolute tolerance is narrow enough to catch a major nudge).
    // A nudged control point (e.g. width*0.75 instead of width*0.52) pushes
    // max X well outside the upper bound and causes this assertion to fail.
    expect(bb.max.x).toBeGreaterThan(BUTTERFLY_EXPECTED_MAX_X * 0.80);
    expect(bb.max.x).toBeLessThan(BUTTERFLY_EXPECTED_MAX_X * 1.20);
  });

  it('body contains vertical stripe colors (stripes bake correctly at new resolution)', () => {
    const geoms = createButterflyfishGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr).toBeTruthy();

    let hasLight = false;
    let hasDark = false;
    // White body color (0xffffff) → r=g=b=1
    // Dark stripe  (0x151210) → r≈0.082, g≈0.071, b≈0.063
    for (let i = 0; i < colorAttr.count; i++) {
      const r = colorAttr.getX(i);
      const g = colorAttr.getY(i);
      const b = colorAttr.getZ(i);
      if (r > 0.8 && g > 0.8 && b > 0.8) hasLight = true;
      if (r < 0.15 && g < 0.15 && b < 0.15) hasDark = true;
      if (hasLight && hasDark) break;
    }
    body.dispose();
    expect(hasLight).toBe(true);
    expect(hasDark).toBe(true);
  });
});
