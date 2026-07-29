import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The ground plane's segment count is the largest single geometry decision in
 * the nature scene, so it gets pinned rather than left to drift.
 *
 * Measured on device (iPhone 13, 184 creatures): nature submitted 87,969
 * triangles per frame against fishtank's 1,807, and ran at ~21fps versus
 * ~50fps. 80,000 of those triangles — 91% of the scene — were this one mesh
 * at 200x200 segments. Neither a lower pixel ratio (`?dpr=1`, 2.25x fewer
 * fragments) nor disabling every optional effect changed the frame time,
 * which is what identifies the cost as vertex throughput: it is independent
 * of both resolution and shading.
 *
 * `createGroundGeometry` reads the tier at call time, so these cases stub the
 * environment and re-import, matching graphicsQuality.test.ts.
 */

async function loadTerrainFor({ mobile }: { mobile: boolean }) {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { search: '' },
    innerWidth: mobile ? 390 : 1440,
    innerHeight: mobile ? 664 : 900,
    matchMedia: (query: string) => ({ matches: mobile && query.includes('coarse') }),
  });
  return import('./terrain');
}

/** PlaneGeometry(w, h, s, s) triangulates to two triangles per grid cell. */
function triangleCount(geometry: { index: { count: number } | null }): number {
  return geometry.index!.count / 3;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createGroundGeometry level of detail', () => {
  it('keeps the dense grid on desktop', async () => {
    const { createGroundGeometry } = await loadTerrainFor({ mobile: false });
    expect(triangleCount(createGroundGeometry())).toBe(200 * 200 * 2);
  });

  it('cuts the grid down substantially on a phone', async () => {
    const { createGroundGeometry } = await loadTerrainFor({ mobile: true });
    const mobileTriangles = triangleCount(createGroundGeometry());

    // The exact figure is a tuning decision, but the reduction has to be a
    // real one — a token trim would not repay the visual cost, and this mesh
    // is the whole reason the scene was vertex-bound.
    expect(mobileTriangles).toBeLessThan(200 * 200 * 2 / 4);
    // ...and still enough grid to resolve rolling hills rather than a few
    // large facets.
    expect(mobileTriangles).toBeGreaterThan(2000);
  });

  it('displaces the phone terrain as much as the desktop terrain', async () => {
    // The point is fewer, larger facets — not flatter ground. If the coarser
    // grid also lost its height range the hills would quietly disappear,
    // which no triangle count would reveal.
    const heightRange = async (mobile: boolean) => {
      const { createGroundGeometry } = await loadTerrainFor({ mobile });
      const position = createGroundGeometry().attributes.position;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const z = position.getZ(i);
        if (z < min) min = z;
        if (z > max) max = z;
      }
      return max - min;
    };

    const desktopRange = await heightRange(false);
    const mobileRange = await heightRange(true);
    expect(mobileRange).toBeGreaterThan(desktopRange * 0.7);
  });
});
