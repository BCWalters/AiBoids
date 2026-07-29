import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * `graphicsQuality` resolves its tier once at module load, because callers
 * bake the answer into GPU state (renderer construction, material choice)
 * and it cannot change without a reload. Each case therefore has to stub the
 * environment *before* importing the module, via resetModules + dynamic
 * import.
 */

interface Env {
  search?: string;
  coarsePointer?: boolean;
  innerWidth?: number;
  innerHeight?: number;
}

async function loadWithEnv(env: Env) {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { search: env.search ?? '' },
    innerWidth: env.innerWidth ?? 1440,
    innerHeight: env.innerHeight ?? 900,
    matchMedia: (query: string) => ({ matches: query.includes('coarse') ? (env.coarsePointer ?? false) : false }),
  });
  return import('./graphicsQuality');
}

const DESKTOP: Env = { coarsePointer: false, innerWidth: 1440, innerHeight: 900 };
const IPHONE_13: Env = { coarsePointer: true, innerWidth: 390, innerHeight: 664 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('graphicsQuality', () => {
  it('leaves a desktop browser on the full-quality tier', async () => {
    const q = await loadWithEnv(DESKTOP);
    expect(q.isReducedGraphics()).toBe(false);
    expect(q.isMobileDevice()).toBe(false);
    expect(q.getMaxPixelRatio()).toBe(2);
  });

  it('puts a phone on the reduced tier with an intermediate pixel-ratio cap', async () => {
    const q = await loadWithEnv(IPHONE_13);
    expect(q.isReducedGraphics()).toBe(true);
    expect(q.isMobileDevice()).toBe(true);
    // Between the desktop cap of 2 and the software-rendering cap of 1:
    // fragment cost scales with the square of this, so 1.5 is ~56% of the
    // desktop path's fragments rather than the 225% a raw DPR of 3 would give.
    expect(q.getMaxPixelRatio()).toBe(1.5);
  });

  it('requires both a coarse pointer and a small viewport', async () => {
    // A half-width desktop window: narrow, but a precise pointer.
    const narrowDesktop = await loadWithEnv({ coarsePointer: false, innerWidth: 600, innerHeight: 900 });
    expect(narrowDesktop.isMobileDevice()).toBe(false);

    // A large touchscreen display: coarse pointer, but plenty of viewport.
    const bigTouch = await loadWithEnv({ coarsePointer: true, innerWidth: 1920, innerHeight: 1080 });
    expect(bigTouch.isMobileDevice()).toBe(false);
  });

  it('treats a large phone in landscape as mobile', async () => {
    // Detection uses the *smaller* dimension so orientation cannot flip the
    // tier mid-session. The dimensions here are a 6.7" phone rotated: its
    // long edge (956) exceeds the threshold while its short edge (440) does
    // not, so a max-based check would wrongly promote it to the desktop tier.
    const q = await loadWithEnv({ coarsePointer: true, innerWidth: 956, innerHeight: 440 });
    expect(q.isMobileDevice()).toBe(true);

    const portrait = await loadWithEnv({ coarsePointer: true, innerWidth: 440, innerHeight: 956 });
    expect(portrait.isMobileDevice()).toBe(true);
  });

  it('honours ?lowfx=1 on a desktop, keeping the software-rendering cap', async () => {
    const q = await loadWithEnv({ ...DESKTOP, search: '?lowfx=1' });
    expect(q.isReducedGraphics()).toBe(true);
    // The e2e suite depends on this path staying at 1:1 — it exists to make
    // SwiftShader rasterization affordable on CI.
    expect(q.getMaxPixelRatio()).toBe(1);
    expect(q.isMobileDevice()).toBe(false);
  });

  it('lets ?lowfx=0 force the full-quality path back on for a phone', async () => {
    const q = await loadWithEnv({ ...IPHONE_13, search: '?lowfx=0' });
    expect(q.isReducedGraphics()).toBe(false);
    expect(q.isMobileDevice()).toBe(false);
    expect(q.getMaxPixelRatio()).toBe(2);
  });

  it('falls back to full quality when there is no window at all', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const q = await import('./graphicsQuality');
    expect(q.isReducedGraphics()).toBe(false);
    expect(q.isMobileDevice()).toBe(false);
  });
});
