import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createParrotGeometries } from './parrotGeometry';
import { createRealisticBirdGeometries } from './smallBirdGeometry';

/**
 * A bird's two wings must be exact reflections of each other, in shape and in
 * colour. This is not automatic: both wings used to be built by the same
 * parameterised function with a `side: 1 | -1` factor multiplied through every
 * x coordinate, and that quietly produced two different meshes.
 *
 * Negating x reverses triangle winding. Helpers that re-derive winding from a
 * centroid test or a signed area correct themselves; plain triangle lists do
 * not. So one wing ended up with its normals flipped over part of its surface
 * and not the rest, and the plumage pass — which reads the sign of a normal to
 * tell the topside palette from the underside one — painted the two wings
 * differently. Seen head-on, the parrot showed pale flight feathers on one
 * wing and dark green ones on the other. Separately, a feather's outline was
 * built from a perpendicular whose x component did not depend on the side, so
 * on one wing the outline crossed itself and notched a wedge out of every
 * feather.
 *
 * Both defects were invisible to the rest of the suite, which never compared
 * the two wings against each other. These tests do exactly that.
 */

const quantise = (value: number) => Math.round(value * 1e4) / 1e4;
const positionKey = (attr: THREE.BufferAttribute, i: number, flipX: boolean) =>
  `${quantise(flipX ? -attr.getX(i) : attr.getX(i))}|${quantise(attr.getY(i))}|${quantise(attr.getZ(i))}`;

/**
 * Index the left wing by position. Several vertices can share a position — a
 * feather root sits on the panel it grows from, for example — and coincident
 * vertices legitimately carry different colours, so each key holds every
 * candidate and a right-wing vertex counts as matching if any one agrees.
 */
function indexByPosition(wing: THREE.BufferGeometry) {
  const position = wing.getAttribute('position') as THREE.BufferAttribute;
  const colour = wing.getAttribute('color') as THREE.BufferAttribute | undefined;
  const byPosition = new Map<string, number[][]>();
  for (let i = 0; i < position.count; i++) {
    const key = positionKey(position, i, false);
    let bucket = byPosition.get(key);
    if (!bucket) byPosition.set(key, (bucket = []));
    bucket.push(colour ? [colour.getX(i), colour.getY(i), colour.getZ(i)] : []);
  }
  return byPosition;
}

/**
 * Total area of every triangle in a wing.
 *
 * Comparing vertex positions alone is not enough: the self-intersecting
 * feather outline reused the same corner points and only changed how they were
 * joined up, so the two wings had identical vertex sets while one of them
 * rendered with a wedge cut out of every feather. Summed triangle area does
 * see that, because a crossed outline triangulates into a different set of
 * triangles.
 */
function totalTriangleArea(wing: THREE.BufferGeometry): number {
  const position = wing.getAttribute('position') as THREE.BufferAttribute;
  let total = 0;
  for (let i = 0; i + 2 < position.count; i += 3) {
    const ax = position.getX(i + 1) - position.getX(i);
    const ay = position.getY(i + 1) - position.getY(i);
    const az = position.getZ(i + 1) - position.getZ(i);
    const bx = position.getX(i + 2) - position.getX(i);
    const by = position.getY(i + 2) - position.getY(i);
    const bz = position.getZ(i + 2) - position.getZ(i);
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    total += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return total;
}

function measureMirror(left: THREE.BufferGeometry, right: THREE.BufferGeometry) {
  const byPosition = indexByPosition(left);
  const rightPosition = right.getAttribute('position') as THREE.BufferAttribute;
  const rightColour = right.getAttribute('color') as THREE.BufferAttribute | undefined;

  let unmatchedPositions = 0;
  let mismatchedColours = 0;
  let worstColourDelta = 0;
  for (let i = 0; i < rightPosition.count; i++) {
    const candidates = byPosition.get(positionKey(rightPosition, i, true));
    if (!candidates) {
      unmatchedPositions++;
      continue;
    }
    if (!rightColour) continue;
    let best = Infinity;
    for (const candidate of candidates) {
      best = Math.min(
        best,
        Math.max(
          Math.abs(candidate[0] - rightColour.getX(i)),
          Math.abs(candidate[1] - rightColour.getY(i)),
          Math.abs(candidate[2] - rightColour.getZ(i)),
        ),
      );
    }
    worstColourDelta = Math.max(worstColourDelta, best);
    if (best > 0.02) mismatchedColours++;
  }
  const leftArea = totalTriangleArea(left);
  const rightArea = totalTriangleArea(right);
  return {
    vertexCount: rightPosition.count,
    unmatchedPositions,
    mismatchedColours,
    worstColourDelta,
    leftArea,
    areaDelta: Math.abs(leftArea - rightArea) / leftArea,
  };
}

describe('wing mirror symmetry', () => {
  it('gives the parrot two wings that are exact reflections in shape and plumage', () => {
    const geometries = createParrotGeometries(9.1, 6.24, 'green-focus');
    const result = measureMirror(geometries.wingLeft, geometries.wingRight);

    // Guard against the assertions passing on an empty or trivial wing.
    expect(result.vertexCount).toBeGreaterThan(5000);
    expect(result.unmatchedPositions).toBe(0);
    // The bug painted whole feather groups a different colour; the observed
    // discrepancy was 0.571 in linear RGB across 3296 vertices.
    expect(result.mismatchedColours).toBe(0);
    expect(result.worstColourDelta).toBeLessThanOrEqual(0.02);
    expect(result.leftArea).toBeGreaterThan(0);
    expect(result.areaDelta).toBeLessThanOrEqual(1e-6);
  });

  it('gives the small bird two wings that are exact reflections in shape', () => {
    const geometries = createRealisticBirdGeometries(3.2, 2.2);
    const result = measureMirror(geometries.wingLeft, geometries.wingRight);

    expect(result.vertexCount).toBeGreaterThan(2000);
    expect(result.unmatchedPositions).toBe(0);
    expect(result.leftArea).toBeGreaterThan(0);
    expect(result.areaDelta).toBeLessThanOrEqual(1e-6);
  });
});
