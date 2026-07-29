import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Pins the mobile geometry tier for creatures, which is where the nature
 * scene's cost actually lives.
 *
 * A scene-graph walk at iPhone 13 metrics measured 2,562,376 triangles per
 * frame in nature against 375,092 in fishtank, with the same 184 creatures —
 * and nature ran at ~21fps to fishtank's ~50. Almost all of it was creature
 * geometry: bodies at 4,320 triangles each and wing panels at 3,096, before
 * instancing across 30-60 birds per species. The ground plane, the obvious
 * suspect and the first thing tried, was ~10,000 of it.
 *
 * The cost is vertex-bound, which is what made it hard to see: `?dpr=1` cuts
 * fragments by 2.25x and changed nothing, and disabling every optional effect
 * moved ~2fps. Neither touches vertex throughput.
 *
 * These cases stub the environment and re-import, because the tier is read at
 * module-evaluation time (see graphicsQuality.test.ts).
 */

async function loadBirdGeometryFor({ mobile }: { mobile: boolean }) {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { search: '' },
    innerWidth: mobile ? 390 : 1440,
    innerHeight: mobile ? 664 : 900,
    matchMedia: (query: string) => ({ matches: mobile && query.includes('coarse') }),
  });
  return import('./smallBirdGeometry');
}

function triangleCountOf(geometry: {
  index: { count: number } | null;
  attributes: { position: { count: number } };
}): number {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

async function birdTriangles({
  mobile,
}: {
  mobile: boolean;
}): Promise<{ body: number; wing: number }> {
  const { createRealisticBirdGeometries } = await loadBirdGeometryFor({ mobile });
  const geometries = createRealisticBirdGeometries(1, 0.4) as never as {
    body: never;
    wingLeft: never;
  };
  return {
    body: triangleCountOf(geometries.body),
    wing: triangleCountOf(geometries.wingLeft),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('creature geometry level of detail', () => {
  it('builds substantially lighter bird bodies on a phone', async () => {
    const desktop = await birdTriangles({ mobile: false });
    const mobile = await birdTriangles({ mobile: true });

    // Small birds are the single largest contributor: this geometry is shared
    // by every songbird species, ~150 instances between them. A token trim
    // would not repay the visual cost.
    expect(mobile.body).toBeLessThan(desktop.body / 2);
    // ...but the body still has to read as a smooth lathe rather than a prism.
    // 896 today; the floor is set just under it, because dropping the lathe to
    // a handful of segments would halve the cost again and look like origami.
    expect(mobile.body).toBeGreaterThan(700);
  });

  it('trims the wing panels too, since undulation tessellates them', async () => {
    const desktop = await birdTriangles({ mobile: false });
    const mobile = await birdTriangles({ mobile: true });

    // Wings are subdivided into N^2 sub-triangles so a vertex shader has
    // interior vertices to bend, which makes the divisions figure quadratic
    // and by far the sharpest lever on the whole scene.
    expect(mobile.wing).toBeLessThan(desktop.wing / 2);
    // The panel still needs enough interior vertices to curve smoothly; too
    // few and the flap becomes a visible hinge. The wing carries ~522
    // triangles of fixed detail (feathers, coverts) regardless, so the floor
    // has to sit well above that to say anything about the panel itself:
    // 5 divisions gives 954, 3 gives 666, 1 gives 522.
    expect(mobile.wing).toBeGreaterThan(700);
  });

  it('leaves desktop geometry at full detail', async () => {
    // The phone tier must not silently become everyone's tier — the whole
    // point is that desktop keeps the fidelity that was tuned by eye.
    const desktop = await birdTriangles({ mobile: false });
    expect(desktop.body).toBeGreaterThan(3000);
    expect(desktop.wing).toBeGreaterThan(2000);
  });
});
