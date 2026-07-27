import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from './dragonGeometry';

/**
 * Regression test for the dragon snout-cap fix (issues #202).
 *
 * The body geometry returned by createDragonGeometries merges a LatheGeometry,
 * a snout-cap disc, a dorsal frill, and face detail parts into a single
 * BufferGeometry.  The lathe profile's snout-tip ring has a non-zero radius
 * (width * 0.015), so without the cap the end is an open ring — a see-through
 * hole when viewed straight on.  The cap is a double-sided disc whose triangles
 * share a centre vertex at (0, snoutTipY, 0) before the neck-bend transform.
 *
 * applyNeckBend only modifies Y and Z coordinates (it rotates in the Y-Z
 * plane), so X = 0 for the cap centre vertex survives the bend unchanged.
 * The lathe ring at the snout tip has all vertices at non-zero X
 * (X = radius * cos θ ≠ 0 for the tiny but non-zero snout-tip radius).
 * Therefore: if the body geometry contains a vertex with X ≈ 0 near the
 * top of its bounding box, the cap is present.
 */

const LENGTH = 2.0;
const WIDTH = 0.8;

describe('dragon snout cap', () => {
  it('has no open boundary at the snout tip (cap centre vertex present)', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const maxY = bb.max.y;
    const yRange = maxY - bb.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;

    // Search for a vertex with |X| < ε that sits in the top 6% of the
    // geometry's Y extent.  The cap's centre vertex satisfies both conditions;
    // lathe ring vertices at the snout tip do not (their X = ±radius > 0).
    // Dorsal frill vertices are at X = 0 but well below this Y threshold.
    let foundCapCentreVertex = false;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y > maxY - yRange * 0.06) {
        if (Math.abs(posAttr.getX(i)) < 1e-4) {
          foundCapCentreVertex = true;
          break;
        }
      }
    }

    expect(foundCapCentreVertex).toBe(true);
  });

  it('snout-tip region contains more than just a thin ring (cap fills the hole)', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const maxY = bb.max.y;
    const yRange = maxY - bb.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;

    // Collect all vertices near the snout tip.
    let ringOnlyCount = 0; // vertices at non-zero X (lathe ring only)
    let centreCount = 0;   // vertices at X ≈ 0 (cap centre triangles)

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y > maxY - yRange * 0.06) {
        if (Math.abs(posAttr.getX(i)) < 1e-4) {
          centreCount++;
        } else {
          ringOnlyCount++;
        }
      }
    }

    // Without the cap the centre count would be 0; with it, each double-sided
    // wedge contributes the centre point twice (once per winding), so with 16
    // segments we expect at least 32 centre-vertex entries.
    expect(centreCount).toBeGreaterThanOrEqual(32);
    // The ring vertices (from both the lathe and the cap rim) should also be present.
    expect(ringOnlyCount).toBeGreaterThan(0);
  });
});
