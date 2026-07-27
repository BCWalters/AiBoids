import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHawkGeometries } from './hawkGeometry';

/**
 * Regression tests for the hawk tail-cap fix (issue #196, defect 2).
 *
 * The hawk body is a LatheGeometry that leaves an open ring at its tail tip
 * (minimum Y of the merged body). Without a cap, this ring reads as a
 * transparent hole when viewed from behind.
 *
 * The fix follows the same approach as the small-bird tail-cap fix (see
 * smallBirdGeometry.tailCap.test.ts): a double-sided disc is merged into the
 * body geometry at the tail-tip Y, colored to match the back plumage
 * (TORSO_COLOR = 0x2a2018).
 *
 * We verify the cap by:
 *  1. Finding the minimum Y (tail tip) of the merged body geometry.
 *  2. Checking that there are vertices at that Y covering a spread of angles —
 *     a single open ring has no vertices at Y_min (only the ring edge), but a
 *     filled disc cap places vertices at Y_min at many radii and angles
 *     including the center (x=0, z=0).
 *  3. Checking that the color of cap vertices matches the expected torso color.
 */

const LENGTH = 1.0;
const WIDTH = 0.5;
const TORSO_COLOR = new THREE.Color(0x2a2018);

describe('hawk tail-cap fix', () => {
  it('body geometry has vertices at the tail-tip Y (disc cap is present)', () => {
    const geoms = createHawkGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    const tailTipVertices: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getY(i) - minY) < 1e-4) {
        tailTipVertices.push({ x: posAttr.getX(i), z: posAttr.getZ(i) });
      }
    }

    // A capped tail has many vertices at minY (center + ring points).
    // An uncapped lathe has no vertices *exactly* at its end ring Y (the
    // open ring edge is shared with the adjacent face, not a standalone point).
    expect(tailTipVertices.length).toBeGreaterThan(10);
  });

  it('tail-cap disc contains a vertex at the center (x≈0, z≈0, y=minY)', () => {
    const geoms = createHawkGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    let hasCenterVertex = false;
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getY(i) - minY) < 1e-4) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        if (Math.abs(x) < 1e-4 && Math.abs(z) < 1e-4) {
          hasCenterVertex = true;
          break;
        }
      }
    }
    // A filled disc has wedge triangles all sharing a center vertex at (0, y, 0).
    expect(hasCenterVertex).toBe(true);
  });

  it('tail-cap vertices are colored to match the torso back plumage', () => {
    const geoms = createHawkGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;

    // Only inspect center vertices (x≈0, z≈0) to isolate the disc-cap color,
    // not the lathe edge ring.
    for (let i = 0; i < posAttr.count; i++) {
      if (
        Math.abs(posAttr.getY(i) - minY) < 1e-4 &&
        Math.abs(posAttr.getX(i)) < 1e-4 &&
        Math.abs(posAttr.getZ(i)) < 1e-4
      ) {
        const r = colorAttr.getX(i);
        const g = colorAttr.getY(i);
        const b = colorAttr.getZ(i);
        // Should be close to TORSO_COLOR (0x2a2018) — dark blackish-brown.
        expect(r).toBeCloseTo(TORSO_COLOR.r, 1);
        expect(g).toBeCloseTo(TORSO_COLOR.g, 1);
        expect(b).toBeCloseTo(TORSO_COLOR.b, 1);
      }
    }
  });

  it('tail-cap vertices are NOT white (the old transparent-hole appearance)', () => {
    const geoms = createHawkGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getY(i) - minY) < 1e-4) {
        const r = colorAttr.getX(i);
        const g = colorAttr.getY(i);
        const b = colorAttr.getZ(i);
        // None of the tail-cap vertices should be neutral white (r,g,b ≥ 0.99).
        expect(r < 0.99 || g < 0.99 || b < 0.99).toBe(true);
      }
    }
  });
});
