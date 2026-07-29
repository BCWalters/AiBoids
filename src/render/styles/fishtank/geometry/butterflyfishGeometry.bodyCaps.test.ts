import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createButterflyfishGeometries } from './butterflyfishGeometry';

/**
 * Concern: the butterflyfish body lathe is built from a profile whose first and
 * last control points sit at a non-zero radius (width * 0.03), so THREE leaves
 * an open ring at each end. Unsealed, those read as see-through holes into the
 * hollow body — and because the body is squashed to 0.18 in X, the nose hole is
 * most of what a head-on camera sees (issue #316).
 *
 * The guard is topological rather than visual: a hole is exactly a run of edges
 * used by a single triangle. Counting those at the two end Y values catches the
 * regression whatever its cause — a removed cap, a profile edited to a new
 * radius, or a cap merged after the squash so it no longer lines up.
 */

/** Edges used by exactly one triangle — i.e. the mesh's open boundary. */
function boundaryEdgeYs(geometry: THREE.BufferGeometry): number[] {
  const position = geometry.attributes.position;
  // Weld by position first. A lathe duplicates its seam column so the two
  // halves can carry different UVs; by index those edges look like a boundary,
  // by position they are plainly interior. Snapping −0 to 0 matters here:
  // sin(2π) is −2.4e-16, so the seam misses an exact-string weld.
  const quantise = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e5) / 1e5);
  const idByKey = new Map<string, number>();
  const canonical: number[] = [];
  for (let v = 0; v < position.count; v++) {
    const key = `${quantise(position.getX(v))},${quantise(position.getY(v))},${quantise(position.getZ(v))}`;
    if (!idByKey.has(key)) idByKey.set(key, idByKey.size);
    canonical.push(idByKey.get(key)!);
  }

  const indices = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i);

  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const useCount = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [canonical[indices[i]], canonical[indices[i + 1]], canonical[indices[i + 2]]];
    for (const [a, b] of [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ]) {
      const key = edgeKey(a, b);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
    }
  }

  const yByKey = new Map([...idByKey].map(([key, id]) => [id, Number(key.split(',')[1])]));
  const ys: number[] = [];
  for (const [key, count] of useCount) {
    if (count !== 1) continue;
    for (const vertex of key.split('_')) ys.push(yByKey.get(Number(vertex))!);
  }
  return ys;
}

describe('butterflyfish body caps', () => {
  const LENGTH = 1.0;
  const WIDTH = 1.0;
  const HALF_LEN = LENGTH * 0.5;

  // The lathe profile's two extreme control points, which are where the open
  // rings appear. Kept as fractions of halfLen so the test reads against the
  // authored profile rather than against magic numbers.
  const RUMP_Y = -HALF_LEN * 1.0;
  const NOSE_Y = HALF_LEN * 0.92;

  it('leaves no open ring at the rump or the nose', () => {
    const ys = boundaryEdgeYs(createButterflyfishGeometries(LENGTH, WIDTH).body);

    // A tolerance, not equality: the profile is spline-resampled, so the end
    // rings land near — not exactly on — the authored control points.
    const near = (target: number) => ys.filter((y) => Math.abs(y - target) < HALF_LEN * 0.02);

    expect(near(RUMP_Y)).toHaveLength(0);
    expect(near(NOSE_Y)).toHaveLength(0);
  });

  it('caps inherit the body squash instead of staying circular', () => {
    // Capping after the scale would leave a round disc on an elliptical body,
    // standing proud of a flank only 0.18 as thick as it is tall. Measuring the
    // body's X extent at the nose catches that: it must match the squashed
    // radius, not the raw one.
    const geometry = createButterflyfishGeometries(LENGTH, WIDTH).body;
    const position = geometry.attributes.position;

    let maxXNearNose = 0;
    for (let v = 0; v < position.count; v++) {
      if (Math.abs(position.getY(v) - NOSE_Y) > HALF_LEN * 0.02) continue;
      maxXNearNose = Math.max(maxXNearNose, Math.abs(position.getX(v)));
    }

    // Unsquashed the nose ring radius is WIDTH * 0.03; squashed it is 0.18 of
    // that. Anything near the unsquashed value means the cap missed the scale.
    expect(maxXNearNose).toBeLessThan(WIDTH * 0.03 * 0.5);
  });
});
